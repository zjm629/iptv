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
    startPage: parseBoundedInteger(value.startPage ?? "1", 1, 1, 200),
    maxPages: parseBoundedInteger(value.maxPages ?? "20", 20, 1, 20),
    pageDelayMs: parseBoundedInteger(value.pageDelayMs ?? "1500", 1500, 0, 5000),
    rateLimitRetries: parseBoundedInteger(value.rateLimitRetries ?? "2", 2, 0, 5),
    rateLimitDelayMs: parseBoundedInteger(value.rateLimitDelayMs ?? "5000", 5000, 0, 30000),
    detailDelayMs: parseBoundedInteger(value.detailDelayMs ?? "1200", 1200, 0, 10000),
    detailRetries: parseBoundedInteger(value.detailRetries ?? "1", 1, 0, 3),
    detailRetryDelayMs: parseBoundedInteger(value.detailRetryDelayMs ?? "5000", 5000, 0, 30000),
    requestTimeoutMs: parseBoundedInteger(value.requestTimeoutMs ?? "15000", 15000, 1, 120000),
    resolveDetailUrls: value.resolveDetailUrls !== false,
    validateM3uUrls: value.validateM3uUrls !== false
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

function normalizeCompleteM3uUrl(pageUrl, value) {
  if (!value) {
    return "";
  }
  const url = new URL(decodeHtmlEntities(value), buildBaseIndexUrl(pageUrl));
  if (!url.searchParams.has("s") || !url.searchParams.has("t")) {
    return "";
  }
  if (url.searchParams.get("format") !== "m3u") {
    return "";
  }
  if (url.searchParams.get("channels") !== "1") {
    return "";
  }
  return url.toString();
}

function readSourceToken(pageUrl, value) {
  if (!value) {
    return "";
  }
  try {
    const url = new URL(decodeHtmlEntities(value), buildBaseIndexUrl(pageUrl));
    return url.searchParams.get("s") || "";
  } catch (_error) {
    return "";
  }
}

function normalizeChannelListUrl(pageUrl, value) {
  if (!value) {
    return "";
  }
  const url = new URL(decodeHtmlEntities(value), buildBaseIndexUrl(pageUrl));
  if (!url.searchParams.has("s") || !url.searchParams.has("t")) {
    return "";
  }
  return url.toString();
}

function readAttribute(tag, name) {
  const pattern = new RegExp(`${name}\\s*=\\s*["']([^"']*)["']`, "i");
  const match = String(tag || "").match(pattern);
  return match ? match[1] : "";
}

function readCopyToClipboardUrl(tag) {
  const match = String(tag || "").match(/copyToClipboard\(["']([^"']+)["']\)/i);
  return match ? decodeHtmlEntities(match[1]) : "";
}

function isChannelListLink(label) {
  const text = stripTags(decodeHtmlEntities(label));
  return text.includes("查看频道列表") || text.includes("频道列表");
}

function isM3uInterfaceLink(label) {
  const text = stripTags(decodeHtmlEntities(label));
  return /M3U\s*接口/i.test(text);
}

function parseDetailChannelListUrl(html = "", pageUrl = "https://iptv.cqshushu.com/index.php") {
  const source = String(html);
  const anchorPattern = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  for (const match of source.matchAll(anchorPattern)) {
    const href = readAttribute(match[1], "href");
    const label = `${match[1]} ${match[2]}`;
    const isPlayButton = /\bbtn-play\b/.test(match[1]) || /\bdownload-btn\s+m3u\b/.test(match[1]);
    if (isPlayButton || isChannelListLink(label)) {
      const url = normalizeChannelListUrl(pageUrl, href);
      if (url) {
        return url;
      }
    }
  }
  return "";
}

