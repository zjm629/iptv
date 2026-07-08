import request from "supertest";
import { jest } from "@jest/globals";
import { createApp } from "../src/server.js";

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
    getSources: jest.fn(async () => [{ name: "A", url: "http://a.example/list.m3u" }]),
    saveSources: jest.fn(async (sources) => sources),
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
    expect(response.text).toContain("http://vps.example:3080/play/cctv1");
  });

  test("returns generated source-selection playlist", async () => {
    const response = await request(createApp(createFakeStore()))
      .get("/playlist-sources.m3u")
      .set("Host", "vps.example:3080");

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("application/x-mpegurl");
    expect(response.text.match(/,CCTV-1/g)).toHaveLength(2);
    expect(response.text).toContain("http://vps.example:3080/play/cctv1?source=0");
    expect(response.text).toContain("http://vps.example:3080/play/cctv1?source=1");
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
      "CCTV-1,http://vps.example:3080/play/cctv1?source=0#http://vps.example:3080/play/cctv1?source=1"
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
      "http://vps.example:3080/play/cctv1?source=0#http://vps.example:3080/play/cctv1?source=1"
    );
    expect(response.text).not.toContain("#genre#");
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

  test("serves browser player page for a channel source", async () => {
    const response = await request(createApp(createFakeStore()))
      .get("/player/cctv1?source=1")
      .set("Host", "vps.example:3080");

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("text/html");
    expect(response.text).toContain("CCTV-1");
    expect(response.text).toContain("http://b.example/cctv1.m3u8");
    expect(response.text).toContain("video");
    expect(response.text).toContain("hls.js");
  });

  test("serves mpeg-ts player support for http rtp proxy streams", async () => {
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
    expect(response.text).toContain("mpegts.js");
    expect(response.text).toContain("/stream/sc?source=0");
    expect(response.text).toContain('type: "mpegts"');
    expect(response.text).toContain("mpegts.Events.ERROR");
    expect(response.text).toContain("player-status");
    expect(response.text).toContain("toggle-muted");
    expect(response.text).toContain("resetVideoElement");
    expect(response.text).toContain("MediaMSEError");
    expect(response.text).toContain("使用 mpegts.js");
  });

  test("proxies stream data for browser source testing", async () => {
    const originalFetch = global.fetch;
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("stream-data"));
        controller.close();
      }
    });
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "video/mp2t" }),
      body
    }));

    try {
      const store = createFakeStore([
        {
          id: "sc",
          name: "SCTV",
          sources: [
            { sourceIndex: 0, sourceName: "RTP Proxy", url: "http://www.maomizi.cn:9528/rtp/239.253.43.119:5146" }
          ]
        }
      ]);

      const response = await request(createApp(store)).get("/stream/sc?source=0");

      expect(response.status).toBe(200);
      expect(response.headers["content-type"]).toContain("video/mp2t");
      expect(Buffer.from(response.body).toString("utf8")).toBe("stream-data");
      expect(global.fetch).toHaveBeenCalledWith("http://www.maomizi.cn:9528/rtp/239.253.43.119:5146", expect.objectContaining({ redirect: "follow" }));
    } finally {
      global.fetch = originalFetch;
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
    expect(response.body).toEqual([{ name: "A", url: "http://a.example/list.m3u" }]);
  });

  test("saves sources and refreshes immediately", async () => {
    const store = createFakeStore();
    const sources = [{ name: "B", url: "http://b.example/list.m3u" }];
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

  test("returns web management page", async () => {
    const response = await request(createApp(createFakeStore())).get("/");

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("text/html");
    expect(response.text).toContain("IPTV M3U Manager");
    expect(response.text).toContain("source-editor");
    expect(response.text).toContain("playlist-sources.m3u");
    expect(response.text).toContain("live.txt");
    expect(response.text).toContain("live.m3u");
    expect(response.text).toContain("sort-order");
    expect(response.text).toContain("序号");
    expect(response.text).toContain("category-checkbox");
    expect(response.text).toContain("move-category");
    expect(response.text).toContain("分类");
    expect(response.text).toContain("测试播放");
    expect(response.text).toContain("设为默认");
    expect(response.text).toContain("置顶");
    expect(response.text).toContain("上移");
    expect(response.text).not.toContain("playlist.json");
    expect(response.text).not.toContain("tvbox.json");
    expect(response.text).not.toContain("warehouse.json");
  });
});
