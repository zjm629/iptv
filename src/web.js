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
      --soft: #eef6f5;
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
    h2 { margin: 0 0 12px; font-size: 17px; }
    main {
      display: grid;
      gap: 16px;
      padding: 20px clamp(16px, 4vw, 40px) 40px;
    }
    .toolbar, .status, .channel, .source-editor {
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
    input { width: 100%; }
    button {
      cursor: pointer;
      background: var(--accent);
      color: white;
      border-color: var(--accent);
      white-space: nowrap;
    }
    button.secondary {
      background: var(--soft);
      color: var(--accent);
    }
    button.danger {
      background: white;
      color: var(--danger);
      border-color: #f0b8b2;
    }
    .muted { color: var(--muted); }
    .source-ok { color: var(--accent); }
    .source-bad { color: var(--danger); }
    .source-list {
      display: grid;
      gap: 10px;
      margin-bottom: 12px;
    }
    .source-row {
      display: grid;
      grid-template-columns: minmax(140px, 220px) 1fr auto;
      gap: 10px;
      align-items: center;
    }
    .source-actions {
      display: flex;
      gap: 10px;
      align-items: center;
      flex-wrap: wrap;
    }
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
    @media (max-width: 760px) {
      header, .toolbar, .source-row {
        grid-template-columns: 1fr;
        align-items: stretch;
      }
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
    <section class="source-editor">
      <h2>采集源</h2>
      <div class="source-list" id="sources"></div>
      <div class="source-actions">
        <button class="secondary" id="add-source">新增源</button>
        <button id="save-sources">保存并刷新</button>
        <span class="muted" id="source-message"></span>
      </div>
    </section>
    <section class="toolbar">
      <input id="search" type="search" placeholder="搜索频道">
      <button id="copy">复制播放列表地址</button>
      <a id="playlist" href="/playlist.m3u">playlist.m3u</a>
    </section>
    <section class="status" id="status"></section>
    <section class="channels" id="channels"></section>
  </main>
  <script>
    const state = { channels: [], status: null, sources: [] };
    const $ = (id) => document.getElementById(id);

    function escapeHtml(value) {
      return String(value || "").replace(/[&<>"']/g, (char) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
      }[char]));
    }

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
          escapeHtml(source.name) + " - " + (source.ok ? "成功 " + source.channels + " 个频道" : "失败：" + escapeHtml(source.error)) +
          "</div>"
        ).join("") + "</div>";
    }

    function renderSources() {
      const rows = state.sources.length ? state.sources : [{ name: "", url: "" }];
      $("sources").innerHTML = rows.map((source, index) =>
        "<div class='source-row' data-index='" + index + "'>" +
        "<input class='source-name' placeholder='名称，可留空' value='" + escapeHtml(source.name) + "'>" +
        "<input class='source-url' placeholder='M3U 地址，例如 https://example.com/list.m3u' value='" + escapeHtml(source.url) + "'>" +
        "<button class='danger remove-source' data-index='" + index + "'>删除</button>" +
        "</div>"
      ).join("");
      document.querySelectorAll(".remove-source").forEach((button) => {
        button.addEventListener("click", () => {
          syncSourcesFromInputs();
          state.sources.splice(Number(button.dataset.index), 1);
          renderSources();
        });
      });
    }

    function syncSourcesFromInputs() {
      state.sources = Array.from(document.querySelectorAll(".source-row")).map((row) => ({
        name: row.querySelector(".source-name").value.trim(),
        url: row.querySelector(".source-url").value.trim()
      }));
    }

    function renderChannels() {
      const keyword = $("search").value.trim().toLowerCase();
      const filtered = state.channels.filter((channel) =>
        channel.name.toLowerCase().includes(keyword) || channel.id.includes(keyword)
      );
      $("channels").innerHTML = filtered.map((channel) =>
        "<details class='channel'><summary><strong>" + escapeHtml(channel.name) + "</strong><span class='muted'>" +
        channel.sources.length + " 条线路</span></summary><div class='lines'>" +
        channel.sources.map((source, index) =>
          "<div class='line'><a href='/play/" + encodeURIComponent(channel.id) + "?source=" + index + "'>线路 " +
          (index + 1) + " - " + escapeHtml(source.sourceName) + "</a><span>" + escapeHtml(source.url) + "</span></div>"
        ).join("") + "</div></details>"
      ).join("");
    }

    async function load() {
      const [status, channels, sources] = await Promise.all([
        fetch("/api/status").then((response) => response.json()),
        fetch("/api/channels").then((response) => response.json()),
        fetch("/api/sources").then((response) => response.json())
      ]);
      state.status = status;
      state.channels = channels;
      state.sources = sources;
      renderStatus();
      renderSources();
      renderChannels();
    }

    $("search").addEventListener("input", renderChannels);
    $("add-source").addEventListener("click", () => {
      syncSourcesFromInputs();
      state.sources.push({ name: "", url: "" });
      renderSources();
    });
    $("save-sources").addEventListener("click", async () => {
      syncSourcesFromInputs();
      const sources = state.sources.filter((source) => source.url);
      $("save-sources").disabled = true;
      $("source-message").textContent = "保存中...";
      const response = await fetch("/api/sources", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sources })
      });
      const result = await response.json();
      if (!response.ok) {
        $("source-message").textContent = result.error || "保存失败";
        $("save-sources").disabled = false;
        return;
      }
      state.sources = result.sources;
      $("source-message").textContent = "已保存并刷新";
      await load();
      $("save-sources").disabled = false;
    });
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
