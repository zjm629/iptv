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

function parseBoundedInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);
  const number = Number.isFinite(parsed) ? parsed : fallback;
  return Math.max(min, Math.min(max, number));
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
    maxPages: parseBoundedInteger(value.maxPages ?? "20", 20, 1, 20),
    pageDelayMs: parseBoundedInteger(value.pageDelayMs ?? "1500", 1500, 0, 5000),
    rateLimitRetries: parseBoundedInteger(value.rateLimitRetries ?? "2", 2, 0, 5),
    rateLimitDelayMs: parseBoundedInteger(value.rateLimitDelayMs ?? "5000", 5000, 0, 30000),
    resolveDetailUrls: value.resolveDetailUrls !== false
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

function buildChallengeUrl(pageUrl) {
  const url = new URL(pageUrl);
  url.searchParams.set("_js_challenge", "1");
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

function buildDetailUrl(pageUrl, row) {
  const url = new URL(pageUrl);
  url.search = "";
  url.searchParams.set("p", row.token);
  url.searchParams.set("t", row.sourceType);
  return url.toString();
}

function decodeHtmlEntities(value = "") {
  return String(value)
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function normalizeM3uUrl(pageUrl, value) {
  if (!value) {
    return "";
  }
  const url = new URL(decodeHtmlEntities(value), buildBaseIndexUrl(pageUrl));
  if (!url.searchParams.has("s") || !url.searchParams.has("t")) {
    return "";
  }
  url.searchParams.set("channels", "1");
  url.searchParams.set("format", "m3u");
  return url.toString();
}

function parseDetailM3uUrl(html = "", pageUrl = "https://iptv.cqshushu.com/index.php") {
  const source = String(html);
  const attributePattern = /(?:href|value|data-url)=["']([^"']*\?s=[^"']*)["']/gi;
  for (const match of source.matchAll(attributePattern)) {
    const url = normalizeM3uUrl(pageUrl, match[1]);
    if (url) {
      return url;
    }
  }

  const inlinePattern = /(https?:\/\/[^"'<> \n]+\/index\.php\?[^"'<> \n]*s=[^"'<> \n]*|\?s=[^"'<> \n]*)/gi;
  for (const match of source.matchAll(inlinePattern)) {
    const url = normalizeM3uUrl(pageUrl, match[1]);
    if (url) {
      return url;
    }
  }

  return "";
}

async function fetchDiscoveryPage(fetchImpl, url, config) {
  const cookieHeader = config.cookieJar?.header();
  return fetchImpl(url, {
    redirect: "manual",
    headers: {
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 IPTV-M3U-Manager/1.0",
      "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "accept-language": "zh-CN,zh;q=0.9",
      "referer": config.pageUrl,
      ...(cookieHeader ? { cookie: cookieHeader } : {})
    }
  });
}

function createCookieJar() {
  const cookies = new Map();

  function add(value) {
    const pair = String(value || "").split(";")[0];
    const equalsIndex = pair.indexOf("=");
    if (equalsIndex <= 0) {
      return;
    }
    cookies.set(pair.slice(0, equalsIndex), pair.slice(equalsIndex + 1));
  }

  return {
    store(headers) {
      if (!headers) {
        return;
      }
      if (typeof headers.getSetCookie === "function") {
        for (const value of headers.getSetCookie()) {
          add(value);
        }
      }
      const combined = typeof headers.get === "function" ? headers.get("set-cookie") : null;
      if (combined) {
        for (const value of combined.split(/,(?=[^;,]+=)/)) {
          add(value);
        }
      }
    },
    header() {
      return Array.from(cookies, ([name, value]) => `${name}=${value}`).join("; ");
    },
    set(name, value) {
      if (name) {
        cookies.set(name, value);
      }
    }
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithSession(fetchImpl, url, requestConfig) {
  let response = await fetchDiscoveryPage(fetchImpl, url, requestConfig);
  requestConfig.cookieJar.store(response.headers);
  if (response.status === 403 && url.includes("?")) {
    const challengeUrl = buildChallengeUrl(url);
    const challengeResponse = await fetchDiscoveryPage(fetchImpl, challengeUrl, requestConfig);
    requestConfig.cookieJar.store(challengeResponse.headers);
    if (challengeResponse.status >= 300 && challengeResponse.status < 400) {
      response = await fetchDiscoveryPage(fetchImpl, url, requestConfig);
      requestConfig.cookieJar.store(response.headers);
    }
  }
  return response;
}

async function fetchHtmlWithSession(fetchImpl, url, requestConfig) {
  let response = await fetchWithSession(fetchImpl, url, requestConfig);
  if (!response.ok) {
    return { response, html: "" };
  }

  let html = await response.text();
  if (!html.includes("ad_verify.php")) {
    return { response, html };
  }

  const verifyUrl = new URL("/ad_verify.php", url).toString();
  const verifyResponse = await fetchDiscoveryPage(fetchImpl, verifyUrl, requestConfig);
  const verifyHtml = await verifyResponse.text();
  if (verifyHtml.includes("__ad_ok=1")) {
    requestConfig.cookieJar.set("ad_ok", "1");
  }

  response = await fetchWithSession(fetchImpl, url, requestConfig);
  html = response.ok ? await response.text() : "";
  return { response, html };
}

async function ensureAdVerification(fetchImpl, pageUrl, requestConfig) {
  try {
    const verifyUrl = new URL("/ad_verify.php", pageUrl).toString();
    const response = await fetchDiscoveryPage(fetchImpl, verifyUrl, requestConfig);
    const html = await response.text();
    if (html.includes("__ad_ok=1")) {
      requestConfig.cookieJar.set("ad_ok", "1");
    }
  } catch (_error) {
    // Detail pages can still fall back to their own verification flow.
  }
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
  const sleepImpl = options.sleepImpl || sleep;
  const now = options.now || new Date();
  const rows = [];
  const pages = [];
  const warnings = [];
  let useFallbackBase = false;
  const cookieJar = createCookieJar();
  const requestConfig = { ...config, cookieJar };

  for (let page = 1; page <= config.maxPages; page += 1) {
    if (page > 1 && config.pageDelayMs > 0) {
      await sleepImpl(config.pageDelayMs);
    }
    const url = buildPageUrl(useFallbackBase ? buildBaseIndexUrl(config.pageUrl) : config.pageUrl, page);
    if (!url) {
      break;
    }
    let response = await fetchWithSession(fetchImpl, url, requestConfig);
    for (let attempt = 0; response.status === 429 && attempt < config.rateLimitRetries; attempt += 1) {
      if (config.rateLimitDelayMs > 0) {
        await sleepImpl(config.rateLimitDelayMs * (attempt + 1));
      }
      response = await fetchWithSession(fetchImpl, url, requestConfig);
    }
    let effectiveUrl = url;
    if (!response.ok && page === 1 && new URL(config.pageUrl).search) {
      const fallbackUrl = buildBaseIndexUrl(config.pageUrl);
      response = await fetchWithSession(fetchImpl, fallbackUrl, requestConfig);
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
  if (config.resolveDetailUrls && selectedRows.length > 0) {
    await ensureAdVerification(fetchImpl, config.pageUrl, requestConfig);
  }
  const sources = [];
  for (const row of selectedRows) {
    let sourceUrl = buildM3uUrl(config.pageUrl, row);
    if (config.resolveDetailUrls) {
      const detailUrl = buildDetailUrl(config.pageUrl, row);
      const detail = await fetchHtmlWithSession(fetchImpl, detailUrl, requestConfig);
      const detailM3uUrl = detail.response.ok ? parseDetailM3uUrl(detail.html, config.pageUrl) : "";
      if (detailM3uUrl) {
        sourceUrl = detailM3uUrl;
      } else {
        warnings.push(`详情页未取到 ${row.typeName} 的真实 M3U 地址，已使用列表地址兜底。`);
      }
    }
    sources.push({
      name: `自动-${row.typeName}`,
      url: sourceUrl,
      auto: true,
      typeName: row.typeName,
      updatedAt: row.updatedAt,
      status: row.status
    });
  }

  return { config, sources, rows: selectedRows, pages, warnings };
}

export { filterRows, normalizeAutoSourceConfig, parseTableRows, todayInShanghai };
