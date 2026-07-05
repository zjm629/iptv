import { normalizeChannelName } from "../src/normalize.js";

describe("normalizeChannelName", () => {
  test("normalizes common cctv duplicate display names to one key", () => {
    const names = ["CCTV1", "CCTV-1", "CCTV 1", "CCTV-1 综合", "cctv1综合"];
    const keys = names.map((name) => normalizeChannelName(name));

    expect(new Set(keys)).toEqual(new Set(["cctv1"]));
  });

  test("keeps different channels on different keys", () => {
    expect(normalizeChannelName("湖南卫视")).not.toBe(normalizeChannelName("CCTV1"));
  });

  test("removes common separators and bracketed suffixes", () => {
    expect(normalizeChannelName("CCTV-5+ 体育赛事 (高清)")).toBe("cctv5+体育赛事");
    expect(normalizeChannelName("北京·卫视_HD")).toBe("北京卫视");
  });
});
