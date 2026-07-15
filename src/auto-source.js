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
    pageDelayMs: parseBoundedInteger(value.pageDelayMs ?? "1500", 1500, 0, 5000),
    rateLimitRetries: parseBoundedInteger(value.rateLimitRetries ?? "2", 2, 0, 5),
    rateLimitDelayMs: parseBoundedInteger(value.rateLimitDelayMs ?? "5000", 5000, 0, 300000),
    detailDelayMs: parseBoundedInteger(value.detailDelayMs ?? "1200", 1200, 0, 10000),
    detailRetries: parseBoundedInteger(value.detailRetries ?? "1", 1, 0, 3),
    detailRetryDelayMs: parseBoundedInteger(value.detailRetryDelayMs ?? "5000", 5000, 0, 30000),
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
    const labelText = stripTags(decodeHtmlEntities(label));
    const hasChannelListText = labelText.includes("\u67e5\u770b\u9891\u9053\u5217\u8868") ||
      labelText.includes("\u9891\u9053\u5217\u8868") ||
      isChannelListLink(label);
    if (hasChannelListText) {
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
  await fs.rm(browserDataDir, { recursive: true, force: true });
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
  if (requestConfig.browserFetch) {
    const browserResult = await fetchHtmlWithBrowser(url, requestConfig);
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

async function fetchHtmlWithBrowser(url, requestConfig) {
  if (typeof requestConfig.browserHtmlImpl === "function") {
    const html = await requestConfig.browserHtmlImpl(url, requestConfig);
    return {
      response: { ok: true, status: 200 },
      html,
      browser: true
    };
  }

  const candidates = [
    process.env.CHROMIUM_PATH,
    "chromium-browser",
    "chromium",
    "google-chrome"
  ].filter(Boolean);

  const errors = [];
  for (const command of candidates) {
    try {
      const html = await renderHtmlWithChromium(command, url, requestConfig);
      if (!html.trim()) {
        errors.push(`${command}: empty rendered html`);
        continue;
      }
      return {
        response: { ok: true, status: 200 },
        html,
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
    const cleanup = () => {
      clearTimeout(timer);
      process.stderr.off("data", onData);
      process.off("exit", onExit);
    };
    process.stderr.on("data", onData);
    process.once("exit", onExit);
  });
}

function createCdpClient(wsUrl) {
  if (typeof WebSocket !== "function") {
    throw new Error("Node.js WebSocket support is unavailable");
  }
  const ws = new WebSocket(wsUrl);
  let nextId = 1;
  const pending = new Map();
  const openPromise = new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", () => reject(new Error("Chromium DevTools WebSocket failed")), { once: true });
  });
  ws.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) {
      return;
    }
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) {
      reject(new Error(message.error.message || JSON.stringify(message.error)));
    } else {
      resolve(message.result || {});
    }
  });

  return {
    async send(method, params = {}, sessionId = "") {
      await openPromise;
      const id = nextId++;
      const payload = { id, method, params };
      if (sessionId) {
        payload.sessionId = sessionId;
      }
      const response = new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
      });
      ws.send(JSON.stringify(payload));
      return response;
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

async function renderHtmlWithChromium(command, url, requestConfig) {
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
  try {
    const wsUrl = await waitForProcessOutput(chrome, /DevTools listening on (ws:\/\/[^\s]+)/, Math.min(10000, requestConfig.browserTimeoutMs));
    client = createCdpClient(wsUrl);
    const { targetId } = await client.send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await client.send("Target.attachToTarget", { targetId, flatten: true });
    await client.send("Page.enable", {}, sessionId);
    await client.send("Runtime.enable", {}, sessionId);
    await client.send("Page.addScriptToEvaluateOnNewDocument", { source: STEALTH_SCRIPT }, sessionId);
    await client.send("Page.navigate", { url }, sessionId);

    const deadline = Date.now() + requestConfig.browserTimeoutMs;
    let lastHtml = "";
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 600));
      const evaluated = await client.send("Runtime.evaluate", {
        expression: "({ html: document.documentElement ? document.documentElement.outerHTML : '', text: document.body ? document.body.innerText : '', href: location.href, readyState: document.readyState })",
        returnByValue: true
      }, sessionId);
      const value = evaluated?.result?.value || {};
      lastHtml = value.html || lastHtml;
      const text = value.text || "";
      const stillChecking = text.includes("安全验证中") || text.includes("正在确认您的浏览器安全环境");
      if (lastHtml && value.readyState === "complete" && !stillChecking) {
        return lastHtml;
      }
    }
    return lastHtml;
  } finally {
    client?.close();
    if (!chrome.killed) {
      chrome.kill("SIGKILL");
    }
  }
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
      detail = await fetchHtmlWithSession(fetchImpl, detailUrl, requestConfig);
      report({
        phase: "source:detail-loaded",
        ip: row.ip,
        typeName: row.typeName,
        attempt: attempt + 1,
        detailUrl,
        browser: detail.browser === true,
        message: `详情页已读取：${row.ip}${detail.browser ? "（Chromium 渲染）" : ""}`
      });
    } catch (error) {
      throwIfAborted(requestConfig.abortSignal);
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
    const channelListUrl = detail.response.ok ? parseDetailChannelListUrl(detail.html, requestConfig.pageUrl) : "";
    if (!channelListUrl) {
      const detailSummary = summarizeHtmlPage(detail.html);
      lastDetailSummary = detailSummary;
      report({
        phase: "source:detail-miss",
        ip: row.ip,
        typeName: row.typeName,
        attempt: attempt + 1,
        detailUrl,
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
      channelList = await fetchHtmlWithSession(fetchImpl, channelListUrl, requestConfig);
      report({
        phase: "source:channel-list-loaded",
        ip: row.ip,
        typeName: row.typeName,
        attempt: attempt + 1,
        channelListUrl,
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
    const expectedToken = readSourceToken(requestConfig.pageUrl, channelListUrl);
    const m3uUrl = channelList.response.ok ? parseChannelListM3uUrl(channelList.html, requestConfig.pageUrl, expectedToken) : "";
    if (m3uUrl) {
      report({
        phase: "source:m3u-url",
        ip: row.ip,
        typeName: row.typeName,
        channelListUrl,
        m3uUrl,
        message: `取到 M3U 接口：${row.ip}`
      });
      return { m3uUrl, channelListUrl };
    }
    report({
      phase: "source:m3u-miss",
      ip: row.ip,
      typeName: row.typeName,
      attempt: attempt + 1,
      channelListUrl,
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
    const pageRows = parseTableRows(html);
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
      status: row.status
    });
    report({
      phase: "source:added",
      ip: row.ip,
      typeName: row.typeName,
      m3uUrl: sourceUrl,
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
  if (config.browserFetch && requestConfig.browserDataDir) {
    await fetchHtmlWithBrowser(buildPageUrl(config.pageUrl, config.startPage) || config.pageUrl, requestConfig);
  }
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
