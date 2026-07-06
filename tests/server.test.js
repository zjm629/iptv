import request from "supertest";
import { jest } from "@jest/globals";
import { createApp } from "../src/server.js";

function createFakeStore() {
  const channels = [
    {
      id: "cctv1",
      name: "CCTV-1",
      logo: "https://logo.example/cctv.png",
      group: "CCTV",
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
    getChannels: () => channels,
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

  test("returns yingshicang-style json playlist grouped under lives", async () => {
    const response = await request(createApp(createFakeStore()))
      .get("/playlist.json")
      .set("Host", "vps.example:3080");

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("application/json");
    expect(response.text).toContain('{\n  "lives"');
    expect(response.body).toEqual({
      lives: [
        {
          group: "CCTV",
          channels: [
            {
              name: "CCTV-1",
              urls: [
                "$[A]http://vps.example:3080/play/cctv1?source=0#$[B]http://vps.example:3080/play/cctv1?source=1"
              ]
            }
          ]
        }
      ]
    });
  });

  test("returns TVBox live txt with grouped channels and merged source links", async () => {
    const response = await request(createApp(createFakeStore()))
      .get("/live.txt")
      .set("Host", "vps.example:3080");

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("text/plain");
    expect(response.text).toContain("CCTV,#genre#");
    expect(response.text).toContain(
      "CCTV-1,$[A]http://vps.example:3080/play/cctv1?source=0#$[B]http://vps.example:3080/play/cctv1?source=1"
    );
  });

  test("returns TVBox live-source list matching the reference json shape", async () => {
    const response = await request(createApp(createFakeStore()))
      .get("/tvbox.json")
      .set("Host", "vps.example:3080");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      lives: [
        {
          name: "IPTV-TXT",
          url: "http://vps.example:3080/live.txt",
          epg: "https://epg.112114.xyz/?ch={name}&date={date}"
        },
        {
          name: "IPTV-M3U",
          url: "http://vps.example:3080/playlist.m3u",
          epg: "https://epg.112114.xyz/?ch={name}&date={date}"
        }
      ]
    });
  });

  test("keeps the previous proxy TVBox config as a fallback endpoint", async () => {
    const response = await request(createApp(createFakeStore()))
      .get("/tvbox-proxy.json")
      .set("Host", "vps.example:3080");

    expect(response.status).toBe(200);
    expect(response.body.lives[0].channels[0].urls).toEqual([
      "proxy://do=live&type=txt&ext=http://vps.example:3080/live.txt"
    ]);
  });

  test("returns full TVBox config with direct live channels", async () => {
    const response = await request(createApp(createFakeStore()))
      .get("/tvbox-direct.json")
      .set("Host", "vps.example:3080");

    expect(response.status).toBe(200);
    expect(response.body.lives[0].group).toBe("CCTV");
    expect(response.body.lives[0].channels[0].name).toBe("CCTV-1");
    expect(response.body.lives[0].channels[0].urls).toEqual([
      "$[A]http://vps.example:3080/play/cctv1?source=0#$[B]http://vps.example:3080/play/cctv1?source=1"
    ]);
    expect(response.body.sites).toEqual([]);
  });

  test("returns warehouse json as the same reference live-source list", async () => {
    const response = await request(createApp(createFakeStore()))
      .get("/warehouse.json")
      .set("Host", "vps.example:3080");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      lives: [
        {
          name: "IPTV-TXT",
          url: "http://vps.example:3080/live.txt",
          epg: "https://epg.112114.xyz/?ch={name}&date={date}"
        },
        {
          name: "IPTV-M3U",
          url: "http://vps.example:3080/playlist.m3u",
          epg: "https://epg.112114.xyz/?ch={name}&date={date}"
        }
      ]
    });
  });

  test("TVBox JSON endpoints only use English schema keys", async () => {
    const app = createApp(createFakeStore());
    const endpoints = ["/playlist.json", "/tvbox.json", "/tvbox-proxy.json", "/tvbox-direct.json", "/warehouse.json"];
    const allowedKeys = new Set(["lives", "group", "channels", "name", "urls", "sites", "parses", "flags", "url", "epg"]);
    const forbiddenKeys = new Set(["生活", "分组", "频道", "名称", "网址", "链接"]);

    function walk(value) {
      if (Array.isArray(value)) {
        value.forEach(walk);
        return;
      }
      if (!value || typeof value !== "object") {
        return;
      }
      for (const key of Object.keys(value)) {
        expect(forbiddenKeys.has(key)).toBe(false);
        expect(allowedKeys.has(key)).toBe(true);
        walk(value[key]);
      }
    }

    for (const endpoint of endpoints) {
      const response = await request(app).get(endpoint).set("Host", "vps.example:3080");
      expect(response.status).toBe(200);
      walk(response.body);
    }
  });

  test("redirects channel playback to requested source line", async () => {
    const response = await request(createApp(createFakeStore())).get("/play/cctv1?source=1");

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe("http://b.example/cctv1.m3u8");
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
    expect(response.text).toContain("playlist.json");
    expect(response.text).toContain("tvbox.json");
    expect(response.text).toContain("warehouse.json");
  });
});
