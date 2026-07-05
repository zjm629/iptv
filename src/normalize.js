const BRACKETED_TEXT = /[\(\（\[\【].*?[\)\）\]\】]/g;
const SEPARATORS = /[\s\-_.\/\\|:：,，、·]+/g;
const TRAILING_QUALITY = /(超清|高清|标清|频道|综合|hd|fhd|uhd|4k)+$/gi;

export function normalizeChannelName(name) {
  let key = String(name || "")
    .normalize("NFKC")
    .trim()
    .toLowerCase();

  key = key.replace(BRACKETED_TEXT, "");
  key = key.replace(SEPARATORS, "");
  key = key.replace(TRAILING_QUALITY, "");

  const cctvMatch = key.match(/^cctv(\d{1,2})(.*)$/);
  if (cctvMatch) {
    const suffix = cctvMatch[2].replace(TRAILING_QUALITY, "");
    key = `cctv${Number(cctvMatch[1])}${suffix}`;
  }

  return key || "unknown";
}
