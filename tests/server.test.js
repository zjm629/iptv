import request from "supertest";
import http from "node:http";
import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { jest } from "@jest/globals";
import { createApp, DEFAULT_HLS_START_TIMEOUT_MS, startServer } from "../src/server.js";
import { renderHomePage } from "../src/web.js";

function createFakeStore(channelOverrides) {
  const channels = channelOverrides || [
    {
      id: "cctv1",
      name: "CCTV-1",
      logo: "https://logo.example/cctv.png",
      group: "CCTV",
      customGroups: ["推荐频道", "央视频道"],
      sources: [
        { sourceName: "A", url: "http://a.example/cctv1.m3u8" },
        { sourceName: "B", url: "http://b.example/cctv1.m3u8" }
      ]
    }
  ];

  return {
    refresh: jest.fn(async () => ({ ok: true })),
    getSources: jest.fn(async () => [{ name: "A", url: "http://a.example/list.m3u", hidden: false }]),
    saveSources: jest.fn(async (sources) => sources),
    getAutoSourceConfig: jest.fn(() => ({
      enabled: false,
      pageUrl: "https://iptv.cqshushu.com/index.php",
      keywords: ["电信"],
      disabledTypeNames: []
    })),
    saveAutoSourceConfig: jest.fn(async (config) => config),
    discoverAutoSources: jest.fn(async () => ({
      sources: [
        {
          name: "自动-四川成都组播 四川电信",
          url: "https://iptv.cqshushu.com/index.php?s=top&t=multicast&channels=1&format=m3u",
          typeName: "四川成都组播 四川电信",
          updatedAt: "2026-07-13 12:00:00"
        }
      ],
      rows: []
    })),
    debugAutoSourceByIp: jest.fn(async (_config, ip) => ({
      targetIp: ip,
      row: { ip },
      detail: { expectedToken: "real-token" },
      channelList: {
        selectedM3uUrl: "http://iptv.cqshushu.com/index.php?s=real-token&t=multicast&channels=1&format=m3u"
      },
      m3uCheck: { channelLines: 376 }
    })),
    saveChannelOverride: jest.fn(async (_id, override) => override),
    getCategories: jest.fn(() => ["推荐频道", "央视频道", "卫视频道"]),
    saveCategories: jest.fn(async (categories) => ["推荐频道", ...categories.filter((category) => category !== "推荐频道")]),
    moveChannel: jest.fn(async () => ["cctv1"]),
    getChannels: () => channels,
    getOutputChannels: () => channels,
    getChannel: (id) => channels.find((channel) => channel.id === id) || null,
    getStatus: () => ({
      lastRefreshAt: "2026-07-05T00:00:00.000Z",
      lastSuccessAt: "2026-07-05T00:00:00.000Z",
      refreshing: false,
      channelCount: channels.length,
      sourceCount: 1,
      sources: [{ name: "A", url: "http://a.example/list.m3u", ok: true, channels: 1 }]
    })
  };
}

