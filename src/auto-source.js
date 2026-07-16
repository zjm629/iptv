import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

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
    pageDelayMs: parseBoundedInteger(value.pageDelayMs ?? "3000", 3000, 0, 10000),
    rateLimitRetries: parseBoundedInteger(value.rateLimitRetries ?? "2", 2, 0, 5),
    rateLimitDelayMs: parseBoundedInteger(value.rateLimitDelayMs ?? "30000", 30000, 0, 300000),
    detailDelayMs: parseBoundedInteger(value.detailDelayMs ?? "3000", 3000, 0, 30000),
    detailInitialDelayMs: parseBoundedInteger(value.detailInitialDelayMs ?? "8000", 8000, 0, 60000),
    detailRetries: parseBoundedInteger(value.detailRetries ?? "1", 1, 0, 3),
    detailRetryDelayMs: parseBoundedInteger(value.detailRetryDelayMs ?? "15000", 15000, 0, 60000),
    m3uCheckRetries: parseBoundedInteger(value.m3uCheckRetries ?? "2", 2, 0, 5),
    m3uCheckRetryDelayMs: parseBoundedInteger(value.m3uCheckRetryDelayMs ?? "5000", 5000, 0, 30000),
    emptyM3uResolveRetries: parseBoundedInteger(value.emptyM3uResolveRetries ?? "0", 0, 0, 5),
    emptyM3uResolveDelayMs: parseBoundedInteger(value.emptyM3uResolveDelayMs ?? "8000", 8000, 0, 60000),
    requestTimeoutMs: parseBoundedInteger(value.requestTimeoutMs ?? "15000", 15000, 1, 120000),
    browserFetch: value.browserFetch === true || process.env.COLLECTOR_BROWSER_FETCH === "true",
    browserTimeoutMs: parseBoundedInteger(value.browserTimeoutMs ?? "25000", 25000, 1000, 120000),
    browserProfile: value.browserProfile !== false,
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

function isBaseIndexUrl(pageUrl, value = "") {
  if (!value) {
    return false;
  }
  try {
    const url = new URL(value, buildBaseIndexUrl(pageUrl));
    const baseUrl = new URL(buildBaseIndexUrl(pageUrl));
    return url.origin === baseUrl.origin &&
      url.pathname === baseUrl.pathname &&
      !url.search;
  } catch (_error) {
    return false;
  }
}

function buildChallengeUrl(pageUrl) {
  const url = new URL(pageUrl);
  url.searchParams.set("_js_challenge", "1");
  return url.toString();
}

function browserCookiesFromHeader(cookieHeader = "", targetUrl = "https://iptv.cqshushu.com/index.php") {
  if (!cookieHeader) {
    return [];
  }
  const url = new URL(targetUrl);
  const baseUrl = `${url.protocol}//${url.hostname}/`;
  return String(cookieHeader)
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const equalsIndex = part.indexOf("=");
      if (equalsIndex <= 0) {
        return null;
      }
      return {
        name: part.slice(0, equalsIndex).trim(),
        value: part.slice(equalsIndex + 1).trim(),
        domain: url.hostname,
        path: "/",
        url: baseUrl
      };
    })
    .filter((cookie) => cookie && cookie.name);
}

async function seedBrowserCookies(client, sessionId, targetUrl, requestConfig, commandTimeoutMs) {
  const cookies = browserCookiesFromHeader(requestConfig.cookieJar?.header?.() || "", targetUrl);
  if (cookies.length === 0) {
    return 0;
  }
  await client.send("Network.enable", {}, sessionId, commandTimeoutMs);
  for (const cookie of cookies) {
    await client.send("Network.setCookie", cookie, sessionId, commandTimeoutMs);
  }
  return cookies.length;
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

function normalizeM3uUrlFromChannelList(pageUrl, value) {
  const urlValue = normalizeM3uUrl(pageUrl, value);
  if (!urlValue) {
    return "";
  }
  const url = new URL(urlValue);
  if (url.hostname === "iptv.cqshushu.com") {
    url.protocol = "http:";
  }
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

function hasChannelListText(value = "") {
  const text = stripTags(decodeHtmlEntities(value));
  return text.includes("\u67e5\u770b\u9891\u9053\u5217\u8868") ||
    text.includes("\u9891\u9053\u5217\u8868") ||
    /channel\s*list/i.test(text) ||
    isChannelListLink(text);
}

function chooseChannelListCandidate(candidates = [], preferredUrl = "") {
  const preferredToken = readSourceToken("https://iptv.cqshushu.com/index.php", preferredUrl);
  const scored = candidates.map((candidate, index) => {
    const href = String(candidate.href || "");
    const text = String(candidate.text || "");
    const title = String(candidate.title || "");
    const isChannelText = hasChannelListText(`${text} ${title}`);
    const token = readSourceToken("https://iptv.cqshushu.com/index.php", href);
    const score =
      (candidate.visible ? 200 : 0) +
      (isChannelText ? 100 : 0) +
      (token ? 30 : 0) +
      (preferredToken && token === preferredToken ? 5 : 0);
    return { ...candidate, index, score, isChannelText, token };
  }).filter((candidate) => candidate.score > 0);

  scored.sort((left, right) => right.score - left.score || left.index - right.index);
  return scored[0] || null;
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
    const labelText = stripTags(decodeHtmlEntities(label));
    const isChannelList = hasChannelListText(labelText) || isChannelListLink(label);
    if (isChannelList) {
      const url = normalizeChannelListUrl(pageUrl, href);
      if (url) {
        return url;
      }
    }
  }
  return "";
}

function chooseActualChannelListUrl(pageUrl, parsedUrl = "", finalUrl = "") {
  return normalizeChannelListUrl(pageUrl, finalUrl) || parsedUrl;
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

function summarizeHtmlPage(html = "") {
  const source = String(html || "");
  const title = stripTags(decodeHtmlEntities((source.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || "")).trim();
  const bodyHtml = (source.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i) || [])[1] || source;
  const text = stripTags(decodeHtmlEntities(bodyHtml)).replace(/\s+/g, " ").trim();
  const anchors = [];
  const anchorPattern = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  for (const match of source.matchAll(anchorPattern)) {
    if (anchors.length >= 8) {
      break;
    }
    anchors.push({
      text: stripTags(decodeHtmlEntities(match[2])).replace(/\s+/g, " ").trim().slice(0, 80),
      href: readAttribute(match[1], "href").slice(0, 180),
      onclick: readAttribute(match[1], "onclick").slice(0, 180),
      title: readAttribute(match[1], "title").slice(0, 80)
    });
  }
  return {
    title,
    text: text.slice(0, 240),
    bytes: Buffer.byteLength(source),
    hasSecurityChallenge: source.includes("安全验证") || source.includes("_js_challenge") || source.includes("paer.js"),
    hasAccessDenied: source.includes("访问被拒绝") || /access\s+denied/i.test(source),
    hasChannelListText: source.includes("查看频道列表") || source.includes("频道列表"),
    anchorCount: (source.match(/<a\b/gi) || []).length,
    anchors
  };
}

function validateDetailPageForRow(html = "", row = {}, pageUrl = "https://iptv.cqshushu.com/index.php") {
  const summary = summarizeHtmlPage(html);
  const expectedIp = String(row.ip || "").trim();
  const channelListUrl = parseDetailChannelListUrl(html, pageUrl);
  const bodyText = stripTags(decodeHtmlEntities(html)).replace(/\s+/g, " ").trim();
  const hasExpectedIp = expectedIp ? bodyText.includes(expectedIp) : true;

  return {
    ok: Boolean(channelListUrl) && hasExpectedIp,
    expectedIp,
    hasExpectedIp,
    channelListUrl,
    summary
  };
}

function formatFetchError(error, config) {
  if (error?.name === "AbortError") {
    return `Request timed out after ${config.requestTimeoutMs} ms`;
  }
  return error?.message || String(error);
}

async function describeBadResponse(response) {
  if (response.status !== 403) {
    return `HTTP ${response.status}`;
  }

  try {
    const text = await response.text();
    if (/access\s+denied/i.test(text)) {
      return "VPS 被源站拒绝访问：HTTP 403 Access denied";
    }
  } catch (_error) {
    // Fall through to the generic status below.
  }

  return "HTTP 403";
}

async function fetchWithTimeout(fetchImpl, url, options, timeoutMs) {
  const externalSignal = options?.externalSignal;
  throwIfAborted(externalSignal);
  if (!timeoutMs && !externalSignal) {
    return fetchImpl(url, options);
  }

  const controller = new AbortController();
  const onAbort = () => controller.abort();
  const timer = timeoutMs ? setTimeout(() => controller.abort(), timeoutMs) : null;
  externalSignal?.addEventListener?.("abort", onAbort, { once: true });
  try {
    const { externalSignal: _externalSignal, ...fetchOptions } = options || {};
    return await fetchImpl(url, { ...fetchOptions, signal: controller.signal });
  } catch (error) {
    if (externalSignal?.aborted) {
      throw createAbortError();
    }
    throw error;
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
    externalSignal?.removeEventListener?.("abort", onAbort);
  }
}

function buildBrowserHeaders(config, cookieHeader = "") {
  const headers = {
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 IPTV-M3U-Manager/1.0",
    "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
    "referer": config.pageUrl,
    ...(cookieHeader ? { cookie: cookieHeader } : {})
  };

  if (config.browserProfile) {
    return {
      ...headers,
      "cache-control": "no-cache",
      "pragma": "no-cache",
      "upgrade-insecure-requests": "1",
      "sec-ch-ua": "\"Chromium\";v=\"126\", \"Google Chrome\";v=\"126\", \"Not-A.Brand\";v=\"99\"",
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": "\"Windows\"",
      "sec-fetch-dest": "document",
      "sec-fetch-mode": "navigate",
      "sec-fetch-site": "none",
      "sec-fetch-user": "?1"
    };
  }

  return headers;
}

async function fetchDiscoveryPage(fetchImpl, url, config) {
  const cookieHeader = config.cookieJar?.header();
  return fetchWithTimeout(fetchImpl, url, {
    redirect: "manual",
    headers: buildBrowserHeaders(config, cookieHeader),
    externalSignal: config.abortSignal
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

function createAbortError() {
  return Object.assign(new Error("Collector job cancelled"), { name: "AbortError" });
}

function throwIfAborted(signal) {
  if (signal?.aborted) {
    throw createAbortError();
  }
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(createAbortError());
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener?.("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(createAbortError());
    };
    signal?.addEventListener?.("abort", onAbort, { once: true });
  });
}

async function sleepWithCancel(sleepImpl, ms, signal) {
  throwIfAborted(signal);
  await sleepImpl(ms, signal);
  throwIfAborted(signal);
}

async function createBrowserDataDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), "iptv-collector-browser-"));
}

