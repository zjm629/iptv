function parseAttributes(line) {
  const attrs = {};
  const attrPattern = /([\w-]+)="([^"]*)"/g;
  let match;

  while ((match = attrPattern.exec(line)) !== null) {
    attrs[match[1]] = match[2];
  }

  return attrs;
}

function parseName(line) {
  const commaIndex = line.lastIndexOf(",");
  if (commaIndex === -1) {
    return "";
  }

  return line.slice(commaIndex + 1).trim();
}

function escapeAttribute(value = "") {
  return String(value).replaceAll('"', "&quot;");
}

function escapeLiveValue(value = "") {
  return String(value).replaceAll("\r", " ").replaceAll("\n", " ").trim();
}

function buildPlayUrls(channel, baseUrl) {
  const sources = channel.sources?.length ? channel.sources : [{}];
  return sources.map((source, index) =>
    `${baseUrl}/play/${encodeURIComponent(channel.id)}?source=${source.sourceIndex ?? index}`
  );
}

function getChannelGroups(channel) {
  if (Array.isArray(channel.customGroups)) {
    return channel.customGroups.map((group) => escapeLiveValue(group)).filter(Boolean);
  }

  const legacyGroup = escapeLiveValue(channel.customGroup);
  return legacyGroup ? [legacyGroup] : [];
}

export function parseM3u(text, sourceName) {
  const lines = String(text || "").split(/\r?\n/);
  const entries = [];
  let pending = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }

    if (line.startsWith("#EXTINF")) {
      const attrs = parseAttributes(line);
      pending = {
        name: parseName(line),
        logo: attrs["tvg-logo"] || "",
        group: attrs["group-title"] || ""
      };
      continue;
    }

    if (line.startsWith("#")) {
      continue;
    }

    if (pending?.name && line) {
      entries.push({
        name: pending.name,
        url: line,
        logo: pending.logo,
        group: pending.group,
        sourceName
      });
    }

    pending = null;
  }

  return entries;
}

export function generatePlaylist(channels, baseUrl) {
  const cleanBaseUrl = String(baseUrl || "").replace(/\/$/, "");
  const lines = ["#EXTM3U"];

  for (const channel of channels) {
    const attrs = [
      `tvg-id="${escapeAttribute(channel.id)}"`,
      `tvg-name="${escapeAttribute(channel.name)}"`
    ];

    if (channel.logo) {
      attrs.push(`tvg-logo="${escapeAttribute(channel.logo)}"`);
    }

    if (channel.group) {
      attrs.push(`group-title="${escapeAttribute(channel.group)}"`);
    }

    lines.push(`#EXTINF:-1 ${attrs.join(" ")},${channel.name}`);
    const sourceIndex = channel.sources?.[0]?.sourceIndex ?? channel.defaultSourceIndex ?? 0;
    lines.push(`${cleanBaseUrl}/play/${encodeURIComponent(channel.id)}?source=${sourceIndex}`);
  }

  return `${lines.join("\n")}\n`;
}

export function generateSourcePlaylist(channels, baseUrl) {
  const cleanBaseUrl = String(baseUrl || "").replace(/\/$/, "");
  const lines = ["#EXTM3U"];

  for (const channel of channels) {
    const sources = channel.sources?.length ? channel.sources : [{}];
    for (let sourceIndex = 0; sourceIndex < sources.length; sourceIndex += 1) {
      const attrs = [
        `tvg-id="${escapeAttribute(channel.id)}"`,
        `tvg-name="${escapeAttribute(channel.name)}"`
      ];

      if (channel.logo) {
        attrs.push(`tvg-logo="${escapeAttribute(channel.logo)}"`);
      }

      if (channel.group) {
        attrs.push(`group-title="${escapeAttribute(channel.group)}"`);
      }

      lines.push(`#EXTINF:-1 ${attrs.join(" ")},${channel.name}`);
      const playSourceIndex = sources[sourceIndex]?.sourceIndex ?? sourceIndex;
      lines.push(`${cleanBaseUrl}/play/${encodeURIComponent(channel.id)}?source=${playSourceIndex}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

export function generateLiveTxt(channels, baseUrl, categories = ["推荐频道"]) {
  const cleanBaseUrl = String(baseUrl || "").replace(/\/$/, "");
  const normalizedCategories = Array.from(new Set(["推荐频道", ...categories].map((category) => escapeLiveValue(category)).filter(Boolean)));
  const lines = [];

  for (const category of normalizedCategories) {
    const channelLines = channels
      .filter((channel) => getChannelGroups(channel).includes(category))
      .map((channel) => {
        const joinedUrls = buildPlayUrls(channel, cleanBaseUrl).join("#");
        return `${escapeLiveValue(channel.name)},${joinedUrls}`;
      });

    if (channelLines.length > 0) {
      lines.push(`${category},#genre#`, ...channelLines);
    }
  }

  return `${lines.join("\n")}\n`;
}

export function generateLiveM3u(channels, baseUrl) {
  const cleanBaseUrl = String(baseUrl || "").replace(/\/$/, "");
  const lines = ['#EXTM3U x-tvg-url="https://live.fanmingming.com/e.xml"'];

  for (const channel of channels) {
    const channelName = escapeLiveValue(channel.name);
    const logo = channel.logo || `https://live.fanmingming.com/tv/${channelName}.png`;
    const attrs = [
      `tvg-name="${escapeAttribute(channelName)}"`,
      `tvg-logo="${escapeAttribute(logo)}"`,
      `group-title="${escapeAttribute(getChannelGroups(channel)[0] || "")}"`
    ];

    lines.push(`#EXTINF:-1 ${attrs.join(" ")},${channelName}`);
    lines.push(buildPlayUrls(channel, cleanBaseUrl).join("#"));
  }

  return `${lines.join("\n")}\n`;
}