describe("server routes", () => {
  test("returns merged channels as json", async () => {
    const response = await request(createApp(createFakeStore())).get("/api/channels");

    expect(response.status).toBe(200);
    expect(response.body[0].id).toBe("cctv1");
    expect(response.body[0].sources).toHaveLength(2);
  });

  test("returns generated playlist", async () => {
    const response = await request(createApp(createFakeStore()))
      .get("/playlist.m3u")
      .set("Host", "vps.example:3080");

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("application/x-mpegurl");
    expect(response.text).toContain("http://vps.example:3080/play/cctv1.m3u8");
  });

  test("returns generated source-selection playlist", async () => {
    const response = await request(createApp(createFakeStore()))
      .get("/playlist-sources.m3u")
      .set("Host", "vps.example:3080");

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("application/x-mpegurl");
    expect(response.text.match(/,CCTV-1/g)).toHaveLength(2);
    expect(response.text).toContain("http://vps.example:3080/play/cctv1.m3u8?source=0");
    expect(response.text).toContain("http://vps.example:3080/play/cctv1.m3u8?source=1");
  });

  test("returns TVBox live txt with grouped channels and merged source links", async () => {
    const response = await request(createApp(createFakeStore()))
      .get("/live.txt")
      .set("Host", "vps.example:3080");

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("text/plain");
    expect(response.text).toContain("推荐频道,#genre#");
    expect(response.text).toContain("央视频道,#genre#");
    expect(response.text).toContain(
      "CCTV-1,http://vps.example:3080/play/cctv1.m3u8?source=0#http://vps.example:3080/play/cctv1.m3u8?source=1"
    );
    expect(response.text).not.toContain("全部频道,#genre#");
    expect(response.text).not.toContain("CCTV,#genre#");
    expect(response.text).not.toContain("$[");
  });

  test("returns live m3u using standard extm3u with joined source links", async () => {
    const response = await request(createApp(createFakeStore()))
      .get("/live.m3u")
      .set("Host", "vps.example:3080");

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("application/x-mpegurl");
    expect(response.text).toContain('#EXTM3U x-tvg-url="https://live.fanmingming.com/e.xml"');
    expect(response.text).toContain('#EXTINF:-1 tvg-name="CCTV-1" tvg-logo="https://logo.example/cctv.png" group-title="推荐频道",CCTV-1');
    expect(response.text).toContain(
      "http://vps.example:3080/play/cctv1.m3u8?source=0#http://vps.example:3080/play/cctv1.m3u8?source=1"
    );
    expect(response.text).not.toContain("#genre#");
  });

  test("returns non-m3u8 live txt links without fake m3u8 or stream proxy", async () => {
    const recommendedGroup = createFakeStore().getCategories()[0];
    const store = createFakeStore([
      {
        id: "sc",
        name: "SCTV",
        logo: "",
        group: "Sports",
        customGroups: [recommendedGroup],
        sources: [
          { sourceIndex: 0, sourceName: "RTP Proxy", url: "http://www.maomizi.cn:9528/rtp/239.253.43.119:5146" }
        ]
      }
    ]);

    const response = await request(createApp(store))
      .get("/live.txt")
      .set("Host", "vps.example:3080");

    expect(response.status).toBe(200);
    expect(response.text).toContain("SCTV,http://vps.example:3080/play/sc?source=0");
    expect(response.text).not.toContain("/play/sc.m3u8?source=0");
    expect(response.text).not.toContain("/stream/sc");
  });

  test("saves channel override settings", async () => {
    const store = createFakeStore();
    const response = await request(createApp(store))
      .put("/api/channels/cctv1/override")
      .send({ hidden: true });

    expect(response.status).toBe(200);
    expect(store.saveChannelOverride).toHaveBeenCalledWith("cctv1", { hidden: true });
    expect(response.body.channels[0].id).toBe("cctv1");
  });

  test("returns and saves custom categories", async () => {
    const store = createFakeStore();
    const app = createApp(store);

    const readResponse = await request(app).get("/api/categories");
    expect(readResponse.status).toBe(200);
    expect(readResponse.body).toEqual(["推荐频道", "央视频道", "卫视频道"]);

    const saveResponse = await request(app)
      .put("/api/categories")
      .send({ categories: ["卫视频道", "推荐频道"] });

    expect(saveResponse.status).toBe(200);
    expect(store.saveCategories).toHaveBeenCalledWith(["卫视频道", "推荐频道"]);
    expect(saveResponse.body.categories).toEqual(["推荐频道", "卫视频道"]);
  });

  test("moves channels in the configured order", async () => {
    const store = createFakeStore();
    const response = await request(createApp(store))
      .post("/api/channels/cctv1/move")
      .send({ direction: "up" });

    expect(response.status).toBe(200);
    expect(store.moveChannel).toHaveBeenCalledWith("cctv1", "up");
    expect(response.body.order).toEqual(["cctv1"]);
  });

  test("public playlist JSON endpoints are removed", async () => {
    const app = createApp(createFakeStore());
    const endpoints = ["/playlist.json", "/tvbox.json", "/tvbox-proxy.json", "/tvbox-direct.json", "/warehouse.json"];

    for (const endpoint of endpoints) {
      const response = await request(app).get(endpoint).set("Host", "vps.example:3080");
      expect(response.status).toBe(404);
    }
  });

  test("serves whitelisted test playlist files", async () => {
    const app = createApp(createFakeStore());
    const expected = [
      ["/test1.m3u", "CCTV1 综合"],
      ["/test2.m3u", "#genre#"],
      ["/test2.txt", "#genre#"],
      ["/test3.m3u", "#EXTM3U"],
      ["/test4.json", "m3uToTxt"]
    ];

    for (const [endpoint, marker] of expected) {
      const response = await request(app).get(endpoint);
      const content = response.text || Buffer.from(response.body).toString("utf8") || JSON.stringify(response.body);
      expect(response.status).toBe(200);
      expect(content).toContain(marker);
    }
  });

  test("redirects channel playback to requested source line", async () => {
    const response = await request(createApp(createFakeStore())).get("/play/cctv1?source=1");

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe("http://b.example/cctv1.m3u8");
  });

  test("redirects m3u8-suffixed playback links for picky players", async () => {
    const response = await request(createApp(createFakeStore())).get("/play/cctv1.m3u8?source=1");

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe("http://b.example/cctv1.m3u8");
    expect(response.headers["content-type"]).toContain("application/vnd.apple.mpegurl");
  });

  test("redirects playback by stable source index after source order changes", async () => {
    const channels = [
      {
        id: "cctv1",
        name: "CCTV-1",
        sources: [
          { sourceIndex: 1, sourceName: "B", url: "http://b.example/cctv1.m3u8" },
          { sourceIndex: 0, sourceName: "A", url: "http://a.example/cctv1.m3u8" }
        ]
      }
    ];
    const store = {
      ...createFakeStore(),
      getChannel: (id) => channels.find((channel) => channel.id === id) || null
    };

    const response = await request(createApp(store)).get("/play/cctv1?source=0");

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe("http://a.example/cctv1.m3u8");
  });

  test("redirects management line playback by displayed line index", async () => {
    const sources = Array.from({ length: 38 }, (_value, index) => ({
      sourceIndex: index === 0 ? 37 : index - 1,
      sourceName: `Line ${index + 1}`,
      url: `http://source-${index + 1}.example/cctv1.m3u8`
    }));
    const channels = [
      {
        id: "cctv1",
        name: "CCTV-1",
        sources
      }
    ];
    const store = {
      ...createFakeStore(),
      getChannel: (id) => channels.find((channel) => channel.id === id) || null
    };

    const response = await request(createApp(store)).get("/play/cctv1?line=37");

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe("http://source-38.example/cctv1.m3u8");
  });

  test("serves browser player page for a channel source", async () => {
    const response = await request(createApp(createFakeStore()))
      .get("/player/cctv1?source=1")
      .set("Host", "vps.example:3080");

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("text/html");
    expect(response.text).toContain("CCTV-1");
    expect(response.text).toContain("http://b.example/cctv1.m3u8");
    expect(response.text).toContain("video");
    expect(response.text).toContain("playsinline autoplay");
    expect(response.text).toContain("hls.js");
    expect(response.text).toContain("PotPlayer打开");
    expect(response.text).toContain("potplayer://");
    expect(response.text).toContain("未安装或未注册 potplayer:// 协议");
  });

  test("serves browser player page by displayed line index", async () => {
    const sources = Array.from({ length: 38 }, (_value, index) => ({
      sourceIndex: index === 0 ? 37 : index - 1,
      sourceName: `Line ${index + 1}`,
      url: `http://source-${index + 1}.example/cctv1.m3u8`
    }));
    const channels = [
      {
        id: "cctv1",
        name: "CCTV-1",
        sources
      }
    ];
    const store = {
      ...createFakeStore(),
      getChannel: (id) => channels.find((channel) => channel.id === id) || null
    };

    const response = await request(createApp(store))
      .get("/player/cctv1?line=37")
      .set("Host", "vps.example:3080");

    expect(response.status).toBe(200);
    expect(response.text).toContain("http://source-38.example/cctv1.m3u8");
    expect(response.text).not.toContain("http://source-1.example/cctv1.m3u8");
  });

  test("serves browser player source query by displayed line for management compatibility", async () => {
    const sources = Array.from({ length: 38 }, (_value, index) => ({
      sourceIndex: index === 0 ? 37 : index - 1,
      sourceName: `Line ${index + 1}`,
      url: `http://source-${index + 1}.example/cctv1.m3u8`
    }));
    const channels = [
      {
        id: "cctv1",
        name: "CCTV-1",
        sources
      }
    ];
    const store = {
      ...createFakeStore(),
      getChannel: (id) => channels.find((channel) => channel.id === id) || null
    };

    const response = await request(createApp(store))
      .get("/player/cctv1?source=37")
      .set("Host", "vps.example:3080");

    expect(response.status).toBe(200);
    expect(response.text).toContain("http://source-38.example/cctv1.m3u8");
    expect(response.text).not.toContain("http://source-1.example/cctv1.m3u8");
  });

  test("returns 404 when requested source line is out of range", async () => {
    const sources = Array.from({ length: 37 }, (_value, index) => ({
      sourceIndex: index,
      sourceName: `Line ${index + 1}`,
      url: `http://source-${index + 1}.example/cctv1.m3u8`
    }));
    const channels = [
      {
        id: "cctv1",
        name: "CCTV-1",
        sources
      }
    ];
    const store = {
      ...createFakeStore(),
      getChannel: (id) => channels.find((channel) => channel.id === id) || null
    };

    await request(createApp(store)).get("/player/cctv1?source=37").expect(404);
    await request(createApp(store)).get("/play/cctv1?source=37").expect(404);
    await request(createApp(store)).get("/stream/cctv1?source=37").expect(404);
  });

  test("uses direct proxied hls for remote m3u8 source testing", async () => {
    const store = createFakeStore([
      {
        id: "cctv1",
        name: "CCTV1",
        sources: [
          { sourceIndex: 35, sourceName: "gddx_jd", url: "http://183.2.73.7:9901/tsfile/live/0001_1.m3u8?key=txiptv" }
        ]
      }
    ]);

    const response = await request(createApp(store))
      .get("/player/cctv1?source=35")
      .set("Host", "vps.example:3080");

    expect(response.status).toBe(200);
    expect(response.text).toContain("http://183.2.73.7:9901/tsfile/live/0001_1.m3u8?key=txiptv");
    expect(response.text).toContain("const useDirectHls = true");
    expect(response.text).toContain("loadDirectHls(streamUrl");
    expect(response.text).toContain("ffmpeg-preview");
    expect(response.text).toContain("liveSyncDurationCount: 5");
    expect(response.text).toContain("maxBufferLength: 30");
    expect(response.text).toContain("lowLatencyMode: false");
  });

  test("uses longer default hls preview startup timeout", () => {
    expect(DEFAULT_HLS_START_TIMEOUT_MS).toBe(25000);
  });

  test("serves ffmpeg hls player support for http rtp proxy streams", async () => {
    const store = createFakeStore([
      {
        id: "sc",
        name: "SCTV",
        sources: [
          { sourceIndex: 0, sourceName: "RTP Proxy", url: "http://www.maomizi.cn:9528/rtp/239.253.43.119:5146" }
        ]
      }
    ]);

    const response = await request(createApp(store))
      .get("/player/sc?source=0")
      .set("Host", "vps.example:3080");

    expect(response.status).toBe(200);
    expect(response.text).toContain("/stream/sc.ts?source=0");
    expect(response.text).toMatch(/\/hls\/sc\/0\/[^/]+\/index\.m3u8/);
    expect(response.text).toContain("mpegts.createPlayer");
    expect(response.text).toContain("loadMpegTs");
    expect(response.text).toContain("ffmpeg-preview");
    expect(response.text).toContain("loadHlsPreview");
    expect(response.text).toContain("player-status");
    expect(response.text).toContain("start-overlay");
    expect(response.text).toContain("点击播放");
    expect(response.text).toContain("toggle-muted");
    expect(response.text).toContain("resetVideoElement");
    expect(response.text).toContain("loadHlsPreview");
    expect(response.text).toContain("restart=1");
    expect(response.text).toContain("isSafariNativeHls");
    expect(response.text).toContain("Hls.Events.MANIFEST_PARSED");
    expect(response.text).toContain("recoverMediaError");
    expect(response.text).toContain("data.fatal");
    expect(response.text).toContain("tryAutoplay");
    expect(response.text).toContain("muted = false");
    expect(response.text).toContain("muted = true");
  });

  test("serves suffixed stream proxy urls for picky players", async () => {
    const upstream = http.createServer((_req, res) => {
      res.writeHead(200, { "content-type": "video/mp2t" });
      res.end("stream-data");
    });
    await new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve));
    const { port } = upstream.address();

    try {
      const store = createFakeStore([
        {
          id: "sc",
          name: "SCTV",
          sources: [
            { sourceIndex: 0, sourceName: "RTP Proxy", url: `http://127.0.0.1:${port}/rtp/239.253.43.119:5146` }
          ]
        }
      ]);

      const response = await request(createApp(store)).get("/stream/sc.ts?source=0");

      expect(response.status).toBe(200);
      expect(response.headers["content-type"]).toContain("video/mp2t");
      expect(Buffer.from(response.body).toString("utf8")).toBe("stream-data");
    } finally {
      await new Promise((resolve) => upstream.close(resolve));
    }
  });

  test("uses source url version in hls preview links", async () => {
    const channel = {
      id: "sc",
      name: "SCTV",
      sources: [
        { sourceIndex: 0, sourceName: "A", url: "http://example.test/rtp/239.0.0.1:5146" }
      ]
    };
    const storeA = createFakeStore([channel]);
    const storeB = createFakeStore([
      {
        ...channel,
        sources: [
          { sourceIndex: 0, sourceName: "B", url: "http://example.test/rtp/239.0.0.2:5146" }
        ]
      }
    ]);

    const responseA = await request(createApp(storeA)).get("/player/sc?source=0").set("Host", "vps.example:3080");
    const responseB = await request(createApp(storeB)).get("/player/sc?source=0").set("Host", "vps.example:3080");
    const hlsA = responseA.text.match(/\/hls\/sc\/0\/[^/]+\/index\.m3u8/)?.[0];
    const hlsB = responseB.text.match(/\/hls\/sc\/0\/[^/]+\/index\.m3u8/)?.[0];

    expect(hlsA).toBeTruthy();
    expect(hlsB).toBeTruthy();
    expect(hlsA).not.toBe(hlsB);
  });

  test("proxies stream data for browser source testing", async () => {
    const upstream = http.createServer((_req, res) => {
      res.writeHead(200, { "content-type": "video/mp2t" });
      res.end("stream-data");
    });
    await new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve));
    const { port } = upstream.address();

    try {
      const store = createFakeStore([
        {
          id: "sc",
          name: "SCTV",
          sources: [
            { sourceIndex: 0, sourceName: "RTP Proxy", url: `http://127.0.0.1:${port}/live.ts` }
          ]
        }
      ]);

      const response = await request(createApp(store)).get("/stream/sc?source=0");

      expect(response.status).toBe(200);
      expect(response.headers["content-type"]).toContain("video/mp2t");
      expect(Buffer.from(response.body).toString("utf8")).toBe("stream-data");
    } finally {
      await new Promise((resolve) => upstream.close(resolve));
    }
  });

  test("rewrites proxied m3u8 relative segments through stream endpoint", async () => {
    const upstream = http.createServer((req, res) => {
      if (req.url.startsWith("/tsfile/live/0001_1.m3u8")) {
        res.writeHead(200, { "content-type": "application/vnd.apple.mpegurl" });
        res.end("#EXTM3U\n#EXTINF:5,\nlive_1_1_1.ts?key=txiptv&key2=1\n");
        return;
      }
      if (req.url.startsWith("/tsfile/live/live_1_1_1.ts")) {
        res.writeHead(200, { "content-type": "video/mp2t" });
        res.end("segment-data");
        return;
      }
      res.writeHead(404);
      res.end("missing");
    });
    await new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve));
    const { port } = upstream.address();
    const sourceUrl = `http://127.0.0.1:${port}/tsfile/live/0001_1.m3u8?key=txiptv`;

    try {
      const store = createFakeStore([
        {
          id: "cctv1",
          name: "CCTV1",
          sources: [
            { sourceIndex: 35, sourceName: "gddx_jd", url: sourceUrl }
          ]
        }
      ]);
      const app = createApp(store);
      const playlistResponse = await request(app)
        .get("/stream/cctv1?source=35")
        .set("Host", "vps.example:3080");

      expect(playlistResponse.status).toBe(200);
      expect(playlistResponse.headers["content-type"]).toContain("application/vnd.apple.mpegurl");
      expect(playlistResponse.text).toContain("/stream/cctv1?source=35&asset=");
      expect(playlistResponse.text).not.toContain("\nlive_1_1_1.ts");

      const assetPath = playlistResponse.text.match(/\/stream\/cctv1\?source=35&asset=[^\n]+/)?.[0];
      expect(assetPath).toBeTruthy();

      const segmentResponse = await request(app).get(assetPath);
      expect(segmentResponse.status).toBe(200);
      expect(segmentResponse.headers["content-type"]).toContain("video/mp2t");
      expect(Buffer.from(segmentResponse.body).toString("utf8")).toBe("segment-data");
    } finally {
      await new Promise((resolve) => upstream.close(resolve));
    }
  });

  test("rewrites proxied m3u8 through suffixed stream endpoint", async () => {
    const upstream = http.createServer((req, res) => {
      if (req.url.startsWith("/live/index.m3u8")) {
        res.writeHead(200, { "content-type": "application/vnd.apple.mpegurl" });
        res.end("#EXTM3U\n#EXTINF:5,\nsegment.ts\n");
        return;
      }
      if (req.url.startsWith("/live/segment.ts")) {
        res.writeHead(200, { "content-type": "video/mp2t" });
        res.end("segment-data");
        return;
      }
      res.writeHead(404);
      res.end("missing");
    });
    await new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve));
    const { port } = upstream.address();

    try {
      const store = createFakeStore([
        {
          id: "cctv1",
          name: "CCTV1",
          sources: [
            { sourceIndex: 0, sourceName: "A", url: `http://127.0.0.1:${port}/live/index.m3u8` }
          ]
        }
      ]);
      const response = await request(createApp(store))
        .get("/stream/cctv1.m3u8?source=0")
        .set("Host", "vps.example:3080");

      expect(response.status).toBe(200);
      expect(response.headers["content-type"]).toContain("application/vnd.apple.mpegurl");
      expect(response.text).toContain("/stream/cctv1?source=0&asset=");
      expect(response.text).not.toContain("\nsegment.ts");
    } finally {
      await new Promise((resolve) => upstream.close(resolve));
    }
  });

  test("starts ffmpeg hls preview for stream testing", async () => {
    const hlsRoot = await fs.mkdtemp(path.join(os.tmpdir(), "iptv-hls-"));
    const processMock = new EventEmitter();
    processMock.stderr = new EventEmitter();
    processMock.kill = jest.fn();
    const spawnImpl = jest.fn((_command, args) => {
      const outputPath = args.at(-1);
      setTimeout(async () => {
        await fs.mkdir(path.dirname(outputPath), { recursive: true });
        await fs.writeFile(outputPath, "#EXTM3U\n#EXT-X-VERSION:3\n#EXTINF:2,\nsegment_00000.ts\n", "utf8");
      }, 5);
      return processMock;
    });
    const store = createFakeStore([
      {
        id: "sc",
        name: "SCTV",
        sources: [
          { sourceIndex: 0, sourceName: "RTP Proxy", url: "http://example.test/rtp/239.253.43.119:5146" }
        ]
      }
    ]);

    try {
      const app = createApp(store, { hlsRoot, spawnImpl, hlsStartTimeoutMs: 1000 });
      const playerResponse = await request(app).get("/player/sc?source=0");
      const hlsPath = playerResponse.text.match(/\/hls\/sc\/0\/[^/]+\/index\.m3u8/)?.[0];

      expect(hlsPath).toBeTruthy();

      const response = await request(app).get(hlsPath);

      expect(response.status).toBe(200);
      expect(response.headers["content-type"]).toContain("application/vnd.apple.mpegurl");
      expect(response.text).toContain("#EXTM3U");
      expect(spawnImpl).toHaveBeenCalledWith("ffmpeg", expect.arrayContaining([
        "-i",
        "http://example.test/rtp/239.253.43.119:5146",
        "-vf",
        "scale=w='min(854,iw)':h=-2",
        "-c:v",
        "libx264",
        "-preset",
        "ultrafast",
        "-b:v",
        "1200k",
        "-maxrate",
        "1500k",
        "-bufsize",
        "3000k",
        "-b:a",
        "96k",
        "-pix_fmt",
        "yuv420p",
        "-f",
        "hls"
      ]), expect.any(Object));
      const ffmpegArgs = spawnImpl.mock.calls[0][1];
      expect(ffmpegArgs).not.toContain("copy");
    } finally {
      await fs.rm(hlsRoot, { recursive: true, force: true });
    }
  });

  test("stops idle ffmpeg hls preview after playback stops", async () => {
    const hlsRoot = await fs.mkdtemp(path.join(os.tmpdir(), "iptv-hls-"));
    const processMock = new EventEmitter();
    processMock.stderr = new EventEmitter();
    processMock.exitCode = null;
    processMock.signalCode = null;
    processMock.kill = jest.fn();
    const spawnImpl = jest.fn((_command, args) => {
      const outputPath = args.at(-1);
      setTimeout(async () => {
        await fs.mkdir(path.dirname(outputPath), { recursive: true });
        await fs.writeFile(outputPath, "#EXTM3U\n#EXT-X-VERSION:3\n#EXTINF:2,\nsegment_00000.ts\n", "utf8");
      }, 5);
      return processMock;
    });
    const store = createFakeStore([
      {
        id: "sc",
        name: "SCTV",
        sources: [
          { sourceIndex: 0, sourceName: "RTP Proxy", url: "http://example.test/rtp/239.253.43.119:5146" }
        ]
      }
    ]);

    try {
      const app = createApp(store, { hlsRoot, spawnImpl, hlsStartTimeoutMs: 1000, hlsIdleTimeoutMs: 300 });
      const playerResponse = await request(app).get("/player/sc?source=0");
      const hlsPath = playerResponse.text.match(/\/hls\/sc\/0\/[^/]+\/index\.m3u8/)?.[0];

      expect(hlsPath).toBeTruthy();

      await request(app).get(hlsPath).expect(200);
      expect(processMock.kill).not.toHaveBeenCalled();

      await new Promise((resolve) => setTimeout(resolve, 380));

      expect(processMock.kill).toHaveBeenCalledWith("SIGTERM");
    } finally {
      await fs.rm(hlsRoot, { recursive: true, force: true });
    }
  });

  test("restarts hls preview when playlist is requested after ffmpeg exits", async () => {
    const hlsRoot = await fs.mkdtemp(path.join(os.tmpdir(), "iptv-hls-"));
    const processes = [];
    const spawnImpl = jest.fn((_command, args) => {
      const outputPath = args.at(-1);
      const spawnNumber = processes.length + 1;
      const processMock = new EventEmitter();
      processMock.stderr = new EventEmitter();
      processMock.exitCode = null;
      processMock.signalCode = null;
      processMock.kill = jest.fn();
      processes.push(processMock);
      setTimeout(async () => {
        const dir = path.dirname(outputPath);
        await fs.mkdir(dir, { recursive: true });
        await fs.writeFile(path.join(dir, `segment_${spawnNumber}.ts`), `segment-${spawnNumber}`, "utf8");
        await fs.writeFile(outputPath, `#EXTM3U\n#EXT-X-VERSION:3\n#EXTINF:2,\nsegment_${spawnNumber}.ts\n`, "utf8");
      }, 5);
      return processMock;
    });
    const store = createFakeStore([
      {
        id: "sc",
        name: "SCTV",
        sources: [
          { sourceIndex: 0, sourceName: "RTP Proxy", url: "http://example.test/rtp/239.253.43.119:5146" }
        ]
      }
    ]);

    try {
      const app = createApp(store, { hlsRoot, spawnImpl, hlsStartTimeoutMs: 1000 });
      const playerResponse = await request(app).get("/player/sc?source=0");
      const hlsPath = playerResponse.text.match(/\/hls\/sc\/0\/[^/]+\/index\.m3u8/)?.[0];

      expect(hlsPath).toBeTruthy();

      await request(app).get(hlsPath).expect(200);
      processes[0].exitCode = 1;
      processes[0].emit("exit", 1);

      const playlistResponse = await request(app).get(hlsPath);

      expect(playlistResponse.status).toBe(200);
      expect(playlistResponse.text).toContain("segment_2.ts");
      expect(spawnImpl).toHaveBeenCalledTimes(2);
    } finally {
      await fs.rm(hlsRoot, { recursive: true, force: true });
    }
  });

  test("triggers manual refresh", async () => {
    const store = createFakeStore();
    const response = await request(createApp(store)).post("/api/refresh");

    expect(response.status).toBe(200);
    expect(store.refresh).toHaveBeenCalledTimes(1);
    expect(response.body.channelCount).toBe(1);
  });

  test("returns configured sources", async () => {
    const response = await request(createApp(createFakeStore())).get("/api/sources");

    expect(response.status).toBe(200);
    expect(response.body).toEqual([{ name: "A", url: "http://a.example/list.m3u", hidden: false }]);
  });

  test("saves sources and refreshes immediately", async () => {
    const store = createFakeStore();
    const sources = [{ name: "B", url: "http://b.example/list.m3u", hidden: true }];
    const response = await request(createApp(store)).put("/api/sources").send({ sources });

    expect(response.status).toBe(200);
    expect(store.saveSources).toHaveBeenCalledWith(sources);
    expect(store.refresh).toHaveBeenCalledTimes(1);
    expect(response.body.sources).toEqual(sources);
  });

  test("rejects invalid source payloads", async () => {
    const store = createFakeStore();
    store.saveSources.mockRejectedValueOnce(new Error("Source URL is required"));

    const response = await request(createApp(store))
      .put("/api/sources")
      .send({ sources: [{ name: "Broken", url: "" }] });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("Source URL is required");
  });

  test("returns and saves auto source config", async () => {
    const store = createFakeStore();
    const app = createApp(store);

    const readResponse = await request(app).get("/api/auto-sources");
    expect(readResponse.status).toBe(200);
    expect(readResponse.body).toEqual(expect.objectContaining({
      enabled: false,
      keywords: ["电信"]
    }));

    const config = {
      enabled: true,
      keywords: ["电信"],
      disabledTypeNames: ["四川成都组播 四川电信"]
    };
    const saveResponse = await request(app).put("/api/auto-sources").send(config);

    expect(saveResponse.status).toBe(200);
    expect(store.saveAutoSourceConfig).toHaveBeenCalledWith(config);
    expect(store.refresh).toHaveBeenCalledTimes(1);
    expect(saveResponse.body.config).toEqual(config);
  });

  test("previews auto source discovery without saving", async () => {
    const store = createFakeStore();
    const response = await request(createApp(store))
      .post("/api/auto-sources/discover")
      .send({ enabled: true, keywords: ["电信"] });

    expect(response.status).toBe(200);
    expect(store.discoverAutoSources).toHaveBeenCalledWith({ enabled: true, keywords: ["电信"] });
    expect(response.body.sources[0].typeName).toBe("四川成都组播 四川电信");
  });

  test("returns detailed auto source debug output for a target ip", async () => {
    const store = createFakeStore();
    const response = await request(createApp(store))
      .post("/api/auto-sources/debug")
      .send({
        ip: "171.98.232.148",
        config: {
          enabled: true,
          pageUrl: "https://iptv.cqshushu.com/index.php",
          keywords: []
        }
      });

    expect(response.status).toBe(200);
    expect(store.debugAutoSourceByIp).toHaveBeenCalledWith(
      expect.objectContaining({
        enabled: true,
        pageUrl: "https://iptv.cqshushu.com/index.php",
        keywords: []
      }),
      "171.98.232.148"
    );
    expect(response.body.targetIp).toBe("171.98.232.148");
    expect(response.body.detail.expectedToken).toBe("real-token");
    expect(response.body.channelList.selectedM3uUrl).toContain("format=m3u");
    expect(response.body.m3uCheck.channelLines).toBe(376);
  });

  test("runs auto source discovery as a progress job", async () => {
    const store = createFakeStore();
    store.discoverAutoSources = jest.fn(async (_config, options = {}) => {
      options.onProgress?.({ phase: "source:start", ip: "1.1.1.1", message: "开始采集 1.1.1.1" });
      options.onProgress?.({ phase: "source:added", ip: "1.1.1.1", message: "采集成功 1.1.1.1" });
      return {
        sources: [{ typeName: "A", url: "http://example.com/a.m3u" }],
        rows: [{ ip: "1.1.1.1" }],
        warnings: []
      };
    });

    const app = createApp(store);
    const startResponse = await request(app)
      .post("/api/auto-sources/discover-jobs")
      .send({ enabled: true, keywords: ["电信"] });

    expect(startResponse.status).toBe(200);
    expect(startResponse.body).toEqual(expect.objectContaining({
      id: expect.any(String),
      status: "running"
    }));

    let jobResponse;
    for (let attempt = 0; attempt < 10; attempt += 1) {
      jobResponse = await request(app).get(`/api/auto-sources/discover-jobs/${startResponse.body.id}`);
      if (jobResponse.body.status === "done") {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 5));
    }

    expect(jobResponse.status).toBe(200);
    expect(jobResponse.body.status).toBe("done");
    expect(jobResponse.body.progress).toEqual(expect.arrayContaining([
      expect.objectContaining({ phase: "source:start", ip: "1.1.1.1" }),
      expect.objectContaining({ phase: "source:added", ip: "1.1.1.1" })
    ]));
    expect(jobResponse.body.result.sources[0].url).toBe("http://example.com/a.m3u");
    expect(store.discoverAutoSources).toHaveBeenCalledWith(
      { enabled: true, keywords: ["电信"] },
      expect.objectContaining({ onProgress: expect.any(Function) })
    );
  });

  test("cancels a running auto source discovery job", async () => {
    const store = createFakeStore();
    let capturedSignal;
    store.discoverAutoSources = jest.fn(async (_config, options = {}) => {
      capturedSignal = options.signal;
      options.onProgress?.({ phase: "source:start", ip: "1.1.1.1", message: "start" });
      options.onProgress?.({
        phase: "source:added",
        ip: "1.1.1.1",
        typeName: "A",
        m3uUrl: "http://example.com/a.m3u",
        row: {
          channelCount: 10,
          updatedAt: "2026-07-16 10:00:00",
          status: "new"
        },
        message: "collected"
      });
      return new Promise((_resolve, reject) => {
        options.signal?.addEventListener("abort", () => {
          reject(Object.assign(new Error("Collector job cancelled"), { name: "AbortError" }));
        });
      });
    });

    const app = createApp(store);
    const startResponse = await request(app)
      .post("/api/auto-sources/discover-jobs")
      .send({ enabled: true });

    for (let attempt = 0; attempt < 10 && !capturedSignal; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }

    const cancelResponse = await request(app)
      .post(`/api/auto-sources/discover-jobs/${startResponse.body.id}/cancel`);

    expect(cancelResponse.status).toBe(200);
    expect(cancelResponse.body.status).toBe("cancelled");
    expect(capturedSignal.aborted).toBe(true);
    expect(cancelResponse.body.result.sources).toEqual([
      expect.objectContaining({
        ip: "1.1.1.1",
        typeName: "A",
        url: "http://example.com/a.m3u",
        channelCount: 10,
        updatedAt: "2026-07-16 10:00:00",
        status: "new"
      })
    ]);

    let jobResponse;
    for (let attempt = 0; attempt < 10; attempt += 1) {
      jobResponse = await request(app).get(`/api/auto-sources/discover-jobs/${startResponse.body.id}`);
      if (jobResponse.body.status === "cancelled") {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 5));
    }

    expect(jobResponse.body.status).toBe("cancelled");
    expect(jobResponse.body.progress).toEqual(expect.arrayContaining([
      expect.objectContaining({ phase: "discover:cancelled" })
    ]));
    expect(jobResponse.body.result.sources[0].url).toBe("http://example.com/a.m3u");
    expect(store.discoverAutoSources).toHaveBeenCalledWith(
      { enabled: true },
      expect.objectContaining({
        onProgress: expect.any(Function),
        signal: expect.any(AbortSignal)
      })
    );
  });

  test("collects discovered auto sources into configured sources", async () => {
    const store = createFakeStore();
    const selectedSources = [
      {
        typeName: "四川成都组播 四川电信",
        url: "https://iptv.cqshushu.com/index.php?s=top&t=multicast&channels=1&format=m3u"
      }
    ];
    const response = await request(createApp(store))
      .post("/api/auto-sources/collect")
      .send({ sources: selectedSources });

    expect(response.status).toBe(200);
    expect(store.discoverAutoSources).not.toHaveBeenCalled();
    expect(store.saveSources).toHaveBeenCalledWith([
      { name: "A", url: "http://a.example/list.m3u", hidden: false },
      {
        name: "四川成都组播 四川电信",
        url: "https://iptv.cqshushu.com/index.php?s=top&t=multicast&channels=1&format=m3u",
        hidden: false
      }
    ]);
    expect(store.refresh).toHaveBeenCalledTimes(1);
    expect(response.body.added).toHaveLength(1);
  });

  test("updates matching configured source when collected source has the same name", async () => {
    const store = createFakeStore();
    store.getSources = jest.fn(async () => [
      {
        name: "陕西西安组播 陕西电信",
        url: "http://old.example/shaanxi.m3u",
        hidden: true
      },
      {
        name: "四川成都组播 四川电信",
        url: "http://old.example/sichuan.m3u",
        hidden: false
      }
    ]);

    const response = await request(createApp(store))
      .post("/api/auto-sources/collect")
      .send({
        sources: [
          {
            typeName: "陕西西安组播 陕西电信",
            url: "http://iptv.cqshushu.com/index.php?s=new-shaanxi&t=multicast&channels=1&format=m3u"
          }
        ]
      });

    expect(response.status).toBe(200);
    expect(store.saveSources).toHaveBeenCalledWith([
      {
        name: "陕西西安组播 陕西电信",
        url: "http://iptv.cqshushu.com/index.php?s=new-shaanxi&t=multicast&channels=1&format=m3u",
        hidden: true
      },
      {
        name: "四川成都组播 四川电信",
        url: "http://old.example/sichuan.m3u",
        hidden: false
      }
    ]);
    expect(store.refresh).toHaveBeenCalledTimes(1);
    expect(response.body.added).toEqual([]);
    expect(response.body.updated).toEqual([
      expect.objectContaining({
        name: "陕西西安组播 陕西电信",
        url: "http://iptv.cqshushu.com/index.php?s=new-shaanxi&t=multicast&channels=1&format=m3u",
        hidden: true
      })
    ]);
  });

  test("returns web management page", async () => {
    const response = await request(createApp(createFakeStore(), { appVersion: "abc1234" })).get("/");

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("text/html");
    expect(response.text).toContain("IPTV M3U Manager");
    expect(response.text).toContain("版本：abc1234");
    expect(response.text).toContain("source-editor");
    expect(response.text).toContain("/collector");
    expect(response.text).toContain("auto-source-editor");
    expect(response.text).toContain("auto-source-enabled");
    expect(response.text).toContain("toggle-source-hidden");
    expect(response.text).toContain("move-source");
    expect(response.text).toContain("playlist-sources.m3u");
    expect(response.text).toContain("live.txt");
    expect(response.text).toContain("live.m3u");
    expect(response.text).toContain("id=\"live-m3u-potplayer\"");
    expect(response.text).toContain("window.location.origin + \"/live.m3u\"");
    expect(response.text).toContain("PotPlayer播放");
    expect(response.text).not.toContain("playlist-sources-potplayer");
    expect(response.text).not.toContain("live-txt-potplayer");
    expect(response.text).toContain("sort-order");
    expect(response.text).toContain("序号");
    expect(response.text).toContain("category-checkbox");
    expect(response.text).toContain("move-category");
    expect(response.text).toContain("分类");
    expect(response.text).toContain("测试播放");
    expect(response.text).toContain("设为默认");
    expect(response.text).toContain("置顶");
    expect(response.text).toContain("上移");
    expect(response.text).toContain("置底");
    expect(response.text).toContain("data-direction='bottom'");
    expect(response.text).not.toContain("playlist.json");
    expect(response.text).not.toContain("tvbox.json");
    expect(response.text).not.toContain("warehouse.json");
  });

  test("returns collector page", async () => {
    const response = await request(createApp(createFakeStore(), { appVersion: "abc1234" })).get("/collector");

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("text/html");
    expect(response.text).toContain("自动采集");
    expect(response.text).toContain("版本：abc1234");
    expect(response.text).toContain("collector-page-url");
    expect(response.text).toContain("collector-click-delay");
    expect(response.text).toContain("event.m3uUrl");
    expect(response.text).toContain("M3U 实际地址");
    expect(response.text).toContain("https://iptv.cqshushu.com/index.php?q=%E7%94%B5%E4%BF%A1");
    expect(response.text).toContain("/api/auto-sources/collect");
    expect(response.text).toContain("select-all");
    expect(response.text).toContain("PotPlayer测试");
    expect(response.text).toContain("potplayer://");
    expect(response.text).toContain("频道数");
    expect(response.text).toContain("更新时间");
    expect(response.text).toContain("result.updated");
    expect(response.text).toContain("requestTimeoutMs");
    expect(response.text).toContain("page.error");
    expect(response.text).toContain("parseJsonResponse");
    expect(response.text).toContain("stop-preview");
    expect(response.text).toContain("/cancel");
    expect(response.text.match(/renderDiscovery\(job\.result \|\| \{\}\);/g)).toHaveLength(3);
    expect(response.text).toContain("保留已成功");
    expect(response.text).toContain("服务器返回空响应");
    expect(response.text).toContain("服务器返回的不是 JSON");
    expect(response.text).toContain("未解析到源列表");
  });

  test("returns app version as json", async () => {
    const response = await request(createApp(createFakeStore(), { appVersion: "abc1234" })).get("/api/version");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ version: "abc1234" });
  });

  test("starts listening before the initial refresh finishes", async () => {
    let resolveRefresh;
    const store = createFakeStore();
    store.load = jest.fn(async () => {});
    store.refresh = jest.fn(() => new Promise((resolve) => {
      resolveRefresh = resolve;
    }));
    const cronImpl = {
      schedule: jest.fn(() => ({ stop: jest.fn() }))
    };

    const server = await Promise.race([
      startServer({ store, port: 0, cronImpl, log: () => {} }),
      new Promise((resolve) => setTimeout(() => resolve(null), 100))
    ]);

    expect(server).toBeTruthy();
    try {
      const port = server.address().port;
      const response = await request(`http://127.0.0.1:${port}`).get("/");

      expect(response.status).toBe(200);
      expect(store.load).toHaveBeenCalledTimes(1);
      expect(store.refresh).toHaveBeenCalledTimes(1);
      expect(cronImpl.schedule).toHaveBeenCalledTimes(1);
    } finally {
      resolveRefresh?.({});
      await new Promise((resolve) => server?.close(resolve));
    }
  });

  test("serves web management page with valid inline scripts", () => {
    const html = renderHomePage();
    const scripts = Array.from(html.matchAll(/<script>([\s\S]*?)<\/script>/g), (match) => match[1]);

    expect(scripts.length).toBeGreaterThan(0);
    for (const script of scripts) {
      expect(() => new Function(script)).not.toThrow();
    }
  });
});
