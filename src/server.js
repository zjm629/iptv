import express from "express";
import cron from "node-cron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateLiveM3u, generateLiveTxt, generatePlaylist, generateSourcePlaylist } from "./m3u.js";
import { createStore } from "./store.js";
import { renderHomePage } from "./web.js";

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

export function createApp(store) {
  const app = express();
  app.set("trust proxy", true);
  app.use(express.json());

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
      .send(generateLiveTxt(channels, getBaseUrl(req)));
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

  app.get("/play/:channelId", (req, res) => {
    const channel = store.getChannel(req.params.channelId);
    if (!channel) {
      res.status(404).send("Channel not found");
      return;
    }

    const sourceIndex = Number.parseInt(req.query.source || "0", 10);
    const source = channel.sources[sourceIndex] || channel.sources[0];
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