async function removeBrowserDataDir(browserDataDir = "") {
  if (!browserDataDir || !browserDataDir.startsWith(os.tmpdir())) {
    return;
  }
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await fs.rm(browserDataDir, { recursive: true, force: true });
      return;
    } catch (_error) {
      await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
    }
  }
}

function isTransientDiscoveryStatus(status) {
  return [429, 502, 503, 504].includes(status);
}

function retryDelayForStatus(status, normalDelayMs, rateLimitDelayMs, attempt) {
  const normalDelay = normalDelayMs * attempt;
  if (status === 429 && rateLimitDelayMs > 0) {
    return Math.max(normalDelay, rateLimitDelayMs * attempt);
  }
  return normalDelay;
}

function isTooFrequentError(error) {
  const message = error?.message || String(error || "");
  return message.includes("访问过于频繁") ||
    message.includes("請稍後再試") ||
    message.includes("请稍后再试") ||
    /too\s+frequent|rate\s*limit/i.test(message);
}

function isBrowserPageFlowError(error) {
  const message = error?.message || String(error || "");
  return isTooFrequentError(error) ||
    message.includes("Could not find source IP link on list page") ||
    message.includes("Clicked source link but URL did not change from list page");
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

async function fetchHtmlWithSession(fetchImpl, url, requestConfig, browserReferrer = "") {
  if (requestConfig.browserFetch) {
    const browserResult = await fetchHtmlWithBrowser(url, requestConfig, browserReferrer);
    if (browserResult?.html !== undefined) {
      return browserResult;
    }
    throw new Error(browserResult?.error || "Chromium browser rendering failed");
  }

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

async function fetchHtmlWithBrowser(url, requestConfig, browserReferrer = "") {
  if (typeof requestConfig.browserHtmlImpl === "function") {
    const html = await requestConfig.browserHtmlImpl(url, { ...requestConfig, browserReferrer });
    return {
      response: { ok: true, status: 200 },
      html,
      browser: true
    };
  }

  const candidates = chromiumCandidates();

  const errors = [];
  for (const command of candidates) {
    try {
      const rendered = await renderHtmlWithChromium(command, url, requestConfig, browserReferrer);
      if (!rendered.html.trim()) {
        errors.push(`${command}: empty rendered html`);
        continue;
      }
      return {
        response: { ok: true, status: 200 },
        html: rendered.html,
        sourceHtml: rendered.sourceHtml || "",
        finalUrl: rendered.finalUrl,
        browser: true
      };
    } catch (error) {
      const detail = error?.stderr || error?.message || error?.code || "unknown error";
      errors.push(`${command}: ${String(detail).trim().slice(0, 240)}`);
      if (error?.code === "ENOENT") {
        continue;
      }
    }
  }

  return {
    error: `Chromium browser rendering failed for ${url}: ${errors.join("; ") || "no chromium executable found"}`
  };
}

function cdpCommandTimeoutMs(requestConfig) {
  return Math.max(500, Math.min(60000, requestConfig.browserTimeoutMs || 25000));
}

function chromiumCandidates() {
  return Array.from(new Set([
    process.env.CHROMIUM_PATH,
    "chromium-browser",
    "chromium",
    "google-chrome"
  ].filter(Boolean)));
}

function withTimeout(promise, timeoutMs, message) {
  let timer;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    })
  ]);
}

function centerPointFromRect(rect = {}) {
  const x = Number(rect.x ?? rect.left);
  const y = Number(rect.y ?? rect.top);
  const width = Number(rect.width);
  const height = Number(rect.height);
  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) {
    return null;
  }
  return {
    x: Math.round(x + width / 2),
    y: Math.round(y + height / 2)
  };
}

async function dispatchTrustedClick(client, sessionId, point, commandTimeoutMs) {
  if (!point) {
    throw new Error("Cannot dispatch trusted click without a visible target point");
  }
  await client.send("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x: point.x,
    y: point.y,
    button: "none"
  }, sessionId, commandTimeoutMs);
  await client.send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: point.x,
    y: point.y,
    button: "left",
    buttons: 1,
    clickCount: 1
  }, sessionId, commandTimeoutMs);
  await client.send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: point.x,
    y: point.y,
    button: "left",
    buttons: 0,
    clickCount: 1
  }, sessionId, commandTimeoutMs);
}

async function dispatchTrustedLinkClick(client, sessionId, url, commandTimeoutMs) {
  const evaluated = await client.send("Runtime.evaluate", {
    expression: `(() => {
      const id = "__iptv_source_channel_link";
      document.getElementById(id)?.remove();
      const link = document.createElement("a");
      link.id = id;
      link.href = ${JSON.stringify(url)};
      link.textContent = "Open channel list";
      link.target = "_self";
      link.style.cssText = "position:fixed;left:20px;top:20px;width:180px;height:44px;z-index:2147483647;display:block;opacity:1;background:#fff;color:#000";
      document.body.appendChild(link);
      const rect = link.getBoundingClientRect();
      return {
        href: link.href,
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
      };
    })()`,
    returnByValue: true
  }, sessionId, commandTimeoutMs);
  const result = evaluated?.result?.value || {};
  await dispatchTrustedClick(client, sessionId, centerPointFromRect(result.rect), commandTimeoutMs);
  return result;
}

async function fetchDetailHtmlByClick(row, detailUrl, requestConfig, report = () => {}) {
  const startUrl = row.discoveryPageUrl || requestConfig.pageUrl;
  if (!requestConfig.browserFetch || !startUrl) {
    return null;
  }

  report({
    phase: "source:detail-click-start",
    ip: row.ip,
    typeName: row.typeName,
    startUrl,
    detailUrl,
    message: `从列表页点击源：${row.ip}`
  });

  if (typeof requestConfig.browserClickHtmlImpl === "function") {
    const rendered = await withTimeout(
      requestConfig.browserClickHtmlImpl({ startUrl, detailUrl, row, requestConfig }),
      requestConfig.browserTimeoutMs,
      `Browser click rendering timed out for ${row.ip}`
    );
    const html = typeof rendered === "string" ? rendered : rendered?.html || "";
    const sourceHtml = typeof rendered === "object" ? rendered.sourceHtml || "" : "";
    const channelListHtml = typeof rendered === "object" ? rendered.channelListHtml || "" : "";
    const channelListFinalUrl = typeof rendered === "object" ? rendered.channelListFinalUrl || "" : "";
    const sourceChannelListUrl = parseDetailChannelListUrl(sourceHtml, startUrl);
    const sourceChannelToken = readSourceToken(startUrl, sourceChannelListUrl);
    const clickedChannelToken = readSourceToken(startUrl, channelListFinalUrl);
    const channelListBlocked = sourceChannelListUrl && channelListHtml && sourceChannelToken && clickedChannelToken && sourceChannelToken !== clickedChannelToken
      ? {
        reason: "source-click-mismatch",
        expectedChannelListUrl: sourceChannelListUrl,
        actualChannelListUrl: channelListFinalUrl,
        expectedToken: sourceChannelToken,
        actualToken: clickedChannelToken
      }
      : null;
    return {
      response: { ok: true, status: 200 },
      html,
      sourceHtml,
      finalUrl: typeof rendered === "object" && rendered?.finalUrl ? rendered.finalUrl : detailUrl,
      browser: true,
      clicked: true,
      channelListHtml,
      channelListSourceHtml: typeof rendered === "object" ? rendered.channelListSourceHtml || "" : "",
      channelListFinalUrl,
      channelListBlocked
    };
  }

  const candidates = chromiumCandidates();

  const errors = [];
  for (const command of candidates) {
    try {
      const rendered = await renderHtmlWithChromiumClick(command, startUrl, detailUrl, row, requestConfig, report);
      if (!rendered.html.trim()) {
        errors.push(`${command}: empty clicked html`);
        continue;
      }
      return {
        response: { ok: true, status: 200 },
        html: rendered.html,
        sourceHtml: rendered.sourceHtml || "",
        finalUrl: rendered.finalUrl,
        browser: true,
        clicked: true,
        channelListHtml: rendered.channelListHtml || "",
        channelListSourceHtml: rendered.channelListSourceHtml || "",
        channelListFinalUrl: rendered.channelListFinalUrl || ""
      };
    } catch (error) {
      const detail = error?.stderr || error?.message || error?.code || "unknown error";
      errors.push(`${command}: ${String(detail).trim().slice(0, 240)}`);
      if (error?.code === "ENOENT") {
        continue;
      }
      if (isBrowserPageFlowError(error)) {
        return {
          error: `Chromium click rendering failed for ${detailUrl}: ${errors.join("; ") || "browser page flow error"}`
        };
      }
    }
  }

  return {
    error: `Chromium click rendering failed for ${detailUrl}: ${errors.join("; ") || "no chromium executable found"}`
  };
}

