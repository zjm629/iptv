import { generatePlaylist, parseM3u } from "../src/m3u.js";

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
});
