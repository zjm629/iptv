export function renderHomePage() {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>IPTV M3U Manager</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f6f7f9;
      --panel: #ffffff;
      --text: #1d232a;
      --muted: #647084;
      --line: #d9dee7;
      --accent: #0f766e;
      --danger: #b42318;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    header {
      display: flex;
      justify-content: space-between;
      gap: 16px;
      align-items: center;
      padding: 20px clamp(16px, 4vw, 40px);
      border-bottom: 1px solid var(--line);
      background: var(--panel);
    }
    h1 { margin: 0; font-size: 22px; }
    main {
      display: grid;
      gap: 16px;
      padding: 20px clamp(16px, 4vw, 40px) 40px;
    }
    .toolbar, .status, .channel {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 14px;
    }
    .toolbar {
      display: grid;
      grid-template-columns: 1fr auto auto;
      gap: 10px;
    }
    input, button {
      min-height: 38px;
      border: 1px solid var(--line);
      border-radius: 6px;
      padding: 0 12px;
      font: inherit;
    }
    button {
      cursor: pointer;
      background: var(--accent);
      color: white;
      border-color: var(--accent);
      white-space: nowrap;
    }
    .muted { color: var(--muted); }
    .source-ok { color: var(--accent); }
    .source-bad { color: var(--danger); }
    .channels {
      display: grid;
      gap: 10px;
    }
    .channel summary {
      cursor: pointer;
      display: flex;
      justify-content: space-between;
      gap: 12px;
      list-style: none;
    }
    .channel summary::-webkit-details-marker { display: none; }
    .lines {
      margin-top: 12px;
      display: grid;
      gap: 8px;
    }
    .line {
      display: grid;
      grid-template-columns: minmax(120px, 180px) 1fr;
      gap: 10px;
      align-items: center;
      overflow-wrap: anywhere;
      color: var(--muted);
      font-size: 14px;
    }
    @media (max-width: 720px) {
      header, .toolbar { grid-template-columns: 1fr; align-items: stretch; }
      .toolbar { display: grid; }
      .line { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <header>
    <div>
      <h1>IPTV M3U Manager</h1>
      <div class="muted" id="subtitle">Loading...</div>
    </div>
    <button id="refresh">刷新</button>
  </header>
  <main>
    <section class="toolbar">
      <input id="search" type="search" placeholder="搜索频道">
      <button id="copy">复制播放列表地址</button>
      <a id="playlist" href="/playlist.m3u">playlist.m3u</a>
    </section>
    <section class="status" id="status"></section>
    <section class="channels" id="channels"></section>
  </main>
  <script>
    const state = { channels: [], status: null };
    const $ = (id) => document.getElementById(id);

    function renderStatus() {
      const status = state.status;
      if (!status) return;
      $("subtitle").textContent = status.lastSuccessAt
        ? "上次成功更新：" + new Date(status.lastSuccessAt).toLocaleString()
        : "尚未成功更新";
      $("status").innerHTML =
        "<strong>频道：</strong>" + status.channelCount +
        " <strong>源：</strong>" + status.sourceCount +
        " <strong>刷新中：</strong>" + (status.refreshing ? "是" : "否") +
        "<div>" + status.sources.map((source) =>
          "<div class='" + (source.ok ? "source-ok" : "source-bad") + "'>" +
          source.name + " - " + (source.ok ? "成功 " + source.channels + " 个频道" : "失败：" + source.error) +
          "</div>"
        ).join("") + "</div>";
    }

    function renderChannels() {
      const keyword = $("search").value.trim().toLowerCase();
      const filtered = state.channels.filter((channel) =>
        channel.name.toLowerCase().includes(keyword) || channel.id.includes(keyword)
      );
      $("channels").innerHTML = filtered.map((channel) =>
        "<details class='channel'><summary><strong>" + channel.name + "</strong><span class='muted'>" +
        channel.sources.length + " 条线路</span></summary><div class='lines'>" +
        channel.sources.map((source, index) =>
          "<div class='line'><a href='/play/" + encodeURIComponent(channel.id) + "?source=" + index + "'>线路 " +
          (index + 1) + " - " + source.sourceName + "</a><span>" + source.url + "</span></div>"
        ).join("") + "</div></details>"
      ).join("");
    }

    async function load() {
      const [status, channels] = await Promise.all([
        fetch("/api/status").then((response) => response.json()),
        fetch("/api/channels").then((response) => response.json())
      ]);
      state.status = status;
      state.channels = channels;
      renderStatus();
      renderChannels();
    }

    $("search").addEventListener("input", renderChannels);
    $("copy").addEventListener("click", async () => {
      await navigator.clipboard.writeText(new URL("/playlist.m3u", location.href).href);
      $("copy").textContent = "已复制";
      setTimeout(() => $("copy").textContent = "复制播放列表地址", 1200);
    });
    $("refresh").addEventListener("click", async () => {
      $("refresh").disabled = true;
      await fetch("/api/refresh", { method: "POST" });
      await load();
      $("refresh").disabled = false;
    });
    load();
  </script>
</body>
</html>`;
}
