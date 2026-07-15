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
import { renderCollectorPage, renderHomePage, renderPlayerPage } from "./web.js";

const TEST_PLAYLIST_FILES = new Set([
  "test1.m3u",
  "test2.m3u",
  "test2.txt",
  "test3.m3u",
  "test4.json"
]);

export const DEFAULT_HLS_START_TIMEOUT_MS = 25000;

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

function findChannelSource(channel, requestedSourceIndex, options = {}) {
  const sources = channel.sources || [];
  if (options.preferPosition && Number.isInteger(requestedSourceIndex) && sources[requestedSourceIndex]) {
    return sources[requestedSourceIndex];
  }

  const matchedSource = sources.find((source) => source.sourceIndex === requestedSourceIndex);
  if (matchedSource) {
    return matchedSource;
  }

  return Number.isInteger(requestedSourceIndex) ? sources[requestedSourceIndex] || null : sources[0] || null;
}

function findChannelSourceByLine(channel, requestedLineIndex) {
  const sources = channel.sources || [];
  return Number.isInteger(requestedLineIndex) ? sources[requestedLineIndex] : null;
}

function parseQueryIndex(value, fallback = 0) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) ? parsed : fallback;
}

function safePathPart(value) {
  return String(value || "").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "channel";
}

function sourceUrlVersion(value) {
  return crypto.createHash("sha1").update(String(value || "")).digest("hex").slice(0, 12);
}

function normalizeChannelIdParam(value) {
  return String(value || "").replace(/\.(?:m3u8|ts)$/i, "");
}

function looksLikeM3u8(sourceUrl, contentType = "") {
  return contentType.toLowerCase().includes("mpegurl") ||
    contentType.toLowerCase().includes("application/vnd.apple") ||
    String(sourceUrl || "").toLowerCase().split("?")[0].endsWith(".m3u8");
}

function streamSuffixForSource(sourceUrl) {
  return looksLikeM3u8(sourceUrl) ? ".m3u8" : ".ts";
}

function rewriteM3u8Playlist(content, sourceUrl, rewriteUrl) {
  return String(content || "").split(/\r?\n/).map((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      return line;
    }

    try {
      return rewriteUrl(new URL(trimmed, sourceUrl).toString());
    } catch (_error) {
      return line;
    }
  }).join("\n");
}

