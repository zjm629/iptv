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
      grid-template-columns: 1fr repeat(4, auto);
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
    button.linklike {
      min-height: 32px;
      padding: 0 10px;
      background: white;
      color: var(--text);
      border-color: var(--line);
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
    .source-actions, .channel-actions, .line-actions {
      display: flex;
      gap: 8px;
      align-items: center;
      flex-wrap: wrap;
    }
    .channels {
      display: grid;
      gap: 10px;
    }
    .channel.hidden summary strong {
      text-decoration: line-through;
      color: var(--muted);
    }
    .channel summary {
      cursor: pointer;
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 12px;
      align-items: center;
      list-style: none;
    }
    .channel summary::-webkit-details-marker { display: none; }
    .channel-title {
      display: flex;
      gap: 10px;
      align-items: baseline;
      flex-wrap: wrap;
    }
    .sort-control {
      display: inline-flex;
      gap: 6px;
      align-items: center;
      color: var(--muted);
      font-size: 13px;
    }
    .sort-order {
      width: 76px;
      min-height: 32px;
      padding: 0 8px;
    }
    .custom-group {
      width: 130px;
      min-height: 32px;
      padding: 0 8px;
    }
    .lines {
      margin-top: 12px;
      display: grid;
      gap: 8px;
    }
    .line {
      display: grid;
      grid-template-columns: minmax(140px, 220px) 1fr auto;
      gap: 10px;
      align-items: center;
      overflow-wrap: anywhere;
      color: var(--muted);
      font-size: 14px;
      border-top: 1px solid var(--line);
      padding-top: 8px;
    }
    .line.disabled {
      opacity: 0.55;
    }
    .badge {
      display: inline-flex;
      align-items: center;
      min-height: 22px;
      padding: 0 8px;
      border-radius: 999px;
      background: var(--soft);
      color: var(--accent);
      font-size: 12px;
    }
    @media (max-width: 860px) {
      header, .toolbar, .source-row, .line {
        grid-template-columns: 1fr;
        align-items: stretch;
      }
      .channel summary {
        grid-template-columns: 1fr;
      }
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
      <a id="playlist-sources" href="/playlist-sources.m3u">playlist-sources.m3u</a>
      <a id="live-txt" href="/live.txt">live.txt</a>
      <a id="live-m3u" href="/live.m3u">live.m3u</a>
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

    async function postJson(url, payload) {
      const response = await fetch(url, {
        method: url.includes("/move") ? "POST" : "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload)
      });
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error || "操作失败");
      }
      state.channels = result.channels;
      renderChannels();
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
        "<details class='channel " + (channel.hidden ? "hidden" : "") + "'><summary>" +
        "<span class='channel-title'><strong>" + escapeHtml(channel.name) + "</strong><span class='muted'>" +
        channel.sources.length + " 条线路</span>" + (channel.hidden ? "<span class='badge'>已隐藏</span>" : "") + "</span>" +
        "<span class='channel-actions'>" +
        "<label class='sort-control'>序号<input class='sort-order' type='number' min='1' step='1' placeholder='留空' data-id='" + escapeHtml(channel.id) + "' value='" +
        (Number.isFinite(channel.sortOrder) ? escapeHtml(channel.sortOrder) : "") + "'></label>" +
        "<label class='sort-control'>分组<input class='custom-group' type='text' placeholder='留空' data-id='" + escapeHtml(channel.id) + "' value='" +
        escapeHtml(channel.customGroup || "") + "'></label>" +
        "<button class='linklike move-channel' data-id='" + escapeHtml(channel.id) + "' data-direction='top'>置顶</button>" +
        "<button class='linklike move-channel' data-id='" + escapeHtml(channel.id) + "' data-direction='up'>上移</button>" +
        "<button class='linklike move-channel' data-id='" + escapeHtml(channel.id) + "' data-direction='down'>下移</button>" +
        "<button class='" + (channel.hidden ? "secondary" : "danger") + " toggle-channel' data-id='" + escapeHtml(channel.id) + "' data-hidden='" + (!channel.hidden) + "'>" +
        (channel.hidden ? "恢复" : "隐藏") + "</button>" +
        "</span></summary><div class='lines'>" +
        channel.sources.map((source) =>
          "<div class='line " + (source.disabled ? "disabled" : "") + "'>" +
          "<a href='/play/" + encodeURIComponent(channel.id) + "?source=" + source.sourceIndex + "'>线路 " +
          (source.sourceIndex + 1) + " - " + escapeHtml(source.sourceName) + "</a><span>" + escapeHtml(source.url) + "</span>" +
          "<span class='line-actions'>" +
          (source.preferred ? "<span class='badge'>默认</span>" : "<button class='linklike prefer-source' data-id='" + escapeHtml(channel.id) + "' data-url='" + escapeHtml(source.url) + "'>设为默认</button>") +
          "<button class='" + (source.disabled ? "secondary" : "danger") + " toggle-source' data-id='" + escapeHtml(channel.id) + "' data-url='" + escapeHtml(source.url) + "' data-disabled='" + (!source.disabled) + "'>" +
          (source.disabled ? "启用" : "禁用") + "</button>" +
          "</span></div>"
        ).join("") + "</div></details>"
      ).join("");

      document.querySelectorAll(".toggle-channel").forEach((button) => {
        button.addEventListener("click", async (event) => {
          event.preventDefault();
          await postJson("/api/channels/" + encodeURIComponent(button.dataset.id) + "/override", {
            hidden: button.dataset.hidden === "true"
          });
        });
      });
      document.querySelectorAll(".sort-order").forEach((input) => {
        input.addEventListener("click", (event) => event.stopPropagation());
        input.addEventListener("keydown", async (event) => {
          event.stopPropagation();
          if (event.key === "Enter") {
            event.preventDefault();
            input.blur();
          }
        });
        input.addEventListener("change", async (event) => {
          event.preventDefault();
          const value = input.value.trim();
          await postJson("/api/channels/" + encodeURIComponent(input.dataset.id) + "/override", {
            sortOrder: value === "" ? null : Number(value)
          });
        });
      });
      document.querySelectorAll(".custom-group").forEach((input) => {
        input.addEventListener("click", (event) => event.stopPropagation());
        input.addEventListener("keydown", async (event) => {
          event.stopPropagation();
          if (event.key === "Enter") {
            event.preventDefault();
            input.blur();
          }
        });
        input.addEventListener("change", async (event) => {
          event.preventDefault();
          await postJson("/api/channels/" + encodeURIComponent(input.dataset.id) + "/override", {
            customGroup: input.value.trim()
          });
        });
      });
      document.querySelectorAll(".move-channel").forEach((button) => {
        button.addEventListener("click", async (event) => {
          event.preventDefault();
          await postJson("/api/channels/" + encodeURIComponent(button.dataset.id) + "/move", {
            direction: button.dataset.direction
          });
        });
      });
      document.querySelectorAll(".prefer-source").forEach((button) => {
        button.addEventListener("click", async (event) => {
          event.preventDefault();
          await postJson("/api/channels/" + encodeURIComponent(button.dataset.id) + "/override", {
            preferredSourceUrl: button.dataset.url
          });
        });
      });
      document.querySelectorAll(".toggle-source").forEach((button) => {
        button.addEventListener("click", async (event) => {
          event.preventDefault();
          const channel = state.channels.find((item) => item.id === button.dataset.id);
          const disabled = new Set(channel.sources.filter((source) => source.disabled).map((source) => source.url));
          if (button.dataset.disabled === "true") {
            disabled.add(button.dataset.url);
          } else {
            disabled.delete(button.dataset.url);
          }
          await postJson("/api/channels/" + encodeURIComponent(button.dataset.id) + "/override", {
            disabledSourceUrls: Array.from(disabled)
          });
        });
      });
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
      await navigator.clipboard.writeText(new URL("/live.txt", location.href).href);
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
