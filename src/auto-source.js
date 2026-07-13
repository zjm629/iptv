function todayInShanghai(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function stripTags(value = "") {
  return String(value).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function parseTableRows(html = "") {
  const rows = [];
  const rowPattern = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch;

  while ((rowMatch = rowPattern.exec(String(html))) !== null) {
    const rowHtml = rowMatch[1];
    const cellMatches = Array.from(rowHtml.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi));
    if (cellMatches.length < 6) {
      continue;
    }

    const linkHtml = cellMatches[0][1];
    const gotoMatch = linkHtml.match(/gotoIP\('([^']+)'\s*,\s*'([^']+)'\)/);
    if (!gotoMatch) {
      continue;
    }

    rows.push({
      token: gotoMatch[1],
      sourceType: gotoMatch[2],
      ip: stripTags(linkHtml),
      channelCount: stripTags(cellMatches[1][1]),
      typeName: stripTags(cellMatches[2][1]),
      onlineAt: stripTags(cellMatches[3][1]),
      updatedAt: stripTags(cellMatches[4][1]),
      status: stripTags(cellMatches[5][1])
    });
  }

  return rows;
}

function normalizeAutoSourceConfig(value = {}) {
  const keywords = Array.isArray(value.keywords)
    ? value.keywords
    : String(value.keywords || "电信").split(/[,，\n]/);
  const disabledTypeNames = Array.isArray(value.disabledTypeNames)
    ? value.disabledTypeNames
    : String(value.disabledTypeNames || "").split(/[,，\n]/);

  return {
    enabled: value.enabled === true,
    pageUrl: String(value.pageUrl || "https://iptv.cqshushu.com/index.php").trim(),
    keywords: Array.from(new Set(keywords.map((keyword) => String(keyword || "").trim()).filter(Boolean))),
    disabledTypeNames: Array.from(new Set(disabledTypeNames.map((name) => String(name || "").trim()).filter(Boolean))),
    todayOnly: value.todayOnly !== false,
    onlyStatus: String(value.onlyStatus || "新上线").trim(),
    uniqueByType: value.uniqueByType !== false,
    maxPages: Math.max(1, Math.min(20, Number.parseInt(value.maxPages || "20", 10) || 20))
  };
}

function buildPageUrl(pageUrl, page) {
  const url = new URL(pageUrl);
  if (!url.searchParams.has("t")) {
    url.searchParams.set("t", "all");
  }
  if (!url.searchParams.has("province")) {
    url.searchParams.set("province", "all");
  }
  if (!url.searchParams.has("limit")) {
    url.searchParams.set("limit", "10");
  }
  url.searchParams.set("page", String(page));
  return url.toString();
}

function buildM3uUrl(pageUrl, row) {
  const url = new URL(pageUrl);
  url.search = "";
  url.searchParams.set("s", row.token);
  url.searchParams.set("t", row.sourceType);
  url.searchParams.set("channels", "1");
  url.searchParams.set("format", "m3u");
  return url.toString();
}

function filterRows(rows, config, now = new Date()) {
  const today = todayInShanghai(now);
  const seenTypes = new Set();
  const disabledTypes = new Set(config.disabledTypeNames || []);
  const filtered = [];

  for (const row of rows) {
    if (config.keywords.length > 0 && !config.keywords.some((keyword) => row.typeName.includes(keyword))) {
      continue;
    }

    if (config.onlyStatus && row.status !== config.onlyStatus) {
      continue;
    }

    if (config.todayOnly && !row.updatedAt.startsWith(today)) {
      continue;
    }

    if (disabledTypes.has(row.typeName)) {
      continue;
    }

    if (config.uniqueByType && seenTypes.has(row.typeName)) {
      continue;
    }

    seenTypes.add(row.typeName);
    filtered.push(row);
  }

  return filtered;
}

export async function discoverAutoSources(configValue = {}, options = {}) {
  const config = normalizeAutoSourceConfig(configValue);
  if (!config.enabled) {
    return { config, sources: [], rows: [], pages: [] };
  }

  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const now = options.now || new Date();
  const rows = [];
  const pages = [];

  for (let page = 1; page <= config.maxPages; page += 1) {
    const url = buildPageUrl(config.pageUrl, page);
    const response = await fetchImpl(url, {
      headers: {
        "user-agent": "Mozilla/5.0 IPTV-M3U-Manager/1.0",
        "accept": "text/html,*/*"
      }
    });
    if (!response.ok) {
      throw new Error(`Auto source page HTTP ${response.status}`);
    }

    const html = await response.text();
    const pageRows = parseTableRows(html);
    pages.push({ page, url, rows: pageRows.length });
    rows.push(...pageRows);

    if (!html.includes("下一页") || pageRows.length === 0) {
      break;
    }
  }

  const selectedRows = filterRows(rows, config, now);
  const sources = selectedRows.map((row) => ({
    name: `自动-${row.typeName}`,
    url: buildM3uUrl(config.pageUrl, row),
    auto: true,
    typeName: row.typeName,
    updatedAt: row.updatedAt,
    status: row.status
  }));

  return { config, sources, rows: selectedRows, pages };
}

export { filterRows, normalizeAutoSourceConfig, parseTableRows, todayInShanghai };
