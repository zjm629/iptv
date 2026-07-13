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
  if (page === 1) {
    return url.toString();
  }
  if (!url.search && !url.searchParams.has("page")) {
    return null;
  }
  url.searchParams.set("page", String(page));
  return url.toString();
}

function buildBaseIndexUrl(pageUrl) {
  const url = new URL(pageUrl);
  url.search = "";
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

async function fetchDiscoveryPage(fetchImpl, url, config) {
  return fetchImpl(url, {
    headers: {
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 IPTV-M3U-Manager/1.0",
      "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "accept-language": "zh-CN,zh;q=0.9",
      "referer": config.pageUrl
    }
  });
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
  const warnings = [];
  let useFallbackBase = false;

  for (let page = 1; page <= config.maxPages; page += 1) {
    const url = buildPageUrl(useFallbackBase ? buildBaseIndexUrl(config.pageUrl) : config.pageUrl, page);
    if (!url) {
      break;
    }
    let response = await fetchDiscoveryPage(fetchImpl, url, config);
    let effectiveUrl = url;
    if (!response.ok && page === 1 && new URL(config.pageUrl).search) {
      const fallbackUrl = buildBaseIndexUrl(config.pageUrl);
      response = await fetchDiscoveryPage(fetchImpl, fallbackUrl, config);
      effectiveUrl = fallbackUrl;
      useFallbackBase = true;
      warnings.push("目标搜索页被安全验证拦截，已改用首页兜底采集。");
    }
    if (!response.ok) {
      pages.push({ page, url: effectiveUrl, rows: 0, error: `HTTP ${response.status}` });
      warnings.push(`第 ${page} 页采集失败：HTTP ${response.status}`);
      break;
    }

    const html = await response.text();
    const pageRows = parseTableRows(html);
    pages.push({ page, url: effectiveUrl, rows: pageRows.length });
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

  return { config, sources, rows: selectedRows, pages, warnings };
}

export { filterRows, normalizeAutoSourceConfig, parseTableRows, todayInShanghai };
