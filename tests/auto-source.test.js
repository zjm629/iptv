import { discoverAutoSources, filterRows, normalizeAutoSourceConfig, parseTableRows } from "../src/auto-source.js";

const SAMPLE_HTML = `
<table><tbody>
<tr>
<td><a onclick="gotoIP('top-sichuan','multicast')">1.1.1.1</a></td>
<td>200</td><td>四川成都组播 四川电信</td>
<td>2026-07-13 06:30</td><td>2026-07-13 17:00:00</td>
<td><span>新上线</span></td>
</tr>
<tr>
<td><a onclick="gotoIP('dup-sichuan','multicast')">1.1.1.2</a></td>
<td>201</td><td>四川成都组播 四川电信</td>
<td>2026-07-13 06:20</td><td>2026-07-13 16:00:00</td>
<td><span>新上线</span></td>
</tr>
<tr>
<td><a onclick="gotoIP('failed-hainan','multicast')">2.2.2.2</a></td>
<td>209</td><td>海南海口组播 海南电信</td>
<td>2026-07-13 06:28</td><td>2026-07-13 15:35:05</td>
<td><span>暂时失效</span></td>
</tr>
<tr>
<td><a onclick="gotoIP('unicom','migu')">3.3.3.3</a></td>
<td>300</td><td>北京咪咕 北京联通</td>
<td>2026-07-13 06:30</td><td>2026-07-13 17:13:37</td>
<td><span>新上线</span></td>
</tr>
<tr>
<td><a onclick="gotoIP('guangdong','multicast')">4.4.4.4</a></td>
<td>188</td><td>广东组播 广东电信</td>
<td>2026-07-12 06:30</td><td>2026-07-12 17:13:37</td>
<td><span>新上线</span></td>
</tr>
</tbody></table>`;

