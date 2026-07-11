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

function createInitialOverrides() {
  return {
    channels: {},
    order: [],
    categories: ["推荐频道"]
  };
}

function normalizeOverride(value = {}) {
  const parsedSortOrder = value.sortOrder === "" || value.sortOrder === null || value.sortOrder === undefined
    ? null
    : Number(value.sortOrder);
  const customGroups = Array.isArray(value.customGroups)
    ? value.customGroups
    : value.customGroup
      ? [value.customGroup]
      : [];

  return {
    hidden: Boolean(value.hidden),
    preferredSourceUrl: String(value.preferredSourceUrl || "").trim(),
    disabledSourceUrls: Array.isArray(value.disabledSourceUrls)
      ? Array.from(new Set(value.disabledSourceUrls.map((url) => String(url || "").trim()).filter(Boolean)))
      : [],
    sortOrder: Number.isFinite(parsedSortOrder) ? parsedSortOrder : null,
    customGroups: Array.from(new Set(customGroups.map((group) => String(group || "").trim()).filter(Boolean)))
  };
}

function normalizeCategories(value) {
  const names = Array.isArray(value) ? value : [];
  const normalized = ["推荐频道"];

  for (const name of names) {
    const category = String(name || "").trim();
    if (category && !normalized.includes(category)) {
      normalized.push(category);
    }
  }

  return normalized;
}

function normalizeOverrides(value) {
  const normalized = createInitialOverrides();
  const sourceChannels = value && typeof value === "object" && value.channels && typeof value.channels === "object"
    ? value.channels
    : {};

  for (const [id, override] of Object.entries(sourceChannels)) {
    normalized.channels[id] = normalizeOverride(override);
  }

  if (Array.isArray(value?.order)) {
    normalized.order = Array.from(new Set(value.order.map((id) => String(id || "").trim()).filter(Boolean)));
  }

  normalized.categories = normalizeCategories(value?.categories);

  return normalized;
}

function normalizeSources(sources) {
  if (!Array.isArray(sources)) {
    throw new Error("Sources must be an array");
  }

  return sources.map((source) => {
    const name = String(source?.name || "").trim();
    const url = String(source?.url || "").trim();

    if (!url) {
      throw new Error("Source URL is required");
    }

    return { name, url };
  });
}

async function readSources(configPath) {
  return normalizeSources(await readJson(configPath, []));
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

  return Array.from(byKey.values());
}

function applyChannelOrder(sourceChannels, order) {
  const byId = new Map(sourceChannels.map((channel) => [channel.id, channel]));
  const ordered = [];

  for (const id of order) {
    const channel = byId.get(id);
    if (channel) {
      ordered.push(channel);
      byId.delete(id);
    }
  }

  ordered.push(...byId.values());
  return ordered;
}

function applySortOrders(sourceChannels) {
  return sourceChannels
    .map((channel, index) => ({ channel, index }))
    .sort((left, right) => {
      if (left.channel.hidden !== right.channel.hidden) {
        return left.channel.hidden ? 1 : -1;
      }

      if (left.channel.hidden && right.channel.hidden) {
        return left.index - right.index;
      }

      const leftHasSort = Number.isFinite(left.channel.sortOrder);
      const rightHasSort = Number.isFinite(right.channel.sortOrder);
      if (leftHasSort && rightHasSort && left.channel.sortOrder !== right.channel.sortOrder) {
        return left.channel.sortOrder - right.channel.sortOrder;
      }
      if (leftHasSort !== rightHasSort) {
        return leftHasSort ? -1 : 1;
      }

      return left.index - right.index;
    })
    .map(({ channel }) => channel);
}

