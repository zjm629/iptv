import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { jest } from "@jest/globals";
import { createStore } from "../src/store.js";

async function createTempConfig(sources) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "iptv-store-"));
  const configPath = path.join(dir, "sources.json");
  const cachePath = path.join(dir, "cache.json");
  await fs.writeFile(configPath, JSON.stringify(sources), "utf8");
  return { dir, configPath, cachePath };
}

describe("createStore", () => {
  test("reads configured sources", async () => {
    const { configPath, cachePath } = await createTempConfig([
      { name: "Source A", url: " http://source-a.example/list.m3u " }
    ]);

    const store = createStore({ configPath, cachePath, fetchImpl: jest.fn() });

    await expect(store.getSources()).resolves.toEqual([
      { name: "Source A", url: "http://source-a.example/list.m3u" }
    ]);
  });

  test("saves validated sources to config", async () => {
    const { configPath, cachePath } = await createTempConfig([]);
    const store = createStore({ configPath, cachePath, fetchImpl: jest.fn() });

    await store.saveSources([
      { name: "  Source A  ", url: " http://source-a.example/list.m3u " },
      { name: "", url: "http://source-b.example/list.m3u" }
    ]);

    expect(JSON.parse(await fs.readFile(configPath, "utf8"))).toEqual([
      { name: "Source A", url: "http://source-a.example/list.m3u" },
      { name: "", url: "http://source-b.example/list.m3u" }
    ]);
  });

  test("rejects sources without urls", async () => {
    const { configPath, cachePath } = await createTempConfig([]);
    const store = createStore({ configPath, cachePath, fetchImpl: jest.fn() });

    await expect(store.saveSources([{ name: "Broken", url: " " }])).rejects.toThrow("Source URL is required");
  });

  test("reads json config files that contain a utf-8 bom", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "iptv-store-"));
    const configPath = path.join(dir, "sources.json");
    const cachePath = path.join(dir, "cache.json");
    await fs.writeFile(configPath, "\uFEFF[]", "utf8");

    const store = createStore({ configPath, cachePath, fetchImpl: jest.fn() });
    await expect(store.refresh()).resolves.toEqual(
      expect.objectContaining({
        channelCount: 0,
        sourceCount: 0
      })
    );
  });

  test("merges duplicate channels while preserving alternate source lines", async () => {
    const { configPath, cachePath } = await createTempConfig([
      { name: "Source A", url: "http://source-a.example/list.m3u" },
      { name: "Source B", url: "http://source-b.example/list.m3u" }
    ]);
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        text: async () => `#EXTM3U
#EXTINF:-1 tvg-logo="https://logo.example/cctv.png" group-title="央视",CCTV-1 综合
http://a.example/cctv1.m3u8
`
      })
      .mockResolvedValueOnce({
        ok: true,
        text: async () => `#EXTM3U
#EXTINF:-1 group-title="央视",CCTV1
http://b.example/cctv1.m3u8
`
      });

    const store = createStore({ configPath, cachePath, fetchImpl: fetchMock });
    await store.refresh();

    expect(store.getChannels()).toEqual([
      expect.objectContaining({
        id: "cctv1",
        name: "CCTV-1 综合",
        logo: "https://logo.example/cctv.png",
        group: "央视",
        sources: [
          expect.objectContaining({ sourceName: "Source A", url: "http://a.example/cctv1.m3u8" }),
          expect.objectContaining({ sourceName: "Source B", url: "http://b.example/cctv1.m3u8" })
        ]
      })
    ]);
  });

  test("preserves first-seen channel order across sources", async () => {
    const { configPath, cachePath } = await createTempConfig([
      { name: "Source A", url: "http://source-a.example/list.m3u" },
      { name: "Source B", url: "http://source-b.example/list.m3u" }
    ]);
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        text: async () => `#EXTM3U
#EXTINF:-1,湖南卫视
http://a.example/hunan.m3u8
#EXTINF:-1,CCTV-1 综合
http://a.example/cctv1.m3u8
`
      })
      .mockResolvedValueOnce({
        ok: true,
        text: async () => `#EXTM3U
#EXTINF:-1,CCTV1
http://b.example/cctv1.m3u8
#EXTINF:-1,北京卫视
http://b.example/beijing.m3u8
`
      });

    const store = createStore({ configPath, cachePath, fetchImpl: fetchMock });
    await store.refresh();

    expect(store.getChannels().map((channel) => channel.name)).toEqual([
      "湖南卫视",
      "CCTV-1 综合",
      "北京卫视"
    ]);
    expect(store.getChannel("cctv1").sources).toHaveLength(2);
  });

  test("keeps last successful cache when later refresh fails", async () => {
    const { configPath, cachePath } = await createTempConfig([
      { name: "Source A", url: "http://source-a.example/list.m3u" }
    ]);
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        text: async () => `#EXTM3U
#EXTINF:-1,湖南卫视
http://a.example/hunan.m3u8
`
      })
      .mockRejectedValueOnce(new Error("network down"));

    const store = createStore({ configPath, cachePath, fetchImpl: fetchMock });
    await store.refresh();
    await store.refresh();

    expect(store.getChannels()).toHaveLength(1);
    expect(store.getChannels()[0].name).toBe("湖南卫视");
    expect(store.getStatus().sources).toEqual([
      expect.objectContaining({
        name: "Source A",
        ok: false,
        error: "network down"
      })
    ]);
  });
});
