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
      maxPages: 1
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
});