function parseChannelListM3uUrl(html = "", pageUrl = "https://iptv.cqshushu.com/index.php", expectedToken = "") {
  const source = String(html);
  const anchorPattern = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  for (const match of source.matchAll(anchorPattern)) {
    const label = `${match[1]} ${match[2]}`;
    if (!isM3uInterfaceLink(label)) {
      continue;
    }

    const clickMatch = match[1].match(/copyToClipboard\(["']([^"']+)["']\)/i);
    const copiedUrl = normalizeCompleteM3uUrl(pageUrl, clickMatch?.[1] || "");
    if (copiedUrl && (!expectedToken || readSourceToken(pageUrl, copiedUrl) === expectedToken)) {
      return copiedUrl;
    }

    const hrefUrl = normalizeCompleteM3uUrl(pageUrl, readAttribute(match[1], "href"));
    if (hrefUrl && (!expectedToken || readSourceToken(pageUrl, hrefUrl) === expectedToken)) {
      return hrefUrl;
    }
  }

  const inlinePattern = /(https?:\/\/[^"'<> \n]+\/index\.php\?[^"'<> \n]*format=m3u[^"'<> \n]*|\?s=[^"'<> \n]*format=m3u[^"'<> \n]*)/gi;
  for (const match of source.matchAll(inlinePattern)) {
    const url = normalizeCompleteM3uUrl(pageUrl, match[1]);
    if (url && (!expectedToken || readSourceToken(pageUrl, url) === expectedToken)) {
      return url;
    }
  }

  return "";
}

function summarizeTokenAnchors(html = "", pageUrl = "https://iptv.cqshushu.com/index.php", expectedToken = "") {
  const anchors = [];
  const anchorPattern = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  for (const match of String(html).matchAll(anchorPattern)) {
    const href = readAttribute(match[1], "href");
    const copied = readCopyToClipboardUrl(match[1]);
    const candidate = copied || href;
    const normalizedM3u = normalizeCompleteM3uUrl(pageUrl, candidate);
    const token = readSourceToken(pageUrl, candidate);
    const text = stripTags(decodeHtmlEntities(match[2]));
    const title = readAttribute(match[1], "title");
    if (!href.includes("?s=") && !copied.includes("?s=") && !text.includes("M3U") && !title.includes("M3U")) {
      continue;
    }
    anchors.push({
      text,
      title,
      href,
      copied,
      token,
      isPlayButton: /\bbtn-play\b/.test(match[1]),
      isM3uInterface: isM3uInterfaceLink(`${match[1]} ${match[2]}`),
      normalizedM3u,
      matchesExpectedToken: Boolean(expectedToken && token === expectedToken)
    });
  }
  return anchors;
}

function formatFetchError(error, config) {
  if (error?.name === "AbortError") {
    return `Request timed out after ${config.requestTimeoutMs} ms`;
  }
  return error?.message || String(error);
}

async function fetchWithTimeout(fetchImpl, url, options, timeoutMs) {
  if (!timeoutMs || typeof AbortController === "undefined") {
    return fetchImpl(url, options);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchDiscoveryPage(fetchImpl, url, config) {
  const cookieHeader = config.cookieJar?.header();
  return fetchWithTimeout(fetchImpl, url, {
    redirect: "manual",
    headers: {
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 IPTV-M3U-Manager/1.0",
      "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "accept-language": "zh-CN,zh;q=0.9",
      "referer": config.pageUrl,
      ...(cookieHeader ? { cookie: cookieHeader } : {})
    }
  }, config.requestTimeoutMs);
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

function isTransientDiscoveryStatus(status) {
  return [429, 502, 503, 504].includes(status);
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

async function resolveDetailM3uUrl(fetchImpl, row, requestConfig, sleepImpl) {
  const detailUrl = buildDetailUrl(requestConfig.pageUrl, row);
  for (let attempt = 0; attempt <= requestConfig.detailRetries; attempt += 1) {
    if (attempt > 0 && requestConfig.detailRetryDelayMs > 0) {
      await sleepImpl(requestConfig.detailRetryDelayMs * attempt);
    }
    let detail;
    try {
      detail = await fetchHtmlWithSession(fetchImpl, detailUrl, requestConfig);
    } catch (_error) {
      continue;
    }
    const channelListUrl = detail.response.ok ? parseDetailChannelListUrl(detail.html, requestConfig.pageUrl) : "";
    if (!channelListUrl) {
      continue;
    }

    let channelList;
    try {
      channelList = await fetchHtmlWithSession(fetchImpl, channelListUrl, requestConfig);
    } catch (_error) {
      continue;
    }
    const expectedToken = readSourceToken(requestConfig.pageUrl, channelListUrl);
    const m3uUrl = channelList.response.ok ? parseChannelListM3uUrl(channelList.html, requestConfig.pageUrl, expectedToken) : "";
    if (m3uUrl) {
      return m3uUrl;
    }
  }
  return "";
}

async function checkM3uUrl(fetchImpl, url, referer, requestConfig) {
  try {
    const cookieHeader = requestConfig.cookieJar?.header();
    const response = await fetchWithTimeout(fetchImpl, url, {
      headers: {
        "user-agent": "Mozilla/5.0 IPTV-M3U-Manager/1.0",
        "accept": "*/*",
        "referer": referer || requestConfig.pageUrl,
        ...(cookieHeader ? { cookie: cookieHeader } : {})
      }
    }, requestConfig.requestTimeoutMs);
    if (!response.ok) {
      return { ok: false, status: response.status, channelLines: 0 };
    }
    const text = await response.text();
    return {
      ok: true,
      status: response.status,
      channelLines: (text.match(/#EXTINF/g) || []).length
    };
  } catch (error) {
    return { ok: false, error: formatFetchError(error, requestConfig), channelLines: 0 };
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

  const endPage = config.startPage + config.maxPages - 1;
  for (let page = config.startPage; page <= endPage; page += 1) {
    if (page > config.startPage && config.pageDelayMs > 0) {
      await sleepImpl(config.pageDelayMs);
    }
    const url = buildPageUrl(useFallbackBase ? buildBaseIndexUrl(config.pageUrl) : config.pageUrl, page);
    if (!url) {
      break;
    }
    let response;
    try {
      response = await fetchWithSession(fetchImpl, url, requestConfig);
      for (let attempt = 0; isTransientDiscoveryStatus(response.status) && attempt < config.rateLimitRetries; attempt += 1) {
        if (config.rateLimitDelayMs > 0) {
          await sleepImpl(config.rateLimitDelayMs * (attempt + 1));
        }
        response = await fetchWithSession(fetchImpl, url, requestConfig);
      }
    } catch (error) {
      pages.push({ page, url, rows: 0, error: formatFetchError(error, requestConfig) });
      warnings.push(`第 ${page} 页采集失败：${formatFetchError(error, requestConfig)}`);
      break;
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
  const seenSourceUrls = new Set();
  let skippedWithoutDetailUrl = 0;
  let skippedDuplicateUrls = 0;
  let skippedEmptyM3uUrls = 0;
  let detailIndex = 0;
  for (const row of selectedRows) {
    let sourceUrl = buildM3uUrl(config.pageUrl, row);
    let resolvedFromDetail = false;
    if (config.resolveDetailUrls) {
      if (detailIndex > 0 && config.detailDelayMs > 0) {
        await sleepImpl(config.detailDelayMs);
      }
      detailIndex += 1;
      const detailM3uUrl = await resolveDetailM3uUrl(fetchImpl, row, requestConfig, sleepImpl);
      if (detailM3uUrl) {
        sourceUrl = detailM3uUrl;
        resolvedFromDetail = true;
      } else {
        skippedWithoutDetailUrl += 1;
        continue;
      }
    }
    if (config.validateM3uUrls && resolvedFromDetail) {
      const m3uCheck = await checkM3uUrl(fetchImpl, sourceUrl, config.pageUrl, requestConfig);
      if (!m3uCheck.ok || m3uCheck.channelLines <= 0) {
        skippedEmptyM3uUrls += 1;
        continue;
      }
    }
    if (seenSourceUrls.has(sourceUrl)) {
      skippedDuplicateUrls += 1;
      continue;
    }
    seenSourceUrls.add(sourceUrl);
    sources.push({
      name: `自动-${row.typeName}`,
      url: sourceUrl,
      auto: true,
      ip: row.ip,
      channelCount: row.channelCount,
      typeName: row.typeName,
      onlineAt: row.onlineAt,
      updatedAt: row.updatedAt,
      status: row.status
    });
  }
  if (skippedWithoutDetailUrl > 0) {
    warnings.push(`已跳过 ${skippedWithoutDetailUrl} 个未取到真实 M3U 的源。`);
  }
  if (skippedDuplicateUrls > 0) {
    warnings.push(`已跳过 ${skippedDuplicateUrls} 个重复 M3U 地址。`);
  }
  if (skippedEmptyM3uUrls > 0) {
    warnings.push(`已跳过 ${skippedEmptyM3uUrls} 个无频道 M3U 地址。`);
  }

  return { config, sources, rows: selectedRows, pages, warnings };
}

export async function debugAutoSourceByIp(configValue = {}, targetIp = "", options = {}) {
  const config = normalizeAutoSourceConfig({ ...configValue, enabled: true });
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const sleepImpl = options.sleepImpl || sleep;
  const now = options.now || new Date();
  const cookieJar = createCookieJar();
  const requestConfig = { ...config, cookieJar };
  const pages = [];
  const rows = [];

  const endPage = config.startPage + config.maxPages - 1;
  for (let page = config.startPage; page <= endPage; page += 1) {
    const url = buildPageUrl(config.pageUrl, page);
    if (!url) {
      break;
    }
    let response;
    try {
      response = await fetchWithSession(fetchImpl, url, requestConfig);
      for (let attempt = 0; isTransientDiscoveryStatus(response.status) && attempt < config.rateLimitRetries; attempt += 1) {
        if (config.rateLimitDelayMs > 0) {
          await sleepImpl(config.rateLimitDelayMs * (attempt + 1));
        }
        response = await fetchWithSession(fetchImpl, url, requestConfig);
      }
    } catch (error) {
      pages.push({ page, url, rows: 0, error: formatFetchError(error, requestConfig) });
      break;
    }
    if (!response.ok) {
      pages.push({ page, url, rows: 0, error: `HTTP ${response.status}` });
      break;
    }
    const html = await response.text();
    const pageRows = parseTableRows(html);
    pages.push({ page, url, rows: pageRows.length });
    rows.push(...pageRows);
    if (pageRows.some((row) => row.ip === targetIp) || !html.includes("下一页")) {
      break;
    }
  }

  const row = rows.find((item) => item.ip === targetIp) || null;
  const result = { config, targetIp, today: todayInShanghai(now), pages, row };
  if (!row) {
    return result;
  }

  await ensureAdVerification(fetchImpl, config.pageUrl, requestConfig);
  const detailUrl = buildDetailUrl(config.pageUrl, row);
  let detail;
  try {
    detail = await fetchHtmlWithSession(fetchImpl, detailUrl, requestConfig);
  } catch (error) {
    result.detail = {
      url: detailUrl,
      status: 0,
      error: formatFetchError(error, requestConfig),
      channelListUrl: "",
      expectedToken: "",
      anchors: []
    };
    return result;
  }
  const channelListUrl = detail.response.ok ? parseDetailChannelListUrl(detail.html, config.pageUrl) : "";
  const expectedToken = readSourceToken(config.pageUrl, channelListUrl);
  result.detail = {
    url: detailUrl,
    status: detail.response.status,
    channelListUrl,
    expectedToken,
    anchors: summarizeTokenAnchors(detail.html, config.pageUrl, expectedToken)
  };

  if (!channelListUrl) {
    return result;
  }

  let channelList;
  try {
    channelList = await fetchHtmlWithSession(fetchImpl, channelListUrl, requestConfig);
  } catch (error) {
    result.channelList = {
      url: channelListUrl,
      status: 0,
      error: formatFetchError(error, requestConfig),
      anchors: [],
      selectedM3uUrl: ""
    };
    return result;
  }
  const selectedM3uUrl = channelList.response.ok ? parseChannelListM3uUrl(channelList.html, config.pageUrl, expectedToken) : "";
  result.channelList = {
    url: channelListUrl,
    status: channelList.response.status,
    anchors: summarizeTokenAnchors(channelList.html, config.pageUrl, expectedToken),
    selectedM3uUrl
  };

  if (selectedM3uUrl) {
    try {
      const m3uResponse = await fetchWithTimeout(fetchImpl, selectedM3uUrl, {
        headers: {
          "user-agent": "Mozilla/5.0 IPTV-M3U-Manager/1.0",
          "accept": "*/*",
          "referer": channelListUrl
        }
      }, requestConfig.requestTimeoutMs);
      const text = await m3uResponse.text();
      result.m3uCheck = {
        url: selectedM3uUrl,
        status: m3uResponse.status,
        bytes: text.length,
        channelLines: (text.match(/#EXTINF/g) || []).length,
        head: text.slice(0, 160)
      };
    } catch (error) {
      result.m3uCheck = {
        url: selectedM3uUrl,
        status: 0,
        error: formatFetchError(error, requestConfig),
        bytes: 0,
        channelLines: 0,
        head: ""
      };
    }
  }

  return result;
}

export { filterRows, normalizeAutoSourceConfig, parseTableRows, todayInShanghai };
