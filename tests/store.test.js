import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { jest } from "@jest/globals";
import { createStore } from "../src/store.js";

async function createTempConfig(sources) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "iptv-store-"));
  const configPath = path.join(dir, "sources.json");
  const cachePath = path.join(dir, "cache.json");
  const overridesPath = path.join(dir, "channel-overrides.json");
  await fs.writeFile(configPath, JSON.stringify(sources), "utf8");
  return { dir, configPath, cachePath, overridesPath };
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

  test("preserves multicast proxy sources when their full urls differ", async () => {
    const { configPath, cachePath } = await createTempConfig([
      { name: "Source A", url: "http://source-a.example/list.m3u" }
    ]);
    const fetchMock = jest.fn().mockResolvedValueOnce({
      ok: true,
      text: async () => `#EXTM3U
#EXTINF:-1 group-title="Sports",广东体育
http://www.maomizi.cn:9528/rtp/239.77.0.112:5146
#EXTINF:-1 group-title="Sports",广东体育
http://www.maomizi.cn:9529/rtp/239.77.0.112:5146
#EXTINF:-1 group-title="Sports",广东体育
http://www.tyio.cc:8188/rtp/239.77.0.168:5146
`
    });

    const store = createStore({ configPath, cachePath, fetchImpl: fetchMock });
    await store.refresh();

    expect(store.getChannel("广东体育").sources.map((source) => source.url)).toEqual([
      "http://www.maomizi.cn:9528/rtp/239.77.0.112:5146",
      "http://www.maomizi.cn:9529/rtp/239.77.0.112:5146",
      "http://www.tyio.cc:8188/rtp/239.77.0.168:5146"
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

  test("applies channel overrides for output without deleting cached channels", async () => {
    const { configPath, cachePath, overridesPath } = await createTempConfig([
      { name: "Source A", url: "http://source-a.example/list.m3u" },
      { name: "Source B", url: "http://source-b.example/list.m3u" }
    ]);
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        text: async () => `#EXTM3U
#EXTINF:-1 group-title="CCTV",CCTV-1
http://a.example/cctv1.m3u8
#EXTINF:-1 group-title="CCTV",CCTV-2
http://a.example/cctv2.m3u8
`
      })
      .mockResolvedValueOnce({
        ok: true,
        text: async () => `#EXTM3U
#EXTINF:-1 group-title="CCTV",CCTV1
http://b.example/cctv1.m3u8
`
      });

    const store = createStore({ configPath, cachePath, overridesPath, fetchImpl: fetchMock });
    await store.load();
    await store.refresh();
    await store.saveChannelOverride("cctv1", {
      preferredSourceUrl: "http://b.example/cctv1.m3u8",
      disabledSourceUrls: ["http://a.example/cctv1.m3u8"]
    });
    await store.saveChannelOverride("cctv2", { hidden: true });
    await store.moveChannel("cctv2", "top");

    expect(store.getChannels()).toEqual([
      expect.objectContaining({
        id: "cctv1",
        hidden: false,
        sources: [
          expect.objectContaining({ url: "http://a.example/cctv1.m3u8", disabled: true, preferred: false }),
          expect.objectContaining({ url: "http://b.example/cctv1.m3u8", disabled: false, preferred: true })
        ]
      }),
      expect.objectContaining({
        id: "cctv2",
        hidden: true
      })
    ]);
    expect(store.getOutputChannels()).toEqual([
      expect.objectContaining({
        id: "cctv1",
        defaultSourceIndex: 1,
        sources: [
          expect.objectContaining({ url: "http://b.example/cctv1.m3u8", sourceIndex: 1 })
        ]
      })
    ]);
    expect(JSON.parse(await fs.readFile(overridesPath, "utf8"))).toEqual({
      channels: {
        cctv1: {
          hidden: false,
          preferredSourceUrl: "http://b.example/cctv1.m3u8",
          disabledSourceUrls: ["http://a.example/cctv1.m3u8"],
          sortOrder: null,
          customGroups: []
        },
        cctv2: {
          hidden: true,
          preferredSourceUrl: "",
          disabledSourceUrls: [],
          sortOrder: null,
          customGroups: []
        }
      },
      order: ["cctv2", "cctv1"],
      categories: ["推荐频道"]
    });
  });

  test("sorts visible channels by sort number while preserving default order for ties", async () => {
    const { configPath, cachePath, overridesPath } = await createTempConfig([
      { name: "Source A", url: "http://source-a.example/list.m3u" }
    ]);
    const fetchMock = jest.fn().mockResolvedValueOnce({
      ok: true,
      text: async () => `#EXTM3U
#EXTINF:-1 group-title="CCTV",CCTV-1
http://a.example/cctv1.m3u8
#EXTINF:-1 group-title="CCTV",CCTV-2
http://a.example/cctv2.m3u8
#EXTINF:-1 group-title="CCTV",CCTV-3
http://a.example/cctv3.m3u8
#EXTINF:-1 group-title="CCTV",CCTV-4
http://a.example/cctv4.m3u8
`
    });

    const store = createStore({ configPath, cachePath, overridesPath, fetchImpl: fetchMock });
    await store.load();
    await store.refresh();
    await store.saveChannelOverride("cctv1", { sortOrder: 2 });
    await store.saveChannelOverride("cctv2", { hidden: true, sortOrder: 1 });
    await store.saveChannelOverride("cctv3", { sortOrder: 2 });

    expect(store.getChannels().map((channel) => [channel.id, channel.sortOrder, channel.hidden])).toEqual([
      ["cctv1", 2, false],
      ["cctv3", 2, false],
      ["cctv4", null, false],
      ["cctv2", 1, true]
    ]);
    expect(store.getOutputChannels().map((channel) => channel.id)).toEqual(["cctv1", "cctv3", "cctv4"]);
    expect(JSON.parse(await fs.readFile(overridesPath, "utf8")).channels).toEqual({
      cctv1: {
        hidden: false,
        preferredSourceUrl: "",
        disabledSourceUrls: [],
        sortOrder: 2,
        customGroups: []
      },
      cctv2: {
        hidden: true,
        preferredSourceUrl: "",
        disabledSourceUrls: [],
        sortOrder: 1,
        customGroups: []
      },
      cctv3: {
        hidden: false,
        preferredSourceUrl: "",
        disabledSourceUrls: [],
        sortOrder: 2,
        customGroups: []
      }
    });
  });

  test("saves multiple custom channel groups in overrides", async () => {
    const { configPath, cachePath, overridesPath } = await createTempConfig([
      { name: "Source A", url: "http://source-a.example/list.m3u" }
    ]);
    const fetchMock = jest.fn().mockResolvedValueOnce({
      ok: true,
      text: async () => `#EXTM3U
#EXTINF:-1 group-title="Source Group",CCTV-1
http://a.example/cctv1.m3u8
`
    });

    const store = createStore({ configPath, cachePath, overridesPath, fetchImpl: fetchMock });
    await store.load();
    await store.refresh();
    await store.saveChannelOverride("cctv1", { customGroups: ["推荐频道", "央视频道"] });

    expect(store.getChannel("cctv1")).toEqual(
      expect.objectContaining({
        group: "Source Group",
        customGroups: ["推荐频道", "央视频道"]
      })
    );
    expect(JSON.parse(await fs.readFile(overridesPath, "utf8")).channels.cctv1).toEqual({
      hidden: false,
      preferredSourceUrl: "",
      disabledSourceUrls: [],
      sortOrder: null,
      customGroups: ["推荐频道", "央视频道"]
    });
  });

  test("saves category list with recommended first", async () => {
    const { configPath, cachePath, overridesPath } = await createTempConfig([]);
    const store = createStore({ configPath, cachePath, overridesPath, fetchImpl: jest.fn() });
    await store.load();

    await expect(store.saveCategories(["卫视频道", "推荐频道", "央视频道", "卫视频道"])).resolves.toEqual([
      "推荐频道",
      "卫视频道",
      "央视频道"
    ]);
    expect(store.getCategories()).toEqual(["推荐频道", "卫视频道", "央视频道"]);
    expect(JSON.parse(await fs.readFile(overridesPath, "utf8")).categories).toEqual([
      "推荐频道",
      "卫视频道",
      "央视频道"
    ]);
  });
});