function resolveStreamAssetUrl(sourceUrl, assetUrl) {
  let source;
  let asset;
  try {
    source = new URL(sourceUrl);
    asset = new URL(assetUrl, source);
  } catch (_error) {
    return null;
  }

  if (!/^https?:$/.test(asset.protocol) || asset.origin !== source.origin) {
    return null;
  }
  return asset.toString();
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

function proxyHttpStream(sourceUrl, res, next, redirects = 0, options = {}) {
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
      proxyHttpStream(redirectUrl, res, next, redirects + 1, options);
      return;
    }

    if (upstreamRes.statusCode >= 400) {
      res.status(upstreamRes.statusCode).send(`Upstream responded with ${upstreamRes.statusCode}`);
      upstreamRes.resume();
      return;
    }

    const contentType = upstreamRes.headers["content-type"] || "video/mp2t";
    if (options.rewriteM3u8 && looksLikeM3u8(sourceUrl, contentType)) {
      const chunks = [];
      upstreamRes.on("data", (chunk) => chunks.push(chunk));
      upstreamRes.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        res.status(upstreamRes.statusCode || 200);
        res.type("application/vnd.apple.mpegurl");
        res.setHeader("cache-control", "no-store");
        res.send(rewriteM3u8Playlist(body, sourceUrl, options.rewriteUrl));
      });
      upstreamRes.on("error", next);
      return;
    }

    res.status(upstreamRes.statusCode || 200);
    res.setHeader("content-type", contentType);
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
  const hlsStartTimeoutMs = options.hlsStartTimeoutMs ?? Number.parseInt(process.env.HLS_START_TIMEOUT_MS || String(DEFAULT_HLS_START_TIMEOUT_MS), 10);
  const hlsIdleTimeoutMs = options.hlsIdleTimeoutMs ?? Number.parseInt(process.env.HLS_IDLE_TIMEOUT_MS || "30000", 10);
  const hlsSessions = new Map();
  const discoveryJobs = new Map();
  const discoveryJobTtlMs = options.discoveryJobTtlMs ?? 30 * 60 * 1000;

  function stopHlsSession(sessionId) {
    const session = hlsSessions.get(sessionId);
    if (!session) {
      return;
    }

    if (session.cleanupTimer) {
      clearTimeout(session.cleanupTimer);
      session.cleanupTimer = null;
    }

    if (session.process.exitCode === null && session.process.signalCode === null) {
      session.process.kill?.("SIGTERM");
    }
    hlsSessions.delete(sessionId);
  }

  function touchHlsSession(sessionId) {
    const session = hlsSessions.get(sessionId);
    if (!session || hlsIdleTimeoutMs <= 0) {
      return;
    }

    if (session.cleanupTimer) {
      clearTimeout(session.cleanupTimer);
    }
    session.cleanupTimer = setTimeout(() => {
      stopHlsSession(sessionId);
    }, hlsIdleTimeoutMs);
    session.cleanupTimer.unref?.();
  }

  async function startHlsPreview(channel, source, sourceIndex, sourceVersion, options = {}) {
    const sessionId = `${safePathPart(channel.id)}-${sourceIndex}-${sourceVersion}`;
    const dir = path.join(hlsRoot, sessionId);
    const playlistPath = path.join(dir, "index.m3u8");
    const existing = hlsSessions.get(sessionId);
    if (!options.forceRestart && existing && existing.process.exitCode === null && existing.process.signalCode === null) {
      touchHlsSession(sessionId);
      return { dir, playlistPath, sessionId };
    }

    stopHlsSession(sessionId);
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
      "scale=w='min(854,iw)':h=-2",
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-tune",
      "zerolatency",
      "-profile:v",
      "main",
      "-pix_fmt",
      "yuv420p",
      "-b:v",
      "1200k",
      "-maxrate",
      "1500k",
      "-bufsize",
      "3000k",
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
      "96k",
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
    const session = { process: ffmpeg, stderr: "", cleanupTimer: null };
    ffmpeg.stderr?.on("data", (chunk) => {
      session.stderr = `${session.stderr}${chunk}`.slice(-4000);
    });
    ffmpeg.on?.("exit", () => {
      if (session.cleanupTimer) {
        clearTimeout(session.cleanupTimer);
        session.cleanupTimer = null;
      }
      if (hlsSessions.get(sessionId) === session) {
        hlsSessions.delete(sessionId);
      }
    });
    hlsSessions.set(sessionId, session);
    touchHlsSession(sessionId);
    return { dir, playlistPath, sessionId };
  }

  app.get("/", (_req, res) => {
    res.type("html").send(renderHomePage());
  });

  app.get("/collector", (_req, res) => {
    res.type("html").send(renderCollectorPage());
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

  app.get("/api/auto-sources", (_req, res) => {
    res.json(store.getAutoSourceConfig ? store.getAutoSourceConfig() : { enabled: false });
  });

  app.put("/api/auto-sources", async (req, res) => {
    try {
      const config = await store.saveAutoSourceConfig(req.body || {});
      await store.refresh();
      res.json({ config, status: store.getStatus() });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  app.post("/api/auto-sources/discover", async (req, res) => {
    try {
      const result = await store.discoverAutoSources(req.body || {});
      res.json(result);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  app.post("/api/auto-sources/discover-jobs", (req, res) => {
    const id = crypto.randomUUID();
    const job = {
      id,
      status: "running",
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      progress: [],
      result: null,
      error: ""
    };
    discoveryJobs.set(id, job);

    Promise.resolve().then(async () => {
      const result = await store.discoverAutoSources(req.body || {}, {
        onProgress: (event) => {
          job.updatedAt = new Date().toISOString();
          job.progress.push(event);
          if (job.progress.length > 500) {
            job.progress.splice(0, job.progress.length - 500);
          }
        }
      });
      job.status = "done";
      job.updatedAt = new Date().toISOString();
      job.result = result;
    }).catch((error) => {
      job.status = "error";
      job.updatedAt = new Date().toISOString();
      job.error = error.message || String(error);
      job.progress.push({
        time: new Date().toISOString(),
        phase: "discover:error",
        error: job.error,
        message: `采集失败：${job.error}`
      });
    }).finally(() => {
      setTimeout(() => {
        discoveryJobs.delete(id);
      }, discoveryJobTtlMs).unref?.();
    });

    res.json(job);
  });

  app.get("/api/auto-sources/discover-jobs/:jobId", (req, res) => {
    const job = discoveryJobs.get(req.params.jobId);
    if (!job) {
      res.status(404).json({ error: "Discovery job not found." });
      return;
    }
    res.json(job);
  });

  app.post("/api/auto-sources/debug", async (req, res) => {
    try {
      if (!store.debugAutoSourceByIp) {
        res.status(404).json({ error: "Auto source debug is unavailable." });
        return;
      }
      const result = await store.debugAutoSourceByIp(req.body?.config || req.body || {}, String(req.body?.ip || "").trim());
      res.json(result);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  app.post("/api/auto-sources/collect", async (req, res) => {
    try {
      const currentSources = await store.getSources();
      const existingUrls = new Set(currentSources.map((source) => source.url));
      const additions = [];

      for (const source of req.body?.sources || []) {
        if (!source.url || existingUrls.has(source.url)) {
          continue;
        }
        additions.push({
          name: source.typeName || source.name || "自动采集",
          url: source.url,
          hidden: false
        });
        existingUrls.add(source.url);
      }

      const sources = await store.saveSources([...currentSources, ...additions]);
      await store.refresh();
      res.json({ added: additions, sources, status: store.getStatus() });
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

    const lineIndex = parseQueryIndex(req.query.line, null);
    const sourceIndex = parseQueryIndex(req.query.source || "0", 0);
    const source = findChannelSourceByLine(channel, lineIndex) ||
      findChannelSource(channel, sourceIndex, { preferPosition: true });
    if (!source) {
      res.status(404).send("Source not found");
      return;
    }

    const stableSourceIndex = source.sourceIndex ?? sourceIndex;
    const sourceVersion = sourceUrlVersion(source.url);
    const playUrl = `${getBaseUrl(req)}/play/${encodeURIComponent(channel.id)}?source=${stableSourceIndex}`;
    const streamUrl = `${getBaseUrl(req)}/stream/${encodeURIComponent(channel.id)}${streamSuffixForSource(source.url)}?source=${stableSourceIndex}`;
    const hlsPreviewUrl = `${getBaseUrl(req)}/hls/${encodeURIComponent(channel.id)}/${stableSourceIndex}/${sourceVersion}/index.m3u8`;
    res.type("html").send(renderPlayerPage({ channel, source, playUrl, streamUrl, hlsPreviewUrl }));
  });

  app.get(["/stream/:channelId", "/stream/:channelId.m3u8", "/stream/:channelId.ts"], (req, res, next) => {
    try {
      const channel = store.getChannel(normalizeChannelIdParam(req.params.channelId));
      if (!channel) {
        res.status(404).send("Channel not found");
        return;
      }

      const lineIndex = parseQueryIndex(req.query.line, null);
      const sourceIndex = parseQueryIndex(req.query.source || "0", 0);
      const source = findChannelSourceByLine(channel, lineIndex) ||
        findChannelSource(channel, sourceIndex);
      if (!source) {
        res.status(404).send("Source not found");
        return;
      }

      if (!/^https?:\/\//i.test(source.url)) {
        res.status(400).send("Only HTTP and HTTPS streams can be proxied.");
        return;
      }

      const stableSourceIndex = source.sourceIndex ?? sourceIndex;
      const assetUrl = typeof req.query.asset === "string" && req.query.asset
        ? resolveStreamAssetUrl(source.url, req.query.asset)
        : null;
      if (req.query.asset && !assetUrl) {
        res.status(400).send("Invalid stream asset URL.");
        return;
      }

      const upstreamReq = proxyHttpStream(assetUrl || source.url, res, next, 0, {
        rewriteM3u8: !assetUrl,
        rewriteUrl: (url) => `${getBaseUrl(req)}/stream/${encodeURIComponent(channel.id)}?source=${stableSourceIndex}&asset=${encodeURIComponent(url)}`
      });
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

      const requestedSourceIndex = parseQueryIndex(req.params.sourceIndex || "0", 0);
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
      } else {
        touchHlsSession(sessionId);
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

  app.get(["/play/:channelId", "/play/:channelId.m3u8"], (req, res) => {
    const channelId = String(req.params.channelId || "").replace(/\.m3u8$/i, "");
    const channel = store.getChannel(channelId);
    if (!channel) {
      res.status(404).send("Channel not found");
      return;
    }

    const lineIndex = parseQueryIndex(req.query.line, null);
    const sourceIndex = parseQueryIndex(req.query.source || "0", 0);
    const source = findChannelSourceByLine(channel, lineIndex) ||
      findChannelSource(channel, sourceIndex);
    if (!source) {
      res.status(404).send("Source not found");
      return;
    }

    if (req.path.toLowerCase().endsWith(".m3u8")) {
      res
        .status(302)
        .type("application/vnd.apple.mpegurl")
        .set("location", source.url)
        .send("");
      return;
    }

    res.redirect(source.url);
  });

  app.use((error, _req, res, _next) => {
    res.status(500).json({ error: error.message });
  });

  return app;
}

export async function startServer(options = {}) {
  const port = options.port ?? Number.parseInt(process.env.PORT || "3080", 10);
  const refreshCron = options.refreshCron || process.env.REFRESH_CRON || "0 */2 * * *";
  const store = options.store || createStore();
  const cronImpl = options.cronImpl || cron;
  const log = options.log || console.log;
  const errorLog = options.errorLog || console.error;
  await store.load();

  const app = createApp(store, options.appOptions || {});
  const server = app.listen(port);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.once("listening", () => {
      server.off("error", reject);
      const address = server.address();
      const actualPort = typeof address === "object" && address ? address.port : port;
      log(`IPTV M3U Manager listening on port ${actualPort}`);
      resolve();
    });
  });

  store.refresh().catch((error) => {
    errorLog("Initial refresh failed:", error);
  });

  cronImpl.schedule(refreshCron, () => {
    store.refresh().catch((error) => {
      errorLog("Scheduled refresh failed:", error);
    });
  });

  return server;
}

const isDirectRun = process.argv[1] === fileURLToPath(import.meta.url);
if (isDirectRun) {
  startServer().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
