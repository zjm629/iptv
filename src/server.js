import express from "express";
import cron from "node-cron";
import { fileURLToPath } from "node:url";
import { generateLiveTxt, generatePlaylist, generateSourcePlaylist } from "./m3u.js";
import { createStore } from "./store.js";
import { renderHomePage } from "./web.js";

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

function formatJsonSourceLabel(value, fallback) {
  return String(value || fallback)
    .replaceAll("]", "")
    .replaceAll("#", "")
    .replaceAll("\r", " ")
    .replaceAll("\n", " ")
    .trim();
}

function generateJsonPlaylist(channels, baseUrl) {
  const cleanBaseUrl = String(baseUrl || "").replace(/\/$/, "");
  const groups = new Map();

  for (const channel of channels) {
    const groupName = channel.group || "IPTV";
    if (!groups.has(groupName)) {
      groups.set(groupName, []);
    }

    const sources = channel.sources?.length ? channel.sources : [{}];
    const joinedUrls = sources
      .map((source, index) => {
        const label = formatJsonSourceLabel(source.sourceName, `Line ${index + 1}`);
        return `$[${label}]${cleanBaseUrl}/play/${encodeURIComponent(channel.id)}?source=${index}`;
      })
      .join("#");

    groups.get(groupName).push({
      name: channel.name,
      urls: [joinedUrls]
    });
  }

  return {
    lives: Array.from(groups.entries()).map(([group, groupedChannels]) => ({
      group,
      channels: groupedChannels
    }))
  };
}

function generateTvboxProxyConfig(baseUrl) {
  const cleanBaseUrl = String(baseUrl || "").replace(/\/$/, "");

  return {
    sites: [],
    lives: [
      {
        group: "redirect",
        channels: [
          {
            name: "IPTV",
            urls: [`proxy://do=live&type=txt&ext=${cleanBaseUrl}/live.txt`]
          }
        ]
      }
    ],
    parses: [],
    flags: []
  };
}

function generateTvboxDirectConfig(channels, baseUrl) {
  return {
    sites: [],
    ...generateJsonPlaylist(channels, baseUrl),
    parses: [],
    flags: []
  };
}

function generateWarehouseConfig(baseUrl) {
  const cleanBaseUrl = String(baseUrl || "").replace(/\/$/, "");

  return {
    urls: [
      {
        name: "IPTV直播",
        url: `${cleanBaseUrl}/tvbox.json`
      }
    ]
  };
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
    const channels = store.getChannels();
    if (!ensureChannelsAvailable(res, channels, "text")) {
      return;
    }

    res
      .type("application/x-mpegURL")
      .send(generatePlaylist(channels, getBaseUrl(req)));
  });

  app.get("/playlist-sources.m3u", (req, res) => {
    const channels = store.getChannels();
    if (!ensureChannelsAvailable(res, channels, "text")) {
      return;
    }

    res
      .type("application/x-mpegURL")
      .send(generateSourcePlaylist(channels, getBaseUrl(req)));
  });

  app.get("/playlist.json", (req, res) => {
    const channels = store.getChannels();
    if (!ensureChannelsAvailable(res, channels)) {
      return;
    }

    res
      .type("application/json")
      .send(`${JSON.stringify(generateJsonPlaylist(channels, getBaseUrl(req)), null, 2)}\n`);
  });

  app.get("/live.txt", (req, res) => {
    const channels = store.getChannels();
    if (!ensureChannelsAvailable(res, channels, "text")) {
      return;
    }

    res
      .type("text/plain")
      .send(generateLiveTxt(channels, getBaseUrl(req)));
  });

  app.get("/tvbox.json", (req, res) => {
    const channels = store.getChannels();
    if (!ensureChannelsAvailable(res, channels)) {
      return;
    }

    res
      .type("application/json")
      .send(`${JSON.stringify(generateTvboxProxyConfig(getBaseUrl(req)), null, 2)}\n`);
  });

  app.get("/tvbox-direct.json", (req, res) => {
    const channels = store.getChannels();
    if (!ensureChannelsAvailable(res, channels)) {
      return;
    }

    res
      .type("application/json")
      .send(`${JSON.stringify(generateTvboxDirectConfig(channels, getBaseUrl(req)), null, 2)}\n`);
  });

  app.get("/warehouse.json", (req, res) => {
    const channels = store.getChannels();
    if (!ensureChannelsAvailable(res, channels)) {
      return;
    }

    res
      .type("application/json")
      .send(`${JSON.stringify(generateWarehouseConfig(getBaseUrl(req)), null, 2)}\n`);
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
