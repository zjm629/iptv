import request from "supertest";
import { jest } from "@jest/globals";
import { createApp } from "../src/server.js";

function createFakeStore() {
  const channels = [
    {
      id: "cctv1",
      name: "CCTV-1 综合",
      logo: "https://logo.example/cctv.png",
      group: "央视",
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
  });
});
