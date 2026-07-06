import { generateLiveM3u, generateLiveTxt, generatePlaylist, generateSourcePlaylist, parseM3u } from "../src/m3u.js";

describe("m3u parsing", () => {
  test("parses extinf entries with attributes and stream urls", () => {
    const text = `#EXTM3U
#EXTINF:-1 tvg-id="cctv1" tvg-logo="https://logo.example/cctv1.png" group-title="央视",CCTV-1 综合
http://stream.example/cctv1.m3u8
#EXTINF:-1 group-title="卫视",湖南卫视
# this comment is ignored
http://stream.example/hunan.m3u8
#EXTINF:-1 group-title="坏数据",No URL Channel
#EXTINF:-1,No Name Url
`;

    expect(parseM3u(text, "Test Source")).toEqual([
      {
        name: "CCTV-1 综合",
        url: "http://stream.example/cctv1.m3u8",
        logo: "https://logo.example/cctv1.png",
        group: "央视",
        sourceName: "Test Source"
      },
      {
        name: "湖南卫视",
        url: "http://stream.example/hunan.m3u8",
        logo: "",
        group: "卫视",
        sourceName: "Test Source"
      }
    ]);
  });
});

describe("m3u generation", () => {
  test("generates one playable entry per merged channel", () => {
    const channels = [
      {
        id: "cctv1",
        name: "CCTV-1 综合",
        logo: "https://logo.example/cctv1.png",
        group: "央视",
        sources: [{ url: "http://stream.example/cctv1.m3u8" }]
      },
      {
        id: "hunanweishi",
        name: "湖南卫视",
        logo: "",
        group: "卫视",
        sources: [{ url: "http://stream.example/hunan.m3u8" }]
      }
    ];

    const playlist = generatePlaylist(channels, "http://vps.example:3080");

    expect(playlist).toContain("#EXTM3U");
    expect(playlist).toContain('tvg-logo="https://logo.example/cctv1.png"');
    expect(playlist).toContain('group-title="央视",CCTV-1 综合');
    expect(playlist).toContain("http://vps.example:3080/play/cctv1");
    expect(playlist).toContain("http://vps.example:3080/play/hunanweishi");
  });

  test("generates repeated channel entries for player source selection", () => {
    const channels = [
      {
        id: "cctv1",
        name: "CCTV-1 综合",
        logo: "https://logo.example/cctv1.png",
        group: "央视",
        sources: [
          { url: "http://a.example/cctv1.m3u8" },
          { url: "http://b.example/cctv1.m3u8" }
        ]
      }
    ];

    const playlist = generateSourcePlaylist(channels, "http://vps.example:3080");

    expect(playlist.match(/,CCTV-1 综合/g)).toHaveLength(2);
    expect(playlist.match(/tvg-id="cctv1"/g)).toHaveLength(2);
    expect(playlist).toContain("http://vps.example:3080/play/cctv1?source=0");
    expect(playlist).toContain("http://vps.example:3080/play/cctv1?source=1");
  });

  test("generates live m3u with one channel entry and joined source links", () => {
    const channels = [
      {
        id: "cctv1",
        name: "CCTV1",
        logo: "",
        group: "CCTV",
        sources: [
          { sourceIndex: 3, url: "http://a.example/cctv1.m3u8" },
          { sourceIndex: 5, url: "http://b.example/cctv1.m3u8" }
        ]
      }
    ];

    const playlist = generateLiveM3u(channels, "http://vps.example:3080/");

    expect(playlist.startsWith('#EXTM3U x-tvg-url="https://live.fanmingming.com/e.xml"')).toBe(true);
    expect(playlist).toContain(
      '#EXTINF:-1 tvg-name="CCTV1" tvg-logo="https://live.fanmingming.com/tv/CCTV1.png" group-title="CCTV",CCTV1'
    );
    expect(playlist).toContain(
      "http://vps.example:3080/play/cctv1?source=3#http://vps.example:3080/play/cctv1?source=5"
    );
    expect(playlist).not.toContain("#genre#");
  });

  test("generates live txt in the configured channel order across groups", () => {
    const channels = [
      { id: "gansu", name: "Gansu", group: "Group A", sources: [{}] },
      { id: "qinghai", name: "Qinghai", group: "Group B", sources: [{}] },
      { id: "xinjiang", name: "Xinjiang", group: "Group A", sources: [{}] }
    ];

    const playlist = generateLiveTxt(channels, "http://vps.example:3080");

    expect(playlist.trim().split("\n")).toEqual([
      "Group A,#genre#",
      "Gansu,http://vps.example:3080/play/gansu?source=0",
      "Group B,#genre#",
      "Qinghai,http://vps.example:3080/play/qinghai?source=0",
      "Group A,#genre#",
      "Xinjiang,http://vps.example:3080/play/xinjiang?source=0"
    ]);
  });
});