export function createStore(options = {}) {
  const configPath = options.configPath || process.env.SOURCES_PATH || path.join(process.cwd(), "config", "sources.json");
  const cachePath = options.cachePath || process.env.CACHE_PATH || path.join(process.cwd(), "data", "cache.json");
  const overridesPath = options.overridesPath || process.env.OVERRIDES_PATH || path.join(process.cwd(), "config", "channel-overrides.json");
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  let channels = [];
  let overrides = createInitialOverrides();
  let status = createInitialStatus();
  let refreshPromise = null;

  function decorateChannel(channel) {
    const override = normalizeOverride(overrides.channels[channel.id]);
    const disabledUrls = new Set(override.disabledSourceUrls);
    const decoratedSources = channel.sources.map((source, index) => ({
      ...source,
      sourceIndex: index,
      disabled: disabledUrls.has(source.url),
      preferred: Boolean(override.preferredSourceUrl && source.url === override.preferredSourceUrl)
    }));

    return {
      ...channel,
      hidden: override.hidden,
      sortOrder: override.sortOrder,
      customGroups: override.customGroups,
      defaultSourceIndex: decoratedSources.find((source) => source.preferred && !source.disabled)?.sourceIndex ?? 0,
      sources: decoratedSources
    };
  }

  function getDecoratedChannels() {
    return applySortOrders(applyChannelOrder(channels.map(decorateChannel), overrides.order));
  }

  async function loadOverrides() {
    overrides = normalizeOverrides(await readJson(overridesPath, createInitialOverrides()));
  }

  async function persistOverrides() {
    await fs.mkdir(path.dirname(overridesPath), { recursive: true });
    await fs.writeFile(overridesPath, `${JSON.stringify(overrides, null, 2)}\n`, "utf8");
  }

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
    const configuredSources = await readSources(configPath);
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
      await loadOverrides();
    },
    getSources() {
      return readSources(configPath);
    },
    async saveSources(sources) {
      const normalizedSources = normalizeSources(sources);
      await fs.mkdir(path.dirname(configPath), { recursive: true });
      await fs.writeFile(configPath, `${JSON.stringify(normalizedSources, null, 2)}\n`, "utf8");
      return normalizedSources;
    },
    getCategories() {
      return normalizeCategories(overrides.categories);
    },
    async saveCategories(categories) {
      overrides.categories = normalizeCategories(categories);
      await persistOverrides();
      return overrides.categories;
    },
    async saveChannelOverride(id, override) {
      const channelId = String(id || "").trim();
      if (!channelId) {
        throw new Error("Channel id is required");
      }

      const existing = normalizeOverride(overrides.channels[channelId]);
      overrides.channels[channelId] = normalizeOverride({ ...existing, ...override });
      await persistOverrides();
      return overrides.channels[channelId];
    },
    async moveChannel(id, direction) {
      const channelId = String(id || "").trim();
      if (!channelId) {
        throw new Error("Channel id is required");
      }

      const currentOrder = getDecoratedChannels().map((channel) => channel.id);
      const index = currentOrder.indexOf(channelId);
      if (index === -1) {
        throw new Error("Channel not found");
      }

      if (direction === "top" && index > 0) {
        currentOrder.splice(index, 1);
        currentOrder.unshift(channelId);
      }

      if (direction === "bottom" && index >= 0 && index < currentOrder.length - 1) {
        currentOrder.splice(index, 1);
        currentOrder.push(channelId);
      }

      const delta = direction === "up" ? -1 : direction === "down" ? 1 : 0;
      const nextIndex = index + delta;
      if (!["top", "bottom"].includes(direction) && delta !== 0 && nextIndex >= 0 && nextIndex < currentOrder.length) {
        [currentOrder[index], currentOrder[nextIndex]] = [currentOrder[nextIndex], currentOrder[index]];
      }

      overrides.order = currentOrder;
      await persistOverrides();
      return overrides.order;
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
      return getDecoratedChannels();
    },
    getOutputChannels() {
      return getDecoratedChannels()
        .filter((channel) => !channel.hidden)
        .map((channel) => {
          const enabledSources = channel.sources.filter((source) => !source.disabled);
          const preferredIndex = enabledSources.findIndex((source) => source.preferred);
          if (preferredIndex > 0) {
            enabledSources.unshift(...enabledSources.splice(preferredIndex, 1));
          }

          return {
            ...channel,
            defaultSourceIndex: enabledSources[0]?.sourceIndex ?? channel.defaultSourceIndex,
            sources: enabledSources
          };
        })
        .filter((channel) => channel.sources.length > 0);
    },
    getChannel(id) {
      return getDecoratedChannels().find((channel) => channel.id === id) || null;
    },
    getStatus() {
      return { ...status, refreshing: Boolean(refreshPromise) || status.refreshing };
    }
  };
}