function waitForProcessOutput(process, pattern, timeoutMs) {
  return new Promise((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for Chromium DevTools endpoint. ${output.slice(-400)}`));
    }, timeoutMs);
    const onData = (chunk) => {
      output += chunk.toString();
      const match = output.match(pattern);
      if (match) {
        cleanup();
        resolve(match[1]);
      }
    };
    const onExit = (code) => {
      cleanup();
      reject(new Error(`Chromium exited before DevTools was ready: ${code}. ${output.slice(-400)}`));
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      clearTimeout(timer);
      process.stderr.off("data", onData);
      process.off("exit", onExit);
      process.off("error", onError);
    };
    process.stderr.on("data", onData);
    process.once("exit", onExit);
    process.once("error", onError);
  });
}

function createCdpClient(wsUrl) {
  if (typeof WebSocket !== "function") {
    throw new Error("Node.js WebSocket support is unavailable");
  }
  const ws = new WebSocket(wsUrl);
  let nextId = 1;
  const pending = new Map();
  const listeners = new Map();
  const openPromise = new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", () => reject(new Error("Chromium DevTools WebSocket failed")), { once: true });
  });
  ws.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) {
      if (message.method && listeners.has(message.method)) {
        for (const listener of listeners.get(message.method)) {
          listener(message.params || {}, message.sessionId || "");
        }
      }
      return;
    }
    const { resolve, reject, timer } = pending.get(message.id);
    pending.delete(message.id);
    clearTimeout(timer);
    if (message.error) {
      reject(new Error(message.error.message || JSON.stringify(message.error)));
    } else {
      resolve(message.result || {});
    }
  });
  const rejectPending = (error) => {
    for (const [id, item] of pending.entries()) {
      pending.delete(id);
      clearTimeout(item.timer);
      item.reject(error);
    }
  };
  ws.addEventListener("error", () => rejectPending(new Error("Chromium DevTools WebSocket failed")));
  ws.addEventListener("close", () => rejectPending(new Error("Chromium DevTools WebSocket closed")));

  return {
    async send(method, params = {}, sessionId = "", timeoutMs = 10000) {
      await withTimeout(openPromise, timeoutMs, `CDP WebSocket open timed out before ${method}`);
      const id = nextId++;
      const payload = { id, method, params };
      if (sessionId) {
        payload.sessionId = sessionId;
      }
      const response = new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`CDP command timed out: ${method}`));
        }, timeoutMs);
        pending.set(id, { resolve, reject, timer });
      });
      ws.send(JSON.stringify(payload));
      return response;
    },
    on(method, listener) {
      const items = listeners.get(method) || [];
      items.push(listener);
      listeners.set(method, items);
      return () => {
        const nextItems = (listeners.get(method) || []).filter((item) => item !== listener);
        if (nextItems.length > 0) {
          listeners.set(method, nextItems);
        } else {
          listeners.delete(method);
        }
      };
    },
    close() {
      try {
        ws.close();
      } catch (_error) {
        // Nothing useful to do during cleanup.
      }
    }
  };
}

const STEALTH_SCRIPT = `
(() => {
  const nativeGetter = (name, value) => {
    const getter = function() { return value; };
    try { Object.defineProperty(getter, "toString", { value: () => "function get " + name + "() { [native code] }" }); } catch (_) {}
    return getter;
  };
  const defineGetter = (target, key, getter) => {
    try { Object.defineProperty(target, key, { get: getter, configurable: true }); } catch (_) {}
  };
  defineGetter(Navigator.prototype, "webdriver", nativeGetter("webdriver", undefined));
  defineGetter(navigator, "webdriver", nativeGetter("webdriver", undefined));
  defineGetter(navigator, "languages", nativeGetter("languages", ["zh-CN", "zh", "en"]));
  const pluginArray = {
    0: { name: "Chrome PDF Plugin" },
    1: { name: "Chrome PDF Viewer" },
    2: { name: "Native Client" },
    length: 3,
    item(index) { return this[index] || null; },
    namedItem(name) { return Array.from({ length: this.length }, (_, index) => this[index]).find((plugin) => plugin.name === name) || null; },
    [Symbol.toStringTag]: "PluginArray"
  };
  defineGetter(Navigator.prototype, "plugins", nativeGetter("plugins", pluginArray));
  defineGetter(navigator, "plugins", nativeGetter("plugins", pluginArray));
  window.chrome = window.chrome || {};
  window.chrome.runtime = window.chrome.runtime || {};
  window.chrome.runtime.connect = window.chrome.runtime.connect || function() { return {}; };
  for (const key of ["webdriver_flag", "_phantom", "__clians", "selenium", "driver", "__webdriver_evaluate", "__webdriver_script_fn", "domAutomation", "domAutomationController"]) {
    try { delete window[key]; } catch (_) {}
    defineGetter(window, key, nativeGetter(key, undefined));
  }
})();
`;

async function renderHtmlWithChromium(command, url, requestConfig, browserReferrer = "") {
  const args = [
    "--headless=new",
    "--no-sandbox",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    "--disable-blink-features=AutomationControlled",
    "--disable-extensions",
    "--remote-debugging-port=0",
    ...(requestConfig.browserDataDir ? [`--user-data-dir=${requestConfig.browserDataDir}`] : []),
    "--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    "about:blank"
  ];
  const chrome = spawn(command, args, { stdio: ["ignore", "ignore", "pipe"] });
  let client;
  let sourceTracker;
  try {
    const commandTimeoutMs = cdpCommandTimeoutMs(requestConfig);
    const wsUrl = await waitForProcessOutput(chrome, /DevTools listening on (ws:\/\/[^\s]+)/, commandTimeoutMs);
    client = createCdpClient(wsUrl);
    const { targetId } = await client.send("Target.createTarget", { url: "about:blank" }, "", commandTimeoutMs);
    const { sessionId } = await client.send("Target.attachToTarget", { targetId, flatten: true }, "", commandTimeoutMs);
    await client.send("Page.enable", {}, sessionId, commandTimeoutMs);
    await client.send("Runtime.enable", {}, sessionId, commandTimeoutMs);
    await client.send("Network.enable", {}, sessionId, commandTimeoutMs);
    sourceTracker = createDocumentBodyTracker(client, sessionId);
    await client.send("Page.addScriptToEvaluateOnNewDocument", { source: STEALTH_SCRIPT }, sessionId, commandTimeoutMs);
    await seedBrowserCookies(client, sessionId, url, requestConfig, commandTimeoutMs);
    const navigateParams = { url };
    if (browserReferrer) {
      navigateParams.referrer = browserReferrer;
    }
    await client.send("Page.navigate", navigateParams, sessionId, commandTimeoutMs);

    const deadline = Date.now() + requestConfig.browserTimeoutMs;
    let lastHtml = "";
    let lastFinalUrl = url;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 600));
      const evaluated = await client.send("Runtime.evaluate", {
        expression: "({ html: document.documentElement ? document.documentElement.outerHTML : '', text: document.body ? document.body.innerText : '', href: location.href, readyState: document.readyState })",
        returnByValue: true
      }, sessionId, commandTimeoutMs);
      const value = evaluated?.result?.value || {};
      lastHtml = value.html || lastHtml;
      lastFinalUrl = value.href || lastFinalUrl;
      const text = value.text || "";
      const stillChecking = text.includes("安全验证中") || text.includes("正在确认您的浏览器安全环境");
      if (lastHtml && value.readyState === "complete" && !stillChecking) {
        const sourceHtml = await sourceTracker.getHtml(client, lastFinalUrl, commandTimeoutMs);
        return { html: lastHtml, sourceHtml, finalUrl: lastFinalUrl };
      }
    }
    const sourceHtml = await sourceTracker.getHtml(client, lastFinalUrl, commandTimeoutMs);
    return { html: lastHtml, sourceHtml, finalUrl: lastFinalUrl };
  } finally {
    sourceTracker?.close();
    client?.close();
    if (!chrome.killed) {
      chrome.kill("SIGKILL");
    }
  }
}

async function renderHtmlWithChromiumClick(command, startUrl, detailUrl, row, requestConfig, report = () => {}) {
  const args = [
    "--headless=new",
    "--no-sandbox",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    "--disable-blink-features=AutomationControlled",
    "--disable-extensions",
    "--remote-debugging-port=0",
    ...(requestConfig.browserDataDir ? [`--user-data-dir=${requestConfig.browserDataDir}`] : []),
    "--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    "about:blank"
  ];
  const chrome = spawn(command, args, { stdio: ["ignore", "ignore", "pipe"] });
  let client;
  let sourceTracker;
  try {
    const commandTimeoutMs = cdpCommandTimeoutMs(requestConfig);
    const wsUrl = await waitForProcessOutput(chrome, /DevTools listening on (ws:\/\/[^\s]+)/, commandTimeoutMs);
    client = createCdpClient(wsUrl);
    const { targetId } = await client.send("Target.createTarget", { url: "about:blank" }, "", commandTimeoutMs);
    const { sessionId } = await client.send("Target.attachToTarget", { targetId, flatten: true }, "", commandTimeoutMs);
    await client.send("Page.enable", {}, sessionId, commandTimeoutMs);
    await client.send("Runtime.enable", {}, sessionId, commandTimeoutMs);
    await client.send("Network.enable", {}, sessionId, commandTimeoutMs);
    sourceTracker = createDocumentBodyTracker(client, sessionId);
    await client.send("Page.addScriptToEvaluateOnNewDocument", { source: STEALTH_SCRIPT }, sessionId, commandTimeoutMs);
    const seededCookies = await seedBrowserCookies(client, sessionId, startUrl, requestConfig, commandTimeoutMs);
    if (seededCookies > 0) {
      report({
        phase: "source:detail-click-cookies",
        ip: row.ip,
        typeName: row.typeName,
        startUrl,
        cookies: seededCookies,
        message: `已同步浏览器会话 Cookie：${row.ip}`
      });
    }
    const navigateParams = { url: startUrl };
    const baseReferrer = buildBaseIndexUrl(startUrl);
    if (baseReferrer !== startUrl) {
      navigateParams.referrer = baseReferrer;
    }
    await client.send("Page.navigate", navigateParams, sessionId, commandTimeoutMs);
    await waitForStablePage(client, sessionId, requestConfig, startUrl);
    report({
      phase: "source:detail-click-list-loaded",
      ip: row.ip,
      typeName: row.typeName,
      startUrl,
      message: `列表页已打开，准备点击：${row.ip}`
    });
    if (requestConfig.detailInitialDelayMs > 0) {
      report({
        phase: "source:detail-click-wait",
        ip: row.ip,
        typeName: row.typeName,
        startUrl,
        delayMs: requestConfig.detailInitialDelayMs,
        message: `首次点击前等待：${row.ip}`
      });
      await new Promise((resolve) => setTimeout(resolve, requestConfig.detailInitialDelayMs));
    }

    const clickResult = await client.send("Runtime.evaluate", {
      expression: `(() => {
        const wantedIp = ${JSON.stringify(row.ip)};
        const wantedToken = ${JSON.stringify(row.token)};
        const wantedType = ${JSON.stringify(row.sourceType)};
        const links = Array.from(document.querySelectorAll("a"));
        const link = links.find((item) => {
          const onclick = item.getAttribute("onclick") || "";
          const text = (item.textContent || "").trim();
          return onclick.includes("gotoIP") && onclick.includes(wantedToken) && onclick.includes(wantedType) ||
            (text === wantedIp && onclick.includes("gotoIP"));
        });
        if (!link) {
          return { clicked: false, href: location.href, linkCount: links.length, text: document.body ? document.body.innerText.slice(0, 240) : "" };
        }
        link.scrollIntoView({ block: "center", inline: "center" });
        const rect = link.getBoundingClientRect();
        return {
          clicked: true,
          href: location.href,
          text: link.textContent || "",
          onclick: link.getAttribute("onclick") || "",
          rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
        };
      })()`,
      returnByValue: true
    }, sessionId, commandTimeoutMs);
    const clicked = clickResult?.result?.value;
    if (clicked?.clicked) {
      await dispatchTrustedClick(client, sessionId, centerPointFromRect(clicked.rect), commandTimeoutMs);
    } else {
      report({
        phase: "source:detail-click-link-miss",
        ip: row.ip,
        typeName: row.typeName,
        startUrl,
        detailUrl,
        linkCount: clicked?.linkCount,
        pageText: clicked?.text,
        message: `列表页未找到原始 IP 链接，改用已采集 token 可信点击：${row.ip}`
      });
      await dispatchTrustedLinkClick(client, sessionId, detailUrl, commandTimeoutMs);
    }
    report({
      phase: "source:detail-clicked",
      ip: row.ip,
      typeName: row.typeName,
      startUrl,
      clickedHref: clicked?.href || detailUrl,
      clickedText: clicked?.text || row.ip,
      clickedOnclick: clicked?.onclick || "",
      injected: !clicked?.clicked,
      message: `已点击列表源：${row.ip}`
    });
    let detailPage;
    try {
      detailPage = await waitForStablePage(client, sessionId, requestConfig, startUrl, { requireUrlChange: true });
    } catch (error) {
      if (!String(error?.message || error).includes("Clicked source link but URL did not change from list page")) {
        throw error;
      }
      report({
        phase: "source:detail-click-fallback",
        ip: row.ip,
        typeName: row.typeName,
        startUrl,
        detailUrl,
        error: error.message,
        message: `点击未跳转，改用同会话详情页：${row.ip}`
      });
      await client.send("Page.navigate", { url: detailUrl, referrer: startUrl }, sessionId, commandTimeoutMs);
      detailPage = await waitForStablePage(client, sessionId, requestConfig, detailUrl);
    }
    if (isBaseIndexUrl(startUrl, detailPage.finalUrl)) {
      report({
        phase: "source:detail-click-home-fallback",
        ip: row.ip,
        typeName: row.typeName,
        startUrl,
        detailUrl,
        finalUrl: detailPage.finalUrl,
        message: `点击源后回到首页，改用同会话详情页：${row.ip}`
      });
      await client.send("Page.navigate", { url: detailUrl, referrer: startUrl }, sessionId, commandTimeoutMs);
      detailPage = await waitForStablePage(client, sessionId, requestConfig, detailUrl);
    }
    detailPage.sourceHtml = await sourceTracker.getHtml(client, detailPage.finalUrl, commandTimeoutMs);

    const sourceChannelListUrl = parseDetailChannelListUrl(detailPage.sourceHtml || "", startUrl);
    if (sourceChannelListUrl) {
      try {
        report({
          phase: "source:channel-list-source-navigate",
          ip: row.ip,
          typeName: row.typeName,
          channelListUrl: sourceChannelListUrl,
          message: `按详情页源码打开频道列表：${row.ip}`
        });
        await dispatchTrustedLinkClick(client, sessionId, sourceChannelListUrl, commandTimeoutMs);
        const channelPage = await waitForStablePage(client, sessionId, requestConfig, detailPage.finalUrl, { requireUrlChange: true });
        const actualChannelListUrl = normalizeChannelListUrl(startUrl, channelPage.finalUrl);
        channelPage.sourceHtml = await sourceTracker.getHtml(client, channelPage.finalUrl, commandTimeoutMs);
        const sourceChannelToken = readSourceToken(startUrl, sourceChannelListUrl);
        const actualChannelToken = readSourceToken(startUrl, actualChannelListUrl);
        if (actualChannelListUrl && (!sourceChannelToken || sourceChannelToken === actualChannelToken)) {
          return {
            ...detailPage,
            channelListHtml: channelPage.html,
            channelListSourceHtml: channelPage.sourceHtml || "",
            channelListFinalUrl: actualChannelListUrl,
            channelListClickedText: "source-html",
            channelListClickedHref: sourceChannelListUrl
          };
        }
        report({
          phase: "source:channel-list-source-mismatch",
          ip: row.ip,
          typeName: row.typeName,
          expectedChannelListUrl: sourceChannelListUrl,
          actualChannelListUrl,
          expectedToken: sourceChannelToken,
          actualToken: actualChannelToken,
          message: `源码频道列表跳转不匹配：${row.ip}`
        });
        return {
          ...detailPage,
          channelListBlocked: {
            reason: "source-click-mismatch",
            expectedChannelListUrl: sourceChannelListUrl,
            actualChannelListUrl,
            expectedToken: sourceChannelToken,
            actualToken: actualChannelToken
          }
        };
      } catch (error) {
        report({
          phase: "source:channel-list-source-error",
          ip: row.ip,
          typeName: row.typeName,
          channelListUrl: sourceChannelListUrl,
          error: formatFetchError(error, requestConfig),
          message: `按详情页源码打开频道列表失败：${row.ip}`
        });
        return {
          ...detailPage,
          channelListBlocked: {
            reason: "source-click-error",
            expectedChannelListUrl: sourceChannelListUrl,
            error: formatFetchError(error, requestConfig)
          }
        };
      }
    }

    const preferredChannelListUrl = parseDetailChannelListUrl(detailPage.sourceHtml || detailPage.html, startUrl);
    const selectedChannel = await waitForChannelListCandidate(client, sessionId, requestConfig, preferredChannelListUrl);
    if (!selectedChannel) {
      return detailPage;
    }
    try {
      report({
        phase: "source:channel-list-click",
        ip: row.ip,
        typeName: row.typeName,
        channelListUrl: selectedChannel.href,
        message: `同会话点击频道列表：${row.ip}`
      });
      const channelClick = await client.send("Runtime.evaluate", {
        expression: `(() => {
          const wantedIndex = ${JSON.stringify(selectedChannel.index)};
          const wantedHref = ${JSON.stringify(selectedChannel.href)};
          const links = Array.from(document.querySelectorAll("a"));
          const link = links[wantedIndex] || links.find((item) => {
            const href = item.href || item.getAttribute("href") || "";
            return href === wantedHref;
          });
          if (!link) {
            return { clicked: false, href: location.href, linkCount: links.length, text: document.body ? document.body.innerText.slice(0, 240) : "" };
          }
          link.scrollIntoView({ block: "center", inline: "center" });
          const rect = link.getBoundingClientRect();
          return {
            clicked: true,
            href: location.href,
            text: link.textContent || "",
            linkHref: link.href || link.getAttribute("href") || "",
            rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
          };
        })()`,
        returnByValue: true
      }, sessionId, commandTimeoutMs);
      const channelClicked = channelClick?.result?.value;
      if (!channelClicked?.clicked) {
        throw new Error(`Could not find channel list link on detail page: ${JSON.stringify(channelClicked || {})}`);
      }
      await dispatchTrustedClick(client, sessionId, centerPointFromRect(channelClicked.rect), commandTimeoutMs);
      const channelPage = await waitForStablePage(client, sessionId, requestConfig, detailPage.finalUrl, { requireUrlChange: true });
      const actualChannelListUrl = normalizeChannelListUrl(startUrl, channelPage.finalUrl);
      channelPage.sourceHtml = await sourceTracker.getHtml(client, channelPage.finalUrl, commandTimeoutMs);
      if (!actualChannelListUrl) {
        report({
          phase: "source:channel-list-redirect-home",
          ip: row.ip,
          typeName: row.typeName,
          channelListUrl: selectedChannel.href,
          finalUrl: channelPage.finalUrl,
          clickedText: channelClicked.text,
          clickedLinkHref: channelClicked.linkHref,
          message: `频道列表点击后回到首页：${row.ip}`
        });
        return detailPage;
      }
      return {
        ...detailPage,
        channelListHtml: channelPage.html,
        channelListSourceHtml: channelPage.sourceHtml || "",
        channelListFinalUrl: actualChannelListUrl,
        channelListClickedText: channelClicked.text,
        channelListClickedHref: channelClicked.linkHref
      };
    } catch (error) {
      report({
        phase: "source:channel-list-click-error",
        ip: row.ip,
        typeName: row.typeName,
        channelListUrl: selectedChannel.href,
        error: formatFetchError(error, requestConfig),
        message: `同会话频道列表点击失败：${row.ip}`
      });
      return detailPage;
    }
  } finally {
    sourceTracker?.close();
    client?.close();
    if (!chrome.killed) {
      chrome.kill("SIGKILL");
    }
  }
}

async function waitForStablePage(client, sessionId, requestConfig, fallbackUrl = "", options = {}) {
  const deadline = Date.now() + requestConfig.browserTimeoutMs;
  const commandTimeoutMs = cdpCommandTimeoutMs(requestConfig);
  let lastHtml = "";
  let lastFinalUrl = fallbackUrl;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 600));
    let evaluated;
    try {
      evaluated = await client.send("Runtime.evaluate", {
        expression: "({ html: document.documentElement ? document.documentElement.outerHTML : '', text: document.body ? document.body.innerText : '', href: location.href, readyState: document.readyState })",
        returnByValue: true
      }, sessionId, Math.min(commandTimeoutMs, Math.max(500, deadline - Date.now())));
    } catch (error) {
      if (String(error?.message || error).includes("CDP command timed out: Runtime.evaluate")) {
        continue;
      }
      throw error;
    }
    const value = evaluated?.result?.value || {};
    lastHtml = value.html || lastHtml;
    lastFinalUrl = value.href || lastFinalUrl;
    const text = value.text || "";
    const stillChecking = text.includes("安全验证中") || text.includes("正在确认您的浏览器安全环境");
    if (options.requireUrlChange && lastFinalUrl === fallbackUrl) {
      continue;
    }
    if (lastHtml && value.readyState === "complete" && !stillChecking) {
      return { html: lastHtml, finalUrl: lastFinalUrl };
    }
  }
  if (options.requireUrlChange && lastFinalUrl === fallbackUrl) {
    throw new Error(`Clicked source link but URL did not change from list page: ${fallbackUrl}`);
  }
  return { html: lastHtml, finalUrl: lastFinalUrl };
}

function normalizeDocumentUrl(value = "") {
  if (!value) {
    return "";
  }
  try {
    const url = new URL(value);
    url.hash = "";
    return url.toString();
  } catch (_error) {
    return String(value).split("#")[0];
  }
}

function createDocumentBodyTracker(client, sessionId) {
  const latestByUrl = new Map();
  const latestByRequestId = new Map();
  const unsubscribeResponse = client.on("Network.responseReceived", (params, eventSessionId) => {
    if (eventSessionId && eventSessionId !== sessionId) {
      return;
    }
    if (params.type !== "Document" || !params.response?.url) {
      return;
    }
    const url = normalizeDocumentUrl(params.response.url);
    const item = {
      requestId: params.requestId,
      url,
      finished: false,
      bodyPromise: null
    };
    latestByUrl.set(url, item);
    latestByRequestId.set(params.requestId, item);
  });
  const unsubscribeFinished = client.on("Network.loadingFinished", (params, eventSessionId) => {
    if (eventSessionId && eventSessionId !== sessionId) {
      return;
    }
    const item = latestByRequestId.get(params.requestId);
    if (!item || item.bodyPromise) {
      return;
    }
    item.finished = true;
    item.bodyPromise = client.send("Network.getResponseBody", {
      requestId: item.requestId
    }, sessionId, 10000).then((body) => (
      body?.base64Encoded
        ? Buffer.from(body.body || "", "base64").toString("utf8")
        : String(body?.body || "")
    )).catch(() => "");
  });
  const unsubscribeFailed = client.on("Network.loadingFailed", (params, eventSessionId) => {
    if (eventSessionId && eventSessionId !== sessionId) {
      return;
    }
    const item = latestByRequestId.get(params.requestId);
    latestByRequestId.delete(params.requestId);
    if (item && latestByUrl.get(item.url) === item) {
      latestByUrl.delete(item.url);
    }
  });

  return {
    async getHtml(clientInstance, pageUrl, commandTimeoutMs) {
      const targetUrl = normalizeDocumentUrl(pageUrl);
      const deadline = Date.now() + Math.min(commandTimeoutMs, 5000);
      while (Date.now() < deadline) {
        const candidate = latestByUrl.get(targetUrl);
        if (candidate?.finished) {
          if (!candidate.bodyPromise) {
            candidate.bodyPromise = clientInstance.send("Network.getResponseBody", {
              requestId: candidate.requestId
            }, sessionId, Math.max(500, deadline - Date.now())).then((body) => (
              body?.base64Encoded
                ? Buffer.from(body.body || "", "base64").toString("utf8")
                : String(body?.body || "")
            )).catch(() => "");
          }
          const raw = await candidate.bodyPromise;
          if (raw) {
            return raw;
          }
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      return "";
    },
    close() {
      unsubscribeResponse?.();
      unsubscribeFinished?.();
      unsubscribeFailed?.();
    }
  };
}

async function readChannelListCandidates(client, sessionId, commandTimeoutMs) {
  const evaluated = await client.send("Runtime.evaluate", {
    expression: `(() => {
      const links = Array.from(document.querySelectorAll("a"));
      return links.map((item, index) => {
        const rect = item.getBoundingClientRect();
        const style = window.getComputedStyle(item);
        const visible = rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
        return {
          index,
          href: item.href || item.getAttribute("href") || "",
          text: (item.textContent || "").trim(),
          title: item.getAttribute("title") || "",
          visible
        };
      });
    })()`,
    returnByValue: true
  }, sessionId, commandTimeoutMs);
  return evaluated?.result?.value || [];
}

async function waitForChannelListCandidate(client, sessionId, requestConfig, preferredUrl = "") {
  const deadline = Date.now() + requestConfig.browserTimeoutMs;
  const commandTimeoutMs = cdpCommandTimeoutMs(requestConfig);
  let lastSelected = null;
  let stableCount = 0;

  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 800));
    const candidates = await readChannelListCandidates(
      client,
      sessionId,
      Math.min(commandTimeoutMs, Math.max(500, deadline - Date.now()))
    );
    const selected = chooseChannelListCandidate(candidates, preferredUrl);
    if (!selected) {
      lastSelected = null;
      stableCount = 0;
      continue;
    }
    if (lastSelected?.href === selected.href && lastSelected?.index === selected.index) {
      stableCount += 1;
    } else {
      stableCount = 1;
      lastSelected = selected;
    }
    if (stableCount >= 2) {
      return selected;
    }
  }

  return lastSelected;
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

function createProgressReporter(callback) {
  return (event) => {
    if (typeof callback === "function") {
      callback({ time: new Date().toISOString(), ...event });
    }
  };
}

async function resolveDetailM3uUrl(fetchImpl, row, requestConfig, sleepImpl, report = () => {}) {
  const detailUrl = buildDetailUrl(requestConfig.pageUrl, row);
  let previousStatus = 0;
  let lastDetailSummary = null;
  for (let attempt = 0; attempt <= requestConfig.detailRetries; attempt += 1) {
    throwIfAborted(requestConfig.abortSignal);
    const retryDelayMs = attempt > 0
      ? retryDelayForStatus(previousStatus, requestConfig.detailRetryDelayMs, requestConfig.rateLimitDelayMs, attempt)
      : 0;
    if (retryDelayMs > 0) {
      report({
        phase: "source:detail-wait",
        ip: row.ip,
        typeName: row.typeName,
        attempt: attempt + 1,
        status: previousStatus || undefined,
        delayMs: retryDelayMs,
        message: `等待后重试详情页：${row.ip}`
      });
      await sleepWithCancel(sleepImpl, retryDelayMs, requestConfig.abortSignal);
    }
    let detail;
    try {
      report({
        phase: "source:detail",
        ip: row.ip,
        typeName: row.typeName,
        attempt: attempt + 1,
        detailUrl,
        message: `获取详情页：${row.ip}`
      });
      const shouldClickFromList = requestConfig.browserFetch && row.discoveryPageUrl &&
        (typeof requestConfig.browserClickHtmlImpl === "function" || !requestConfig.browserHtmlImpl);
      if (shouldClickFromList) {
        const clickedDetail = await fetchDetailHtmlByClick(row, detailUrl, requestConfig, report);
        if (clickedDetail?.html !== undefined) {
          detail = clickedDetail;
        } else {
          throw new Error(clickedDetail?.error || "Chromium click rendering failed");
        }
      } else {
        detail = await fetchHtmlWithSession(fetchImpl, detailUrl, requestConfig, row.discoveryPageUrl || requestConfig.pageUrl);
      }
      report({
        phase: "source:detail-loaded",
        ip: row.ip,
        typeName: row.typeName,
        attempt: attempt + 1,
        detailUrl,
        finalUrl: detail.finalUrl,
        clicked: detail.clicked === true,
        browser: detail.browser === true,
        message: `详情页已读取：${row.ip}${detail.browser ? "（Chromium 渲染）" : ""}${detail.clicked ? "（列表页点击）" : ""}`
      });
    } catch (error) {
      throwIfAborted(requestConfig.abortSignal);
      if (isTooFrequentError(error)) {
        previousStatus = 429;
      }
      report({
        phase: "source:detail-error",
        ip: row.ip,
        typeName: row.typeName,
        attempt: attempt + 1,
        detailUrl,
        error: formatFetchError(error, requestConfig),
        message: `详情页请求失败：${row.ip}`
      });
      continue;
    }
    previousStatus = detail.response.status;
    const detailParseHtml = detail.sourceHtml || detail.html;
    const detailValidation = detail.response.ok
      ? validateDetailPageForRow(detailParseHtml, row, requestConfig.pageUrl)
      : { ok: false, channelListUrl: "", summary: summarizeHtmlPage(detailParseHtml), hasExpectedIp: false, expectedIp: row.ip };
    const channelListUrl = detailValidation.channelListUrl;
    if (detail.response.ok && detail.clicked === true && !detailValidation.ok) {
      lastDetailSummary = detailValidation.summary;
      report({
        phase: "source:detail-mismatch",
        ip: row.ip,
        typeName: row.typeName,
        attempt: attempt + 1,
        detailUrl,
        finalUrl: detail.finalUrl,
        status: detail.response.status,
        expectedIp: detailValidation.expectedIp,
        hasExpectedIp: detailValidation.hasExpectedIp,
        hasChannelListUrl: Boolean(channelListUrl),
        pageTitle: detailValidation.summary.title,
        pageText: detailValidation.summary.text,
        pageBytes: detailValidation.summary.bytes,
        hasSecurityChallenge: detailValidation.summary.hasSecurityChallenge,
        hasAccessDenied: detailValidation.summary.hasAccessDenied,
        anchorCount: detailValidation.summary.anchorCount,
        anchors: detailValidation.summary.anchors,
        message: `详情页内容不匹配：${row.ip}`
      });
      continue;
    }
    if (!channelListUrl) {
      const detailSummary = detailValidation.summary;
      lastDetailSummary = detailSummary;
      report({
        phase: "source:detail-miss",
        ip: row.ip,
        typeName: row.typeName,
        attempt: attempt + 1,
        detailUrl,
        finalUrl: detail.finalUrl,
        status: detail.response.status,
        pageTitle: detailSummary.title,
        pageText: detailSummary.text,
        pageBytes: detailSummary.bytes,
        hasSecurityChallenge: detailSummary.hasSecurityChallenge,
        hasAccessDenied: detailSummary.hasAccessDenied,
        hasChannelListText: detailSummary.hasChannelListText,
        anchorCount: detailSummary.anchorCount,
        anchors: detailSummary.anchors,
        message: `未找到频道列表：${row.ip}；标题：${detailSummary.title || "无"}；正文：${detailSummary.text || "空"}`
      });
      continue;
    }
    if (detail.channelListBlocked) {
      lastDetailSummary = {
        ...detailValidation.summary,
        channelListBlocked: detail.channelListBlocked
      };
      report({
        phase: "source:channel-list-blocked",
        ip: row.ip,
        typeName: row.typeName,
        attempt: attempt + 1,
        channelListUrl,
        ...detail.channelListBlocked,
        message: `频道列表点击链不可信，跳过直接请求：${row.ip}`
      });
      previousStatus = 0;
      continue;
    }
    let channelList;
    try {
      throwIfAborted(requestConfig.abortSignal);
      report({
        phase: "source:channel-list",
        ip: row.ip,
        typeName: row.typeName,
        attempt: attempt + 1,
        channelListUrl,
        message: `分析频道列表：${row.ip}`
      });
      const channelListParseHtml = detail.channelListSourceHtml || detail.channelListHtml;
      const expectedChannelToken = readSourceToken(requestConfig.pageUrl, channelListUrl);
      const clickedChannelUrl = detail.channelListFinalUrl || "";
      const clickedChannelToken = readSourceToken(requestConfig.pageUrl, clickedChannelUrl);
      const canUseClickedChannelList = channelListParseHtml &&
        (!detail.sourceHtml || !expectedChannelToken || !clickedChannelToken || clickedChannelToken === expectedChannelToken);
      if (channelListParseHtml && !canUseClickedChannelList) {
        report({
          phase: "source:channel-list-polluted",
          ip: row.ip,
          typeName: row.typeName,
          attempt: attempt + 1,
          expectedChannelListUrl: channelListUrl,
          clickedChannelListUrl: clickedChannelUrl,
          expectedToken: expectedChannelToken,
          clickedToken: clickedChannelToken,
          message: `丢弃不匹配的频道列表：${row.ip}`
        });
      }
      if (canUseClickedChannelList) {
        channelList = {
          response: { ok: true, status: 200 },
          html: channelListParseHtml,
          finalUrl: detail.channelListFinalUrl || channelListUrl,
          browser: true,
          clicked: true
        };
      } else {
        channelList = await fetchHtmlWithSession(fetchImpl, channelListUrl, requestConfig, detailUrl);
      }
      channelList.actualUrl = chooseActualChannelListUrl(requestConfig.pageUrl, channelListUrl, channelList.finalUrl);
      report({
        phase: "source:channel-list-loaded",
        ip: row.ip,
        typeName: row.typeName,
        attempt: attempt + 1,
        channelListUrl: channelList.actualUrl,
        parsedChannelListUrl: channelListUrl,
        finalUrl: channelList.finalUrl,
        browser: channelList.browser === true,
        message: `频道列表已读取：${row.ip}${channelList.browser ? "（Chromium 渲染）" : ""}`
      });
    } catch (error) {
      throwIfAborted(requestConfig.abortSignal);
      report({
        phase: "source:channel-list-error",
        ip: row.ip,
        typeName: row.typeName,
        attempt: attempt + 1,
        channelListUrl,
        error: formatFetchError(error, requestConfig),
        message: `频道列表请求失败：${row.ip}`
      });
      continue;
    }
    previousStatus = channelList.response.status;
    const actualChannelListUrl = channelList.actualUrl || channelListUrl;
    const expectedToken = readSourceToken(requestConfig.pageUrl, actualChannelListUrl);
    const parsedM3uUrl = channelList.response.ok ? parseChannelListM3uUrl(channelList.html, requestConfig.pageUrl, expectedToken) : "";
    const m3uUrl = parsedM3uUrl || normalizeM3uUrlFromChannelList(requestConfig.pageUrl, actualChannelListUrl);
    if (m3uUrl) {
      report({
        phase: "source:m3u-url",
        ip: row.ip,
        typeName: row.typeName,
        channelListUrl: actualChannelListUrl,
        m3uUrl,
        message: `取到 M3U 接口：${row.ip}`
      });
      return { m3uUrl, channelListUrl: actualChannelListUrl };
    }
    report({
      phase: "source:m3u-miss",
      ip: row.ip,
      typeName: row.typeName,
      attempt: attempt + 1,
      channelListUrl: actualChannelListUrl,
      status: channelList.response.status,
      message: `未找到 M3U 接口：${row.ip}`
    });
  }
  return { m3uUrl: "", channelListUrl: "", detailSummary: lastDetailSummary };
}

async function checkM3uUrl(fetchImpl, url, referer, requestConfig) {
  try {
    throwIfAborted(requestConfig.abortSignal);
    const cookieHeader = requestConfig.cookieJar?.header();
    const response = await fetchWithTimeout(fetchImpl, url, {
      headers: {
        "user-agent": "Mozilla/5.0 IPTV-M3U-Manager/1.0",
        "accept": "*/*",
        "referer": referer || requestConfig.pageUrl,
        ...(cookieHeader ? { cookie: cookieHeader } : {})
      },
      externalSignal: requestConfig.abortSignal
    }, requestConfig.requestTimeoutMs);
    if (!response.ok) {
      return { ok: false, status: response.status, channelLines: 0 };
    }
    const text = await response.text();
    return {
      ok: true,
      status: response.status,
      channelLines: (text.match(/#EXTINF/g) || []).length,
      bytes: text.length,
      head: text.slice(0, 120)
    };
  } catch (error) {
    throwIfAborted(requestConfig.abortSignal);
    return { ok: false, error: formatFetchError(error, requestConfig), channelLines: 0 };
  }
}

async function checkM3uUrlWithRetries(fetchImpl, url, referer, requestConfig, sleepImpl, row, report = () => {}) {
  let lastCheck = null;
  for (let attempt = 0; attempt <= requestConfig.m3uCheckRetries; attempt += 1) {
    throwIfAborted(requestConfig.abortSignal);
    const retryDelayMs = attempt > 0
      ? retryDelayForStatus(lastCheck?.status || 0, requestConfig.m3uCheckRetryDelayMs, requestConfig.rateLimitDelayMs, attempt)
      : 0;
    if (retryDelayMs > 0) {
      report({
        phase: "source:m3u-wait",
        ip: row.ip,
        typeName: row.typeName,
        attempt: attempt + 1,
        status: lastCheck?.status,
        delayMs: retryDelayMs,
        m3uUrl: url,
        message: `M3U 为空，等待后重试：${row.ip}`
      });
      await sleepWithCancel(sleepImpl, retryDelayMs, requestConfig.abortSignal);
    }
    report({
      phase: "source:m3u-check",
      ip: row.ip,
      typeName: row.typeName,
      attempt: attempt + 1,
      m3uUrl: url,
      message: `校验 M3U 内容：${row.ip}`
    });
    lastCheck = await checkM3uUrl(fetchImpl, url, referer, requestConfig);
    report({
      phase: "source:m3u-check-result",
      ip: row.ip,
      typeName: row.typeName,
      attempt: attempt + 1,
      m3uUrl: url,
      status: lastCheck.status,
      channelLines: lastCheck.channelLines,
      bytes: lastCheck.bytes,
      head: lastCheck.head,
      error: lastCheck.error,
      message: `M3U 校验结果：${row.ip}，频道 ${lastCheck.channelLines || 0} 个`
    });
    if (lastCheck.ok) {
      return lastCheck;
    }
  }
  return lastCheck || { ok: false, channelLines: 0 };
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
  const report = createProgressReporter(options.onProgress);
  throwIfAborted(options.signal);
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
  const requestConfig = { ...config, cookieJar, abortSignal: options.signal, browserHtmlImpl: options.browserHtmlImpl };
  requestConfig.browserClickHtmlImpl = options.browserClickHtmlImpl;
  const browserDataDir = config.browserFetch && !options.browserHtmlImpl ? await createBrowserDataDir() : "";
  if (browserDataDir) {
    requestConfig.browserDataDir = browserDataDir;
  }

  const endPage = config.startPage + config.maxPages - 1;
  report({
    phase: "discover:start",
    current: 0,
    total: config.maxPages,
    message: `开始采集：${config.pageUrl}`
  });
  for (let page = config.startPage; page <= endPage; page += 1) {
    throwIfAborted(options.signal);
    if (page > config.startPage && config.pageDelayMs > 0) {
      report({
        phase: "page:wait",
        page,
        delayMs: config.pageDelayMs,
        message: `等待后采集第 ${page} 页`
      });
      await sleepWithCancel(sleepImpl, config.pageDelayMs, options.signal);
    }
    const url = buildPageUrl(useFallbackBase ? buildBaseIndexUrl(config.pageUrl) : config.pageUrl, page);
    if (!url) {
      break;
    }
    let response;
    try {
      report({
        phase: "page:start",
        page,
        url,
        current: page - config.startPage,
        total: config.maxPages,
        message: `获取列表第 ${page} 页`
      });
      response = await fetchWithSession(fetchImpl, url, requestConfig);
      for (let attempt = 0; isTransientDiscoveryStatus(response.status) && attempt < config.rateLimitRetries; attempt += 1) {
        throwIfAborted(options.signal);
        if (config.rateLimitDelayMs > 0) {
          report({
            phase: "page:retry-wait",
            page,
            url,
            attempt: attempt + 2,
            status: response.status,
            delayMs: config.rateLimitDelayMs * (attempt + 1),
            message: `第 ${page} 页遇到 HTTP ${response.status}，等待后重试`
          });
          await sleepWithCancel(sleepImpl, config.rateLimitDelayMs * (attempt + 1), options.signal);
        }
        response = await fetchWithSession(fetchImpl, url, requestConfig);
      }
    } catch (error) {
      throwIfAborted(options.signal);
      pages.push({ page, url, rows: 0, error: formatFetchError(error, requestConfig) });
      warnings.push(`第 ${page} 页采集失败：${formatFetchError(error, requestConfig)}`);
      report({
        phase: "page:error",
        page,
        url,
        error: formatFetchError(error, requestConfig),
        message: `第 ${page} 页采集失败`
      });
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
      const error = await describeBadResponse(response);
      pages.push({ page, url: effectiveUrl, rows: 0, error });
      warnings.push(`第 ${page} 页采集失败：${error}`);
      report({
        phase: "page:error",
        page,
        url: effectiveUrl,
        status: response.status,
        error,
        message: `第 ${page} 页采集失败：${error}`
      });
      break;
    }

    const html = await response.text();
    throwIfAborted(options.signal);
    const pageRows = parseTableRows(html).map((row) => ({ ...row, discoveryPageUrl: effectiveUrl }));
    pages.push({ page, url: effectiveUrl, rows: pageRows.length });
    rows.push(...pageRows);
    report({
      phase: "page:done",
      page,
      url: effectiveUrl,
      rows: pageRows.length,
      current: page - config.startPage + 1,
      total: config.maxPages,
      message: `第 ${page} 页解析到 ${pageRows.length} 条源`
    });

    if (!html.includes("下一页") || pageRows.length === 0) {
      break;
    }
  }

  const selectedRows = filterRows(rows, config, now);
  report({
    phase: "rows:selected",
    rows: selectedRows.length,
    current: 0,
    total: selectedRows.length,
    message: `筛选后准备逐条采集 ${selectedRows.length} 条源`
  });
  if (config.resolveDetailUrls && selectedRows.length > 0) {
    await ensureAdVerification(fetchImpl, config.pageUrl, requestConfig);
  }
  if (config.browserFetch && requestConfig.browserDataDir && selectedRows.length > 0) {
    const warmUrl = buildPageUrl(config.pageUrl, config.startPage) || config.pageUrl;
    report({
      phase: "browser:prewarm",
      url: warmUrl,
      message: "预热 Chromium 会话：打开采集列表页"
    });
    const warmResult = await fetchHtmlWithBrowser(warmUrl, requestConfig);
    if (warmResult?.error) {
      warnings.push(`Chromium 会话预热失败：${warmResult.error}`);
      report({
        phase: "browser:prewarm-error",
        url: warmUrl,
        error: warmResult.error,
        message: "Chromium 会话预热失败"
      });
    }
  }
  const sources = [];
  const skippedSources = [];
  const seenSourceUrls = new Set();
  const cachedSourcesByIp = new Map((options.sourceCache || [])
    .filter((source) => source?.ip && source?.url)
    .map((source) => [String(source.ip), source]));
  let skippedWithoutDetailUrl = 0;
  let skippedDuplicateUrls = 0;
  let skippedEmptyM3uUrls = 0;
  let detailIndex = 0;
  for (const row of selectedRows) {
    throwIfAborted(options.signal);
    let sourceUrl = buildM3uUrl(config.pageUrl, row);
    let channelListUrl = "";
    let resolvedFromDetail = false;
    report({
      phase: "source:start",
      ip: row.ip,
      typeName: row.typeName,
      current: detailIndex,
      total: selectedRows.length,
      row,
      message: `开始采集 ${row.ip}（${row.typeName}）`
    });
    const cachedSource = cachedSourcesByIp.get(String(row.ip));
    if (cachedSource) {
      detailIndex += 1;
      sourceUrl = cachedSource.url;
      if (seenSourceUrls.has(sourceUrl)) {
        skippedDuplicateUrls += 1;
        skippedSources.push({
          ...row,
          reason: "duplicate",
          m3uUrl: sourceUrl,
          message: "重复 M3U 地址"
        });
        report({
          phase: "source:skip",
          ip: row.ip,
          typeName: row.typeName,
          reason: "duplicate",
          m3uUrl: sourceUrl,
          row,
          message: `跳过 ${row.ip}：重复 M3U 地址`
        });
        continue;
      }
      seenSourceUrls.add(sourceUrl);
      const source = {
        name: cachedSource.name || `自动-${cachedSource.typeName || row.typeName}`,
        url: sourceUrl,
        auto: true,
        cached: true,
        ip: row.ip,
        channelCount: cachedSource.channelCount || row.channelCount,
        typeName: cachedSource.typeName || row.typeName,
        onlineAt: cachedSource.onlineAt || row.onlineAt,
        updatedAt: cachedSource.updatedAt || row.updatedAt,
        status: cachedSource.status || row.status,
        channelListUrl: cachedSource.channelListUrl || ""
      };
      sources.push(source);
      report({
        phase: "source:cached",
        ip: row.ip,
        typeName: source.typeName,
        m3uUrl: sourceUrl,
        current: detailIndex,
        total: selectedRows.length,
        row,
        channelLines: source.channelCount,
        message: `命中缓存 ${row.ip}：跳过重复采集`
      });
      continue;
    }
    if (config.resolveDetailUrls) {
      if (detailIndex > 0 && config.detailDelayMs > 0) {
        report({
          phase: "source:wait",
          ip: row.ip,
          typeName: row.typeName,
          delayMs: config.detailDelayMs,
          message: `等待后采集下一条：${row.ip}`
        });
        await sleepWithCancel(sleepImpl, config.detailDelayMs, options.signal);
      }
      detailIndex += 1;
      const detailResult = await resolveDetailM3uUrl(fetchImpl, row, requestConfig, sleepImpl, report);
      if (detailResult.m3uUrl) {
        sourceUrl = detailResult.m3uUrl;
        channelListUrl = detailResult.channelListUrl;
        resolvedFromDetail = true;
      } else {
        skippedWithoutDetailUrl += 1;
        const detailSummary = detailResult.detailSummary || {};
        const skipped = {
          ...row,
          reason: "detail-missing",
          detailUrl: buildDetailUrl(config.pageUrl, row),
          detailSummary,
          message: "未取到真实 M3U 接口"
        };
        skippedSources.push(skipped);
        report({
          phase: "source:skip",
          ip: row.ip,
          typeName: row.typeName,
          reason: skipped.reason,
          row,
          message: `跳过 ${row.ip}：未取到真实 M3U 接口`
        });
        continue;
      }
    }
    if (config.validateM3uUrls && resolvedFromDetail) {
      let m3uCheck = null;
      for (let resolveAttempt = 0; resolveAttempt <= requestConfig.emptyM3uResolveRetries; resolveAttempt += 1) {
        throwIfAborted(options.signal);
        m3uCheck = await checkM3uUrlWithRetries(fetchImpl, sourceUrl, channelListUrl || config.pageUrl, requestConfig, sleepImpl, row, report);
        if (m3uCheck.ok && m3uCheck.channelLines > 0) {
          break;
        }
        if (resolveAttempt >= requestConfig.emptyM3uResolveRetries) {
          break;
        }
        if (requestConfig.emptyM3uResolveDelayMs > 0) {
          report({
            phase: "source:m3u-reresolve-wait",
            ip: row.ip,
            typeName: row.typeName,
            attempt: resolveAttempt + 2,
            delayMs: requestConfig.emptyM3uResolveDelayMs * (resolveAttempt + 1),
            m3uUrl: sourceUrl,
            message: `M3U 仍为空，重新进入详情页前等待：${row.ip}`
          });
          await sleepWithCancel(sleepImpl, requestConfig.emptyM3uResolveDelayMs * (resolveAttempt + 1), options.signal);
        }
        const nextDetailResult = await resolveDetailM3uUrl(fetchImpl, row, requestConfig, sleepImpl, report);
        if (nextDetailResult.m3uUrl) {
          const previousUrl = sourceUrl;
          sourceUrl = nextDetailResult.m3uUrl;
          channelListUrl = nextDetailResult.channelListUrl;
          report({
            phase: "source:m3u-reresolved",
            ip: row.ip,
            typeName: row.typeName,
            attempt: resolveAttempt + 2,
            previousM3uUrl: previousUrl,
            m3uUrl: sourceUrl,
            channelListUrl,
            changed: previousUrl !== sourceUrl,
            message: previousUrl === sourceUrl
              ? `重新解析详情页，M3U 未变化：${row.ip}`
              : `重新解析详情页，换到新 M3U：${row.ip}`
          });
        }
      }
      if (!m3uCheck.ok || m3uCheck.channelLines <= 0) {
        skippedEmptyM3uUrls += 1;
        const skipped = {
          ...row,
          reason: "m3u-empty",
          detailUrl: buildDetailUrl(config.pageUrl, row),
          m3uUrl: sourceUrl,
          channelListUrl,
          status: m3uCheck.status,
          channelLines: m3uCheck.channelLines || 0,
          bytes: m3uCheck.bytes || 0,
          error: m3uCheck.error || "",
          head: m3uCheck.head || "",
          message: "M3U 地址未返回频道"
        };
        skippedSources.push(skipped);
        skipped.message = `M3U 地址未返回频道；详情页：${skipped.detailUrl}；频道列表：${channelListUrl || "未取到"}`;
        report({
          phase: "source:skip",
          ip: row.ip,
          typeName: row.typeName,
          reason: skipped.reason,
          m3uUrl: sourceUrl,
          status: skipped.status,
          channelLines: skipped.channelLines,
          bytes: skipped.bytes,
          error: skipped.error,
          row,
          message: `跳过 ${row.ip}：M3U 未返回频道`
        });
        continue;
      }
    }
    if (seenSourceUrls.has(sourceUrl)) {
      skippedDuplicateUrls += 1;
      skippedSources.push({
        ...row,
        reason: "duplicate",
        m3uUrl: sourceUrl,
        message: "重复 M3U 地址"
      });
      report({
        phase: "source:skip",
        ip: row.ip,
        typeName: row.typeName,
        reason: "duplicate",
        m3uUrl: sourceUrl,
        row,
        message: `跳过 ${row.ip}：重复 M3U 地址`
      });
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
      status: row.status,
      channelListUrl
    });
    report({
      phase: "source:added",
      ip: row.ip,
      typeName: row.typeName,
      m3uUrl: sourceUrl,
      channelListUrl,
      current: detailIndex,
      total: selectedRows.length,
      row,
      message: `采集成功 ${row.ip}：${row.channelCount || "未知"} 个频道`
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

  report({
    phase: "discover:done",
    sources: sources.length,
    skipped: skippedSources.length,
    current: selectedRows.length,
    total: selectedRows.length,
    message: `采集完成：成功 ${sources.length} 条，跳过 ${skippedSources.length} 条`
  });

  const result = { config, sources, rows: selectedRows, pages, warnings, skippedSources };
  await removeBrowserDataDir(browserDataDir);
  return result;
}

export async function debugAutoSourceByIp(configValue = {}, targetIp = "", options = {}) {
  const config = normalizeAutoSourceConfig({ ...configValue, enabled: true });
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const sleepImpl = options.sleepImpl || sleep;
  const now = options.now || new Date();
  const cookieJar = createCookieJar();
  const requestConfig = { ...config, cookieJar, browserHtmlImpl: options.browserHtmlImpl };
  requestConfig.browserClickHtmlImpl = options.browserClickHtmlImpl;
  const browserDataDir = config.browserFetch && !options.browserHtmlImpl ? await createBrowserDataDir() : "";
  if (browserDataDir) {
    requestConfig.browserDataDir = browserDataDir;
  }
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
      pages.push({ page, url, rows: 0, error: await describeBadResponse(response) });
      break;
    }
    const html = await response.text();
    const pageRows = parseTableRows(html).map((row) => ({ ...row, discoveryPageUrl: url }));
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
  if (config.browserFetch && requestConfig.browserDataDir) {
    await fetchHtmlWithBrowser(buildPageUrl(config.pageUrl, config.startPage) || config.pageUrl, requestConfig);
  }
  const detailUrl = buildDetailUrl(config.pageUrl, row);
  let detail;
  try {
    const shouldClickFromList = config.browserFetch && row.discoveryPageUrl &&
      (typeof requestConfig.browserClickHtmlImpl === "function" || !requestConfig.browserHtmlImpl);
    if (shouldClickFromList) {
      const clickedDetail = await fetchDetailHtmlByClick(row, detailUrl, requestConfig);
      if (clickedDetail?.html !== undefined) {
        detail = clickedDetail;
      } else {
        throw new Error(clickedDetail?.error || "Chromium click rendering failed");
      }
    } else {
      detail = await fetchHtmlWithSession(fetchImpl, detailUrl, requestConfig, row.discoveryPageUrl || config.pageUrl);
    }
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
  const detailParseHtml = detail.sourceHtml || detail.html;
  const channelListUrl = detail.response.ok ? parseDetailChannelListUrl(detailParseHtml, config.pageUrl) : "";
  const detailExpectedToken = readSourceToken(config.pageUrl, channelListUrl);
  result.detail = {
    url: detailUrl,
    status: detail.response.status,
    channelListUrl,
    expectedToken: detailExpectedToken,
    anchors: summarizeTokenAnchors(detailParseHtml, config.pageUrl, detailExpectedToken),
    blocked: detail.channelListBlocked || null
  };

  if (!channelListUrl) {
    return result;
  }
  if (detail.channelListBlocked) {
    result.channelList = {
      url: channelListUrl,
      status: 0,
      error: detail.channelListBlocked.reason,
      anchors: [],
      selectedM3uUrl: ""
    };
    return result;
  }

  let channelList;
  try {
    const channelListParseHtml = detail.channelListSourceHtml || detail.channelListHtml;
    const clickedChannelToken = readSourceToken(config.pageUrl, detail.channelListFinalUrl || "");
    const canUseClickedChannelList = channelListParseHtml &&
      (!detail.sourceHtml || !detailExpectedToken || !clickedChannelToken || clickedChannelToken === detailExpectedToken);
    if (canUseClickedChannelList) {
      channelList = {
        response: { ok: true, status: 200 },
        html: channelListParseHtml,
        finalUrl: detail.channelListFinalUrl || channelListUrl,
        browser: true,
        clicked: true
      };
    } else {
      channelList = await fetchHtmlWithSession(fetchImpl, channelListUrl, requestConfig, detailUrl);
    }
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
  const actualChannelListUrl = chooseActualChannelListUrl(config.pageUrl, channelListUrl, channelList.finalUrl);
  const expectedToken = readSourceToken(config.pageUrl, actualChannelListUrl);
  const parsedM3uUrl = channelList.response.ok ? parseChannelListM3uUrl(channelList.html, config.pageUrl, expectedToken) : "";
  const selectedM3uUrl = parsedM3uUrl || normalizeM3uUrlFromChannelList(config.pageUrl, actualChannelListUrl);
  result.channelList = {
    url: actualChannelListUrl,
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
          "referer": actualChannelListUrl
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

export { browserCookiesFromHeader, centerPointFromRect, chooseChannelListCandidate, dispatchTrustedLinkClick, filterRows, isBaseIndexUrl, normalizeAutoSourceConfig, parseTableRows, todayInShanghai };
