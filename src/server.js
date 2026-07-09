import express from "express";
import cron from "node-cron";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import { pipeline } from "node:stream";
import { fileURLToPath } from "node:url";
import { generateLiveM3u, generateLiveTxt, generatePlaylist, generateSourcePlaylist } from "./m3u.js";
import { createStore } from "./store.js";
import { renderHomePage, renderPlayerPage } from "./web.js";

const TEST_PLAYLIST_FILES = new Set([
  "test1.m3u",
  "test2.m3u",
  "test2.txt",
  "test3.m3u",
  "test4.json"
]);

function getBaseUrl(req) {
  return `${req.protocol}://${req.get("host")}`;
}

function ensureChannelsAvailable(res, channels, type = "json") {
  if (channels.length > 0) {
    return true;
  }

  if (type === "json") {
    res.status(503).json({ error: "No playlist cache is available yet." });
    return false;
  }

  res.status(503).type("text").send("No playlist cache is available yet.");
  return false;
}

function findChannelSource(channel, requestedSourceIndex) {
  const sources = channel.sources || [];
  return sources.find((source) => source.sourceIndex === requestedSourceIndex) ||
    sources[requestedSourceIndex] ||
    sources[0];
}

function safePathPart(value) {
  return String(value || "").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "channel";
}

function sourceUrlVersion(value) {
  return crypto.createHash("sha1").update(String(value || "")).digest("hex").slice(0, 12);
}

async function waitForFile(filePath, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const stat = await fs.stat(filePath);
      if (stat.size > 0) {
        return true;
      }
    } catch (_error) {
      // File is not ready yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  return false;
}

function proxyHttpStream(sourceUrl, res, next, redirects = 0) {
  let parsedUrl;
  try {
    parsedUrl = new URL(sourceUrl);
  } catch (_error) {
    res.status(400).send("Invalid stream URL.");
    return null;
  }

  const client = parsedUrl.protocol === "https:" ? https : http;
  const upstreamReq = client.request(parsedUrl, {
    method: "GET",
    headers: {
      "user-agent": "Mozilla/5.0 IPTV-M3U-Manager/1.0",
      "accept": "*/*",
      "connection": "close"
    }
  }, (upstreamRes) => {
    const location = upstreamRes.headers.location;
    if (upstreamRes.statusCode >= 300 && upstreamRes.statusCode < 400 && location && redirects < 5) {
      upstreamRes.resume();
      const redirectUrl = new URL(location, parsedUrl).toString();
      proxyHttpStream(redirectUrl, res, next, redirects + 1);
      return;
    }

    if (upstreamRes.statusCode >= 400) {
      res.status(upstreamRes.statusCode).send(`Upstream responded with ${upstreamRes.statusCode}`);
      upstreamRes.resume();
      return;
    }

    res.status(upstreamRes.statusCode || 200);
    res.setHeader("content-type", upstreamRes.headers["content-type"] || "video/mp2t");
    res.setHeader("cache-control", "no-store");
    res.flushHeaders?.();

    pipeline(upstreamRes, res, (error) => {
      if (error && !res.destroyed) {
        next(error);
      }
    });
  });

  upstreamReq.on("error", next);
  upstreamReq.end();
  return upstreamReq;
}