describe("auto source discovery", () => {
  test("normalizes disabled auto collection by default", () => {
    expect(normalizeAutoSourceConfig({})).toEqual(expect.objectContaining({
      enabled: false,
      keywords: ["电信"],
      disabledTypeNames: []
    }));
  });

  test("parses cqshushu table rows", () => {
    const rows = parseTableRows(SAMPLE_HTML);

    expect(rows[0]).toEqual(expect.objectContaining({
      token: "top-sichuan",
      sourceType: "multicast",
      ip: "1.1.1.1",
      channelCount: "200",
      typeName: "四川成都组播 四川电信",
      updatedAt: "2026-07-13 17:00:00",
      status: "新上线"
    }));
  });

  test("filters today's new telecom rows and keeps the first row for duplicate types", () => {
    const config = normalizeAutoSourceConfig({ enabled: true, keywords: ["电信"] });
    const rows = filterRows(parseTableRows(SAMPLE_HTML), config, new Date("2026-07-13T12:00:00+08:00"));

    expect(rows.map((row) => row.token)).toEqual(["top-sichuan"]);
  });

  test("skips disabled type names while keeping discovery dynamic", async () => {
    const fetchMock = async () => ({
      ok: true,
      text: async () => SAMPLE_HTML
    });

    const result = await discoverAutoSources({
      enabled: true,
      keywords: ["电信"],
      disabledTypeNames: ["四川成都组播 四川电信"],
      maxPages: 1
    }, {
      fetchImpl: fetchMock,
      now: new Date("2026-07-13T12:00:00+08:00")
    });

    expect(result.sources).toEqual([]);
    expect(result.rows).toEqual([]);
  });

  test("builds m3u source urls for selected rows", async () => {
    const fetchMock = async () => ({
      ok: true,
      text: async () => SAMPLE_HTML
    });

    const result = await discoverAutoSources({
      enabled: true,
      pageUrl: "https://iptv.cqshushu.com/index.php",
      keywords: ["电信"],
      maxPages: 1,
      resolveDetailUrls: false
    }, {
      fetchImpl: fetchMock,
      now: new Date("2026-07-13T12:00:00+08:00")
    });

    expect(result.sources).toEqual([
      expect.objectContaining({
        name: "自动-四川成都组播 四川电信",
        url: "https://iptv.cqshushu.com/index.php?s=top-sichuan&t=multicast&channels=1&format=m3u",
        auto: true,
        typeName: "四川成都组播 四川电信"
      })
    ]);
  });

  test("uses the configured page url as-is for the first discovery request", async () => {
    const requestedUrls = [];
    const fetchMock = async (url) => {
      requestedUrls.push(url);
      return {
        ok: true,
        text: async () => SAMPLE_HTML
      };
    };

    await discoverAutoSources({
      enabled: true,
      pageUrl: "https://iptv.cqshushu.com/index.php",
      keywords: ["电信"],
      resolveDetailUrls: false
    }, {
      fetchImpl: fetchMock,
      now: new Date("2026-07-13T12:00:00+08:00")
    });

    expect(requestedUrls).toEqual(["https://iptv.cqshushu.com/index.php"]);
  });

  test("collects from the configured start page", async () => {
    const requestedUrls = [];
    const fetchMock = async (url) => {
      requestedUrls.push(url);
      return {
        ok: true,
        text: async () => url.includes("page=4") ? SAMPLE_HTML : `${SAMPLE_HTML}下一页`
      };
    };

    await discoverAutoSources({
      enabled: true,
      pageUrl: "https://iptv.cqshushu.com/index.php?q=%E7%94%B5%E4%BF%A1",
      keywords: ["电信"],
      startPage: 3,
      maxPages: 2,
      resolveDetailUrls: false
    }, {
      fetchImpl: fetchMock,
      sleepImpl: async () => {},
      now: new Date("2026-07-13T12:00:00+08:00")
    });

    expect(requestedUrls).toEqual([
      "https://iptv.cqshushu.com/index.php?q=%E7%94%B5%E4%BF%A1&page=3",
      "https://iptv.cqshushu.com/index.php?q=%E7%94%B5%E4%BF%A1&page=4"
    ]);
  });

  test("falls back to the base index page when filtered search urls are blocked", async () => {
    const requestedUrls = [];
    const fetchMock = async (url) => {
      requestedUrls.push(url);
      if (requestedUrls.length === 1) {
        return {
          ok: false,
          status: 403,
          headers: { get: () => "PHPSESSID=session-1; path=/" },
          text: async () => "blocked"
        };
      }
      if (requestedUrls.length === 2) {
        return {
          ok: false,
          status: 500,
          headers: { get: () => null },
          text: async () => "challenge failed"
        };
      }
      return {
        ok: true,
        headers: { get: () => null },
        text: async () => SAMPLE_HTML
      };
    };

    const result = await discoverAutoSources({
      enabled: true,
      pageUrl: "https://iptv.cqshushu.com/index.php?t=all&province=all&q=%E7%94%B5%E4%BF%A1",
      keywords: ["电信"],
      resolveDetailUrls: false
    }, {
      fetchImpl: fetchMock,
      now: new Date("2026-07-13T12:00:00+08:00")
    });

    expect(requestedUrls).toEqual([
      "https://iptv.cqshushu.com/index.php?t=all&province=all&q=%E7%94%B5%E4%BF%A1",
      "https://iptv.cqshushu.com/index.php?t=all&province=all&q=%E7%94%B5%E4%BF%A1&_js_challenge=1",
      "https://iptv.cqshushu.com/index.php"
    ]);
    expect(result.sources[0].url).toBe("https://iptv.cqshushu.com/index.php?s=top-sichuan&t=multicast&channels=1&format=m3u");
  });

  test("passes cqshushu js challenge and continues collecting search pages with cookies", async () => {
    const requested = [];
    const cookieHeaders = [];
    const response = (status, setCookie, text) => ({
      ok: status >= 200 && status < 300,
      status,
      headers: {
        get(name) {
          return name === "set-cookie" ? setCookie : null;
        }
      },
      text: async () => text
    });
    const fetchMock = async (url, options = {}) => {
      requested.push(url);
      cookieHeaders.push(options.headers?.cookie || "");
      if (url.includes("_js_challenge=1")) {
        return response(302, "paer_sec_token=token-1; path=/", "");
      }
      if (requested.length === 1) {
        return response(403, "PHPSESSID=session-1; path=/", "blocked");
      }
      return response(200, null, url.includes("page=2") ? SAMPLE_HTML : `${SAMPLE_HTML}下一页`);
    };

    const result = await discoverAutoSources({
      enabled: true,
      pageUrl: "https://iptv.cqshushu.com/index.php?q=%E7%94%B5%E4%BF%A1",
      keywords: ["电信"],
      maxPages: 2,
      uniqueByType: false,
      resolveDetailUrls: false
    }, {
      fetchImpl: fetchMock,
      now: new Date("2026-07-13T12:00:00+08:00")
    });

    expect(requested).toEqual([
      "https://iptv.cqshushu.com/index.php?q=%E7%94%B5%E4%BF%A1",
      "https://iptv.cqshushu.com/index.php?q=%E7%94%B5%E4%BF%A1&_js_challenge=1",
      "https://iptv.cqshushu.com/index.php?q=%E7%94%B5%E4%BF%A1",
      "https://iptv.cqshushu.com/index.php?q=%E7%94%B5%E4%BF%A1&page=2"
    ]);
    expect(cookieHeaders[1]).toContain("PHPSESSID=session-1");
    expect(cookieHeaders[2]).toContain("paer_sec_token=token-1");
    expect(result.sources).toHaveLength(2);
    expect(result.warnings).toContain("已跳过 2 个重复 M3U 地址。");
  });

  test("uses the detail page m3u token instead of the listing token", async () => {
    const requested = [];
    const cookieHeaders = [];
    const response = (status, text) => ({
      ok: status >= 200 && status < 300,
      status,
      headers: { get: () => null },
      text: async () => text
    });
    const fetchMock = async (url, options = {}) => {
      requested.push(url);
      cookieHeaders.push(options.headers?.cookie || "");
      if (url.endsWith("/ad_verify.php")) {
        return response(200, "window.__ad_ok=1;");
      }
      if (url.includes("?p=top-sichuan&t=multicast")) {
        if (!options.headers?.cookie?.includes("ad_ok=1")) {
          return response(200, '<title>验证中...</title><script src="https://iptv.cqshushu.com/ad_verify.php"></script>');
        }
        return response(200, '<a href="?s=real-sichuan&t=multicast">📺 查看频道列表</a>');
      }
      if (url.includes("?s=real-sichuan&t=multicast")) {
        return response(200, `
          <a href="#"
             onclick="copyToClipboard('http://iptv.cqshushu.com/index.php?s=real-sichuan&t=multicast&channels=1&format=m3u'); return false;"
             title="复制 M3U 接口链接">🔗 M3U接口</a>
        `);
      }
      return response(200, SAMPLE_HTML);
    };

    const result = await discoverAutoSources({
      enabled: true,
      pageUrl: "https://iptv.cqshushu.com/index.php",
      keywords: ["电信"],
      maxPages: 1
    }, {
      fetchImpl: fetchMock,
      now: new Date("2026-07-13T12:00:00+08:00")
    });

    expect(requested).toEqual([
      "https://iptv.cqshushu.com/index.php",
      "https://iptv.cqshushu.com/ad_verify.php",
      "https://iptv.cqshushu.com/index.php?p=top-sichuan&t=multicast",
      "https://iptv.cqshushu.com/index.php?s=real-sichuan&t=multicast"
    ]);
    expect(cookieHeaders[2]).toContain("ad_ok=1");
    expect(result.sources[0].url).toBe("http://iptv.cqshushu.com/index.php?s=real-sichuan&t=multicast&channels=1&format=m3u");
  });

  test("prefers the detail page channel list link over other token links", async () => {
    const fetchMock = async (url) => {
      if (url.endsWith("/ad_verify.php")) {
        return {
          ok: true,
          status: 200,
          headers: { get: () => null },
          text: async () => "window.__ad_ok=1;"
        };
      }
      if (url.includes("?p=top-sichuan&t=multicast")) {
        return {
          ok: true,
          status: 200,
          headers: { get: () => null },
          text: async () => `
            <a href="?s=empty-listing-token&t=multicast">TXT接口</a>
            <a href="?s=real-channel-list-token&t=multicast">📺 查看频道列表</a>
          `
        };
      }
      if (url.includes("?s=real-channel-list-token&t=multicast")) {
        return {
          ok: true,
          status: 200,
          headers: { get: () => null },
          text: async () => `
            <a href="?s=real-channel-list-token&t=multicast&channels=1&download=m3u">M3U下载</a>
            <a href="#"
               onclick="copyToClipboard('http://iptv.cqshushu.com/index.php?s=real-channel-list-token&amp;t=multicast&amp;channels=1&amp;format=m3u'); return false;"
               title="复制 M3U 接口链接">🔗 M3U接口</a>
          `
        };
      }
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        text: async () => SAMPLE_HTML
      };
    };

    const result = await discoverAutoSources({
      enabled: true,
      pageUrl: "https://iptv.cqshushu.com/index.php",
      keywords: ["电信"],
      maxPages: 1
    }, {
      fetchImpl: fetchMock,
      now: new Date("2026-07-13T12:00:00+08:00")
    });

    expect(result.sources[0].url).toBe("http://iptv.cqshushu.com/index.php?s=real-channel-list-token&t=multicast&channels=1&format=m3u");
  });

  test("skips sources when the detail page does not expose a real m3u token", async () => {
    const fetchMock = async (url) => {
      if (url.endsWith("/ad_verify.php")) {
        return {
          ok: true,
          status: 200,
          headers: { get: () => null },
          text: async () => "window.__ad_ok=1;"
        };
      }
      if (url.includes("?p=top-sichuan&t=multicast")) {
        return {
          ok: true,
          status: 200,
          headers: { get: () => null },
          text: async () => "<html>no m3u here</html>"
        };
      }
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        text: async () => SAMPLE_HTML
      };
    };

    const result = await discoverAutoSources({
      enabled: true,
      pageUrl: "https://iptv.cqshushu.com/index.php",
      keywords: ["电信"],
      maxPages: 1,
      detailRetries: 0
    }, {
      fetchImpl: fetchMock,
      now: new Date("2026-07-13T12:00:00+08:00")
    });

    expect(result.sources).toEqual([]);
    expect(result.warnings).toEqual(["已跳过 1 个未取到真实 M3U 的源。"]);
  });

  test("retries a detail page that does not expose a real m3u token at first", async () => {
    const waits = [];
    let detailRequests = 0;
    const fetchMock = async (url) => {
      if (url.endsWith("/ad_verify.php")) {
        return {
          ok: true,
          status: 200,
          headers: { get: () => null },
          text: async () => "window.__ad_ok=1;"
        };
      }
      if (url.includes("?p=top-sichuan&t=multicast")) {
        detailRequests += 1;
        return {
          ok: true,
          status: 200,
          headers: { get: () => null },
          text: async () => detailRequests === 1
            ? "<html>checking</html>"
            : '<a href="?s=retry-real-sichuan&t=multicast">📺 查看频道列表</a>'
        };
      }
      if (url.includes("?s=retry-real-sichuan&t=multicast")) {
        return {
          ok: true,
          status: 200,
          headers: { get: () => null },
          text: async () => `
            <a href="#"
               onclick="copyToClipboard('http://iptv.cqshushu.com/index.php?s=retry-real-sichuan&t=multicast&channels=1&format=m3u'); return false;"
               title="复制 M3U 接口链接">🔗 M3U接口</a>
          `
        };
      }
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        text: async () => SAMPLE_HTML
      };
    };

    const result = await discoverAutoSources({
      enabled: true,
      pageUrl: "https://iptv.cqshushu.com/index.php",
      keywords: ["电信"],
      maxPages: 1,
      detailRetryDelayMs: 4321
    }, {
      fetchImpl: fetchMock,
      sleepImpl: async (ms) => waits.push(ms),
      now: new Date("2026-07-13T12:00:00+08:00")
    });

    expect(waits).toEqual([4321]);
    expect(result.warnings).toEqual([]);
    expect(result.sources[0].url).toBe("http://iptv.cqshushu.com/index.php?s=retry-real-sichuan&t=multicast&channels=1&format=m3u");
  });

  test("deduplicates sources that resolve to the same real m3u url", async () => {
    const fetchMock = async (url) => {
      if (url.endsWith("/ad_verify.php")) {
        return {
          ok: true,
          status: 200,
          headers: { get: () => null },
          text: async () => "window.__ad_ok=1;"
        };
      }
      if (url.includes("?p=top-sichuan&t=multicast") || url.includes("?p=dup-sichuan&t=multicast")) {
        return {
          ok: true,
          status: 200,
          headers: { get: () => null },
          text: async () => '<a href="?s=same-real-sichuan&t=multicast">📺 查看频道列表</a>'
        };
      }
      if (url.includes("?s=same-real-sichuan&t=multicast")) {
        return {
          ok: true,
          status: 200,
          headers: { get: () => null },
          text: async () => `
            <a href="#"
               onclick="copyToClipboard('http://iptv.cqshushu.com/index.php?s=same-real-sichuan&t=multicast&channels=1&format=m3u'); return false;"
               title="复制 M3U 接口链接">🔗 M3U接口</a>
          `
        };
      }
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        text: async () => SAMPLE_HTML
      };
    };

    const result = await discoverAutoSources({
      enabled: true,
      pageUrl: "https://iptv.cqshushu.com/index.php",
      keywords: ["电信"],
      maxPages: 1,
      uniqueByType: false,
      detailDelayMs: 0
    }, {
      fetchImpl: fetchMock,
      sleepImpl: async () => {},
      now: new Date("2026-07-13T12:00:00+08:00")
    });

    expect(result.sources.map((source) => source.url)).toEqual([
      "http://iptv.cqshushu.com/index.php?s=same-real-sichuan&t=multicast&channels=1&format=m3u"
    ]);
    expect(result.warnings).toContain("已跳过 1 个重复 M3U 地址。");
  });

  test("retries a rate-limited discovery page before giving up", async () => {
    const requested = [];
    const waits = [];
    const fetchMock = async (url) => {
      requested.push(url);
      if (url.includes("page=2") && requested.filter((item) => item.includes("page=2")).length === 1) {
        return {
          ok: false,
          status: 429,
          headers: { get: () => null },
          text: async () => "rate limited"
        };
      }
      return {
        ok: true,
        headers: { get: () => null },
        text: async () => url.includes("page=2") ? SAMPLE_HTML : `${SAMPLE_HTML}下一页`
      };
    };

    const result = await discoverAutoSources({
      enabled: true,
      pageUrl: "https://iptv.cqshushu.com/index.php?q=%E7%94%B5%E4%BF%A1",
      keywords: ["鐢典俊"],
      maxPages: 2,
      pageDelayMs: 0,
      rateLimitDelayMs: 1234,
      uniqueByType: false
    }, {
      fetchImpl: fetchMock,
      sleepImpl: async (ms) => waits.push(ms),
      now: new Date("2026-07-13T12:00:00+08:00")
    });

    expect(requested).toEqual([
      "https://iptv.cqshushu.com/index.php?q=%E7%94%B5%E4%BF%A1",
      "https://iptv.cqshushu.com/index.php?q=%E7%94%B5%E4%BF%A1&page=2",
      "https://iptv.cqshushu.com/index.php?q=%E7%94%B5%E4%BF%A1&page=2"
    ]);
    expect(waits).toEqual([1234]);
    expect(result.pages).toEqual([
      expect.objectContaining({ page: 1, rows: 5 }),
      expect.objectContaining({ page: 2, rows: 5 })
    ]);
  });

  test("retries a temporary gateway failure discovery page", async () => {
    const requested = [];
    const waits = [];
    const fetchMock = async (url) => {
      requested.push(url);
      if (requested.length === 1) {
        return {
          ok: false,
          status: 504,
          headers: { get: () => null },
          text: async () => "gateway timeout"
        };
      }
      return {
        ok: true,
        headers: { get: () => null },
        text: async () => SAMPLE_HTML
      };
    };

    const result = await discoverAutoSources({
      enabled: true,
      pageUrl: "https://iptv.cqshushu.com/index.php?q=%E7%94%B5%E4%BF%A1",
      keywords: [],
      maxPages: 1,
      rateLimitRetries: 1,
      rateLimitDelayMs: 222,
      resolveDetailUrls: false
    }, {
      fetchImpl: fetchMock,
      sleepImpl: async (ms) => waits.push(ms),
      now: new Date("2026-07-13T12:00:00+08:00")
    });

    expect(requested).toEqual([
      "https://iptv.cqshushu.com/index.php?q=%E7%94%B5%E4%BF%A1",
      "https://iptv.cqshushu.com/index.php?q=%E7%94%B5%E4%BF%A1"
    ]);
    expect(waits).toEqual([222]);
    expect(result.pages).toEqual([
      expect.objectContaining({ page: 1, rows: 5 })
    ]);
  });
});
