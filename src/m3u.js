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
    lines.push(`${cleanBaseUrl}/play/${encodeURIComponent(channel.id)}`);
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
      lines.push(`${cleanBaseUrl}/play/${encodeURIComponent(channel.id)}?source=${sourceIndex}`);
    }
  }

  return `${lines.join("\n")}\n`;
}
