import fs from "node:fs/promises";
import path from "node:path";
import { parseM3u } from "./m3u.js";
import { normalizeChannelName } from "./normalize.js";

function nowIso() {
  return new Date().toISOString();
}

async function readJson(filePath, fallback) {
  try {
    const content = await fs.readFile(filePath, "utf8");
    return JSON.parse(content.replace(/^\uFEFF/, ""));
  } catch (error) {
    if (error.code === "ENOENT") {
      return fallback;
    }
    throw error;
  }
}

function createInitialStatus() {
  return {
    lastRefreshAt: null,
    lastSuccessAt: null,
    refreshing: false,
    channelCount: 0,
    sourceCount: 0,
    sources: []
  };
}

function mergeEntries(entries) {
  const byKey = new Map();

  for (const entry of entries) {
    const id = normalizeChannelName(entry.name);
    const existing = byKey.get(id);
    const sourceLine = {
      sourceName: entry.sourceName,
      url: entry.url,
      name: entry.name,
      group: entry.group || "",
      logo: entry.logo || ""
    };

    if (!existing) {
      byKey.set(id, {
        id,
        name: entry.name,
        logo: entry.logo || "",
        group: entry.group || "",
        sources: [sourceLine]
      });
      continue;
    }

    if (!existing.sources.some((source) => source.url === entry.url)) {
      existing.sources.push(sourceLine);
    }

    if (!existing.logo && entry.logo) {
      existing.logo = entry.logo;
    }

    if (!existing.group && entry.group) {
      existing.group = entry.group;
    }
  }

  return Array.from(byKey.values()).sort((a, b) => a.name.localeCompare(b.name, "zh-Hans-CN"));
}

export function createStore(options = {}) {
  const configPath = options.configPath || process.env.SOURCES_PATH || path.join(process.cwd(), "config", "sources.json");
  const cachePath = options.cachePath || process.env.CACHE_PATH || path.join(process.cwd(), "data", "cache.json");
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  let channels = [];
  let status = createInitialStatus();
  let refreshPromise = null;

  async function loadCache() {
    const cache = await readJson(cachePath, null);
    if (!cache) {
      return;
    }

    channels = Array.isArray(cache.channels) ? cache.channels : [];
    status = {
      ...createInitialStatus(),
      ...cache.status,
      channelCount: channels.length
    };
  }

  async function persistCache() {
    await fs.mkdir(path.dirname(cachePath), { recursive: true });
    await fs.writeFile(cachePath, JSON.stringify({ channels, status }, null, 2), "utf8");
  }

  async function runRefresh() {
    status = { ...status, refreshing: true };
    const configuredSources = await readJson(configPath, []);
    const entries = [];
    const sourceStatuses = [];

    for (const source of configuredSources) {
      try {
        const response = await fetchImpl(source.url);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const text = await response.text();
        const parsed = parseM3u(text, source.name || source.url);
        entries.push(...parsed);
        sourceStatuses.push({
          name: source.name || source.url,
          url: source.url,
          ok: true,
          channels: parsed.length
        });
      } catch (error) {
        sourceStatuses.push({
          name: source.name || source.url,
          url: source.url,
          ok: false,
          channels: 0,
          error: error.message
        });
      }
    }

    const merged = mergeEntries(entries);
    const refreshAt = nowIso();
    if (merged.length > 0) {
      channels = merged;
      status = {
        lastRefreshAt: refreshAt,
        lastSuccessAt: refreshAt,
        refreshing: false,
        channelCount: channels.length,
        sourceCount: configuredSources.length,
        sources: sourceStatuses
      };
      await persistCache();
      return status;
    }

    status = {
      ...status,
      lastRefreshAt: refreshAt,
      refreshing: false,
      channelCount: channels.length,
      sourceCount: configuredSources.length,
      sources: sourceStatuses
    };

    return status;
  }

  return {
    async load() {
      await loadCache();
    },
    refresh() {
      if (!refreshPromise) {
        refreshPromise = runRefresh().finally(() => {
          refreshPromise = null;
        });
      }

      return refreshPromise;
    },
    getChannels() {
      return channels;
    },
    getChannel(id) {
      return channels.find((channel) => channel.id === id) || null;
    },
    getStatus() {
      return { ...status, refreshing: Boolean(refreshPromise) || status.refreshing };
    }
  };
}