export function createApp(store, options = {}) {
  const app = express();
  app.set("trust proxy", true);
  app.use(express.json());
  const spawnImpl = options.spawnImpl || spawn;
  const ffmpegPath = options.ffmpegPath || process.env.FFMPEG_PATH || "ffmpeg";
  const hlsRoot = options.hlsRoot || process.env.HLS_CACHE_DIR || path.join(os.tmpdir(), "iptv-hls-preview");
  const hlsStartTimeoutMs = options.hlsStartTimeoutMs || 8000;
  const hlsSessions = new Map();

  async function startHlsPreview(channel, source, sourceIndex, sourceVersion, options = {}) {
    const sessionId = `${safePathPart(channel.id)}-${sourceIndex}-${sourceVersion}`;
    const dir = path.join(hlsRoot, sessionId);
    const playlistPath = path.join(dir, "index.m3u8");
    const existing = hlsSessions.get(sessionId);
    if (!options.forceRestart && existing && existing.process.exitCode === null && existing.process.signalCode === null) {
      return { dir, playlistPath, sessionId };
    }

    existing?.process.kill?.("SIGTERM");
    await fs.rm(dir, { recursive: true, force: true });
    await fs.mkdir(dir, { recursive: true });

    const args = [
      "-hide_banner",
      "-loglevel",
      "warning",
      "-fflags",
      "+genpts+discardcorrupt",
      "-user_agent",
      "Mozilla/5.0 IPTV-M3U-Manager/1.0",
      "-i",
      source.url,
      "-map",
      "0:v:0",
      "-map",
      "0:a?",
      "-vf",
      "scale=trunc(iw/2)*2:trunc(ih/2)*2",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-tune",
      "zerolatency",
      "-profile:v",
      "main",
      "-pix_fmt",
      "yuv420p",
      "-g",
      "50",
      "-keyint_min",
      "50",
      "-sc_threshold",
      "0",
      "-force_key_frames",
      "expr:gte(t,n_forced*2)",
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      "-ac",
      "2",
      "-ar",
      "44100",
      "-f",
      "hls",
      "-hls_time",
      "2",
      "-hls_list_size",
      "6",
      "-hls_flags",
      "delete_segments+omit_endlist+program_date_time",
      "-hls_segment_filename",
      path.join(dir, "segment_%05d.ts"),
      playlistPath
    ];
    const ffmpeg = spawnImpl(ffmpegPath, args, { stdio: ["ignore", "ignore", "pipe"] });
    const session = { process: ffmpeg, stderr: "" };
    ffmpeg.stderr?.on("data", (chunk) => {
      session.stderr = `${session.stderr}${chunk}`.slice(-4000);
    });
    ffmpeg.on?.("exit", () => {
      if (hlsSessions.get(sessionId) === session) {
        hlsSessions.delete(sessionId);
      }
    });
    hlsSessions.set(sessionId, session);
    return { dir, playlistPath, sessionId };
  }

  app.get("/", (_req, res) => {
    res.type("html").send(renderHomePage());
  });

  app.get("/api/status", (_req, res) => {
    res.json(store.getStatus());
  });

  app.get("/api/channels", (_req, res) => {
    res.json(store.getChannels());
  });

  app.put("/api/channels/:channelId/override", async (req, res) => {
    try {
      const override = await store.saveChannelOverride(req.params.channelId, req.body || {});
      res.json({ override, channels: store.getChannels() });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  app.get("/api/categories", (_req, res) => {
    res.json(store.getCategories ? store.getCategories() : ["推荐频道"]);
  });

  app.put("/api/categories", async (req, res) => {
    try {
      const categories = await store.saveCategories(req.body?.categories || []);
      res.json({ categories, channels: store.getChannels() });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  app.post("/api/channels/:channelId/move", async (req, res) => {
    try {
      const order = await store.moveChannel(req.params.channelId, req.body?.direction);
      res.json({ order, channels: store.getChannels() });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  app.get("/api/sources", async (_req, res, next) => {
    try {
      res.json(await store.getSources());
    } catch (error) {
      next(error);
    }
  });

  app.put("/api/sources", async (req, res) => {
    try {
      const sources = await store.saveSources(req.body?.sources);
      await store.refresh();
      res.json({ sources, status: store.getStatus() });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  app.post("/api/refresh", async (_req, res, next) => {
    try {
      await store.refresh();
      res.json(store.getStatus());
    } catch (error) {
      next(error);
    }
  });

  app.get("/playlist.m3u", (req, res) => {
    const channels = store.getOutputChannels ? store.getOutputChannels() : store.getChannels();
    if (!ensureChannelsAvailable(res, channels, "text")) {
      return;
    }

    res
      .type("application/x-mpegURL")
      .send(generatePlaylist(channels, getBaseUrl(req)));
  });

  app.get("/playlist-sources.m3u", (req, res) => {
    const channels = store.getOutputChannels ? store.getOutputChannels() : store.getChannels();
    if (!ensureChannelsAvailable(res, channels, "text")) {
      return;
    }

    res
      .type("application/x-mpegURL")
      .send(generateSourcePlaylist(channels, getBaseUrl(req)));
  });

  app.get("/live.txt", (req, res) => {
    const channels = store.getOutputChannels ? store.getOutputChannels() : store.getChannels();
    if (!ensureChannelsAvailable(res, channels, "text")) {
      return;
    }

    res
      .type("text/plain")
      .send(generateLiveTxt(channels, getBaseUrl(req), store.getCategories ? store.getCategories() : ["推荐频道"]));
  });

  app.get("/live.m3u", (req, res) => {
    const channels = store.getOutputChannels ? store.getOutputChannels() : store.getChannels();
    if (!ensureChannelsAvailable(res, channels, "text")) {
      return;
    }

    res
      .type("application/x-mpegURL")
      .send(generateLiveM3u(channels, getBaseUrl(req)));
  });

  app.get(Array.from(TEST_PLAYLIST_FILES, (fileName) => `/${fileName}`), (req, res) => {
    const fileName = req.path.slice(1);
    if (!TEST_PLAYLIST_FILES.has(fileName)) {
      res.status(404).send("Not found");
      return;
    }

    res.sendFile(path.join(process.cwd(), fileName));
  });

  app.get("/player/:channelId", (req, res) => {
    const channel = store.getChannel(req.params.channelId);
    if (!channel) {
      res.status(404).send("Channel not found");
      return;
    }

    const sourceIndex = Number.parseInt(req.query.source || "0", 10);
    const source = findChannelSource(channel, sourceIndex);
    if (!source) {
      res.status(404).send("Source not found");
      return;
    }

    const stableSourceIndex = source.sourceIndex ?? sourceIndex;
    const sourceVersion = sourceUrlVersion(source.url);
    const playUrl = `${getBaseUrl(req)}/play/${encodeURIComponent(channel.id)}?source=${stableSourceIndex}`;
    const streamUrl = `${getBaseUrl(req)}/stream/${encodeURIComponent(channel.id)}?source=${stableSourceIndex}`;
    const hlsPreviewUrl = `${getBaseUrl(req)}/hls/${encodeURIComponent(channel.id)}/${stableSourceIndex}/${sourceVersion}/index.m3u8`;
    res.type("html").send(renderPlayerPage({ channel, source, playUrl, streamUrl, hlsPreviewUrl }));
  });

  app.get("/stream/:channelId", (req, res, next) => {
    try {
      const channel = store.getChannel(req.params.channelId);
      if (!channel) {
        res.status(404).send("Channel not found");
        return;
      }

      const sourceIndex = Number.parseInt(req.query.source || "0", 10);
      const source = findChannelSource(channel, sourceIndex);
      if (!source) {
        res.status(404).send("Source not found");
        return;
      }

      if (!/^https?:\/\//i.test(source.url)) {
        res.status(400).send("Only HTTP and HTTPS streams can be proxied.");
        return;
      }

      const upstreamReq = proxyHttpStream(source.url, res, next);
      res.on("close", () => upstreamReq?.destroy());
    } catch (error) {
      next(error);
    }
  });

  app.get("/hls/:channelId/:sourceIndex/:sourceVersion/:fileName", async (req, res, next) => {
    try {
      const channel = store.getChannel(req.params.channelId);
      if (!channel) {
        res.status(404).send("Channel not found");
        return;
      }

      const requestedSourceIndex = Number.parseInt(req.params.sourceIndex || "0", 10);
      const source = findChannelSource(channel, requestedSourceIndex);
      if (!source) {
        res.status(404).send("Source not found");
        return;
      }

      if (!/^https?:\/\//i.test(source.url)) {
        res.status(400).send("Only HTTP and HTTPS streams can be previewed as HLS.");
        return;
      }

      const stableSourceIndex = source.sourceIndex ?? requestedSourceIndex;
      const expectedSourceVersion = sourceUrlVersion(source.url);
      if (req.params.sourceVersion !== expectedSourceVersion) {
        res.status(404).send("HLS preview source version is no longer current.");
        return;
      }

      const fileName = path.basename(req.params.fileName);
      const isPlaylist = fileName.endsWith(".m3u8");
      const sessionId = `${safePathPart(channel.id)}-${stableSourceIndex}-${expectedSourceVersion}`;
      const dir = path.join(hlsRoot, sessionId);
      const playlistPath = path.join(dir, "index.m3u8");
      if (isPlaylist) {
        await startHlsPreview(channel, source, stableSourceIndex, expectedSourceVersion, {
          forceRestart: req.query.restart === "1"
        });
      }

      const filePath = path.join(dir, fileName);
      const ready = isPlaylist ? await waitForFile(playlistPath, hlsStartTimeoutMs) : true;
      if (!ready) {
        const stderr = hlsSessions.get(sessionId)?.stderr?.trim();
        res.status(503).type("text").send(stderr
          ? `HLS preview did not start yet.\n\nFFmpeg output:\n${stderr}`
          : "HLS preview is still starting. Please retry in a moment.");
        return;
      }

      res.type(isPlaylist ? "application/vnd.apple.mpegurl" : "video/mp2t");
      res.setHeader("cache-control", "no-store");
      res.sendFile(filePath, (error) => {
        if (error && !res.headersSent) {
          res.status(error.statusCode || 404).send("HLS preview file is not ready.");
        }
      });
    } catch (error) {
      next(error);
    }
  });

  app.get("/play/:channelId", (req, res) => {
    const channel = store.getChannel(req.params.channelId);
    if (!channel) {
      res.status(404).send("Channel not found");
      return;
    }

    const sourceIndex = Number.parseInt(req.query.source || "0", 10);
    const source = findChannelSource(channel, sourceIndex);
    if (!source) {
      res.status(404).send("Source not found");
      return;
    }

    res.redirect(source.url);
  });

  app.use((error, _req, res, _next) => {
    res.status(500).json({ error: error.message });
  });

  return app;
}

export async function startServer() {
  const port = Number.parseInt(process.env.PORT || "3080", 10);
  const refreshCron = process.env.REFRESH_CRON || "0 */2 * * *";
  const store = createStore();
  await store.load();
  await store.refresh();

  cron.schedule(refreshCron, () => {
    store.refresh().catch((error) => {
      console.error("Scheduled refresh failed:", error);
    });
  });

  const app = createApp(store);
  app.listen(port, () => {
    console.log(`IPTV M3U Manager listening on port ${port}`);
  });
}

const isDirectRun = process.argv[1] === fileURLToPath(import.meta.url);
if (isDirectRun) {
  startServer().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
