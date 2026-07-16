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
  const autoSourcesPath = path.join(dir, "auto-sources.json");
  await fs.writeFile(configPath, JSON.stringify(sources), "utf8");
  return { dir, configPath, cachePath, overridesPath, autoSourcesPath };
}

describe("createStore", () => {
  test("reads configured sources", async () => {
    const { configPath, cachePath } = await createTempConfig([
      { name: "Source A", url: " http://source-a.example/list.m3u " }
    ]);

    const store = createStore({ configPath, cachePath, fetchImpl: jest.fn() });

    await expect(store.getSources()).resolves.toEqual([
      { name: "Source A", url: "http://source-a.example/list.m3u", hidden: false }
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
      { name: "Source A", url: "http://source-a.example/list.m3u", hidden: false },
      { name: "", url: "http://source-b.example/list.m3u", hidden: false }
    ]);
  });

  test("keeps hidden manual sources in config but skips them during refresh", async () => {
    const { configPath, cachePath } = await createTempConfig([
      { name: "Fast", url: "http://fast.example/list.m3u" },
      { name: "Slow", url: "http://slow.example/list.m3u", hidden: true }
    ]);
    const fetchMock = jest.fn().mockResolvedValueOnce({
      ok: true,
      text: async () => `#EXTM3U
#EXTINF:-1,CCTV-1
http://fast.example/cctv1.m3u8
`
    });

    const store = createStore({ configPath, cachePath, fetchImpl: fetchMock });
    await expect(store.getSources()).resolves.toEqual([
      { name: "Fast", url: "http://fast.example/list.m3u", hidden: false },
      { name: "Slow", url: "http://slow.example/list.m3u", hidden: true }
    ]);

    const status = await store.refresh();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("http://fast.example/list.m3u");
    expect(status.sourceCount).toBe(1);
    expect(status.manualSourceCount).toBe(2);
    expect(store.getChannels().map((channel) => channel.id)).toEqual(["cctv1"]);
  });

  test("discovers enabled auto sources and fetches only the first row for duplicate types", async () => {
    const { configPath, cachePath, autoSourcesPath } = await createTempConfig([]);
    await fs.writeFile(autoSourcesPath, JSON.stringify({
      enabled: true,
      keywords: ["电信"],
      maxPages: 1,
      resolveDetailUrls: false
    }), "utf8");
    const html = `
<table><tbody>
<tr><td><a onclick="gotoIP('top','multicast')">1.1.1.1</a></td><td>2</td><td>四川成都组播 四川电信</td><td>2026-07-13</td><td>2026-07-13 12:00:00</td><td>新上线</td></tr>
<tr><td><a onclick="gotoIP('dup','multicast')">1.1.1.2</a></td><td>2</td><td>四川成都组播 四川电信</td><td>2026-07-13</td><td>2026-07-13 11:00:00</td><td>新上线</td></tr>
</tbody></table>`;
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({ ok: true, text: async () => html })
      .mockResolvedValueOnce({
        ok: true,
        text: async () => `#EXTM3U
#EXTINF:-1,CCTV-1
http://auto.example/cctv1.m3u8
`
      });

    const store = createStore({
      configPath,
      cachePath,
      autoSourcesPath,
      fetchImpl: fetchMock,
      now: new Date("2026-07-13T12:00:00+08:00")
    });
    await store.load();
    const status = await store.refresh();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toBe("https://iptv.cqshushu.com/index.php?s=top&t=multicast&channels=1&format=m3u");
    expect(status.autoSourceCount).toBe(1);
    expect(status.sources[0]).toEqual(expect.objectContaining({ auto: true, ok: true }));
    expect(store.getChannel("cctv1").sources[0].sourceName).toBe("自动-四川成都组播 四川电信");
  });

  test("keeps last successful auto sources when later auto discovery is unavailable", async () => {
    const { configPath, cachePath, autoSourcesPath } = await createTempConfig([]);
    await fs.writeFile(autoSourcesPath, JSON.stringify({
      enabled: true,
      pageUrl: "https://iptv.cqshushu.com/index.php",
      keywords: ["电信"],
      maxPages: 1,
      rateLimitRetries: 0,
      resolveDetailUrls: false
    }), "utf8");
    const html = `
<table><tbody>
<tr><td><a onclick="gotoIP('top','multicast')">1.1.1.1</a></td><td>2</td><td>四川成都组播 四川电信</td><td>2026-07-13</td><td>2026-07-13 12:00:00</td><td>新上线</td></tr>
</tbody></table>`;
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({ ok: true, text: async () => html })
      .mockResolvedValueOnce({
        ok: true,
        text: async () => `#EXTM3U
#EXTINF:-1,CCTV-1
http://auto.example/cctv1.m3u8
`
      })
      .mockResolvedValueOnce({ ok: false, status: 504, text: async () => "Gateway timeout" })
      .mockResolvedValueOnce({
        ok: true,
        text: async () => `#EXTM3U
#EXTINF:-1,CCTV-1
http://auto.example/cctv1.m3u8
`
      });

    const store = createStore({
      configPath,
      cachePath,
      autoSourcesPath,
      fetchImpl: fetchMock,
      now: new Date("2026-07-13T12:00:00+08:00")
    });
    await store.load();
    await store.refresh();
    const status = await store.refresh();

    expect(status.autoSourceFallback).toBe(true);
    expect(status.autoSourceCount).toBe(1);
    expect(status.sources).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: "自动采集",
        ok: false,
        error: expect.stringContaining("已沿用上次成功")
      }),
      expect.objectContaining({
        name: "自动-四川成都组播 四川电信",
        ok: true
      })
    ]));
    expect(store.getChannel("cctv1")).toEqual(expect.objectContaining({
      name: "CCTV-1"
    }));
  });

  test("persists successful collector sources and reuses same-day cache by ip", async () => {
    const { configPath, cachePath } = await createTempConfig([]);
    const pageHtml = (token) => `
<table><tbody>
<tr><td><a onclick="gotoIP('${token}','multicast')">1.2.3.4</a></td><td>88</td><td>Test Telecom</td><td>2026-07-16</td><td>2026-07-16 12:00:00</td><td>new</td></tr>
</tbody></table>`;
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({ ok: true, text: async () => pageHtml("first-token") })
      .mockResolvedValueOnce({ ok: true, text: async () => pageHtml("changed-token") });
    const store = createStore({
      configPath,
      cachePath,
      fetchImpl: fetchMock,
      now: new Date("2026-07-16T12:00:00+08:00")
    });
    await store.load();

    const config = {
      enabled: true,
      pageUrl: "https://iptv.cqshushu.com/index.php",
      keywords: [],
      todayOnly: true,
      onlyStatus: "new",
      maxPages: 1,
      resolveDetailUrls: false,
      validateM3uUrls: false
    };
    const first = await store.discoverAutoSources(config);

    expect(first.sources[0]).toEqual(expect.objectContaining({
      ip: "1.2.3.4",
      url: "https://iptv.cqshushu.com/index.php?s=first-token&t=multicast&channels=1&format=m3u"
    }));
    expect(JSON.parse(await fs.readFile(cachePath, "utf8")).collectorSourceCache).toEqual([
      expect.objectContaining({
        date: "2026-07-16",
        ip: "1.2.3.4",
        url: "https://iptv.cqshushu.com/index.php?s=first-token&t=multicast&channels=1&format=m3u"
      })
    ]);

    const restartedStore = createStore({
      configPath,
      cachePath,
      fetchImpl: fetchMock,
      now: new Date("2026-07-16T12:00:00+08:00")
    });
    await restartedStore.load();
    const second = await restartedStore.discoverAutoSources(config);

    expect(second.sources[0]).toEqual(expect.objectContaining({
      cached: true,
      ip: "1.2.3.4",
      url: "https://iptv.cqshushu.com/index.php?s=first-token&t=multicast&channels=1&format=m3u"
    }));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test("hidden auto source types stay disabled after rediscovery finds a newer url", async () => {
    const { configPath, cachePath, autoSourcesPath } = await createTempConfig([]);
    const store = createStore({
      configPath,
      cachePath,
      autoSourcesPath,
      fetchImpl: jest.fn()
    });
    await store.load();

    await store.saveAutoSourceConfig({
      enabled: true,
      disabledTypeNames: ["四川成都组播 四川电信"]
    });

    expect(JSON.parse(await fs.readFile(autoSourcesPath, "utf8"))).toEqual(expect.objectContaining({
      enabled: true,
      disabledTypeNames: ["四川成都组播 四川电信"]
    }));
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

  test("initializes missing source config from example without overwriting existing config", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "iptv-store-"));
    const configPath = path.join(dir, "sources.json");
    const cachePath = path.join(dir, "cache.json");
    await fs.writeFile(path.join(dir, "sources.example.json"), JSON.stringify([
      { name: "Example", url: "http://example.test/list.m3u" }
    ]), "utf8");

    const store = createStore({ configPath, cachePath, fetchImpl: jest.fn() });
    await expect(store.getSources()).resolves.toEqual([
      { name: "Example", url: "http://example.test/list.m3u", hidden: false }
    ]);

    await fs.writeFile(configPath, JSON.stringify([
      { name: "Real", url: "http://real.test/list.m3u" }
    ]), "utf8");
    await expect(store.getSources()).resolves.toEqual([
      { name: "Real", url: "http://real.test/list.m3u", hidden: false }
    ]);
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

  test("automatically hides channels whose names end with SD", async () => {
    const { configPath, cachePath } = await createTempConfig([
      { name: "Source A", url: "http://source-a.example/list.m3u" }
    ]);
    const fetchMock = jest.fn().mockResolvedValueOnce({
      ok: true,
      text: async () => `#EXTM3U
#EXTINF:-1 group-title="上海频道",上海都市SD
http://a.example/shanghai-sd.m3u8
#EXTINF:-1 group-title="卫视",湖南卫视
http://a.example/hunan.m3u8
`
    });

    const store = createStore({ configPath, cachePath, fetchImpl: fetchMock });
    await store.refresh();

    expect(store.getChannel("上海都市sd")).toEqual(expect.objectContaining({
      name: "上海都市SD",
      hidden: true
    }));
    expect(store.getOutputChannels().map((channel) => channel.name)).toEqual(["湖南卫视"]);
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

  test("moves channel to bottom of configured order", async () => {
    const { configPath, cachePath, overridesPath } = await createTempConfig([
      { name: "Source A", url: "http://source-a.example/list.m3u" }
    ]);
    const fetchMock = jest.fn().mockResolvedValueOnce({
      ok: true,
      text: async () => `#EXTM3U
#EXTINF:-1,CCTV-1
http://a.example/cctv1.m3u8
#EXTINF:-1,CCTV-2
http://a.example/cctv2.m3u8
#EXTINF:-1,CCTV-3
http://a.example/cctv3.m3u8
`
    });
    const store = createStore({ configPath, cachePath, overridesPath, fetchImpl: fetchMock });
    await store.load();
    await store.refresh();

    await expect(store.moveChannel("cctv1", "bottom")).resolves.toEqual(["cctv2", "cctv3", "cctv1"]);
    expect(store.getChannels().map((channel) => channel.id)).toEqual(["cctv2", "cctv3", "cctv1"]);
  });

  test("manual channel moves clear sort number so bottom move takes effect", async () => {
    const { configPath, cachePath, overridesPath } = await createTempConfig([
      { name: "Source A", url: "http://source-a.example/list.m3u" }
    ]);
    const fetchMock = jest.fn().mockResolvedValueOnce({
      ok: true,
      text: async () => `#EXTM3U
#EXTINF:-1,CCTV-1
http://a.example/cctv1.m3u8
#EXTINF:-1,CCTV-2
http://a.example/cctv2.m3u8
#EXTINF:-1,CCTV-3
http://a.example/cctv3.m3u8
`
    });
    const store = createStore({ configPath, cachePath, overridesPath, fetchImpl: fetchMock });
    await store.load();
    await store.refresh();
    await store.saveChannelOverride("cctv1", { sortOrder: 1 });

    await store.moveChannel("cctv1", "bottom");

    expect(store.getChannels().map((channel) => [channel.id, channel.sortOrder])).toEqual([
      ["cctv2", null],
      ["cctv3", null],
      ["cctv1", null]
    ]);
    expect(JSON.parse(await fs.readFile(overridesPath, "utf8")).channels.cctv1.sortOrder).toBeNull();
  });

  test("auto hides channels whose name is only a generated date timestamp", async () => {
    const { configPath, cachePath, overridesPath } = await createTempConfig([
      { name: "Source A", url: "http://source-a.example/list.m3u" }
    ]);
    const fetchMock = jest.fn().mockResolvedValueOnce({
      ok: true,
      text: async () => `#EXTM3U
#EXTINF:-1,2026-07-11 19:29:11
http://a.example/generated.m3u8
#EXTINF:-1,CCTV-1
http://a.example/cctv1.m3u8
`
    });
    const store = createStore({ configPath, cachePath, overridesPath, fetchImpl: fetchMock });
    await store.load();
    await store.refresh();

    expect(store.getChannel("20260711192911")).toEqual(expect.objectContaining({ hidden: true }));
    expect(store.getOutputChannels().map((channel) => channel.id)).toEqual(["cctv1"]);
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
