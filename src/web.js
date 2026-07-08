function escapeHtmlValue(value) {
  return String(value || "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[char]));
}

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
    .toolbar, .status, .channel, .source-editor, .category-editor {
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
    input, button, select {
      min-height: 38px;
      border: 1px solid var(--line);
      border-radius: 6px;
      padding: 0 12px;
      font: inherit;
    }
    input, select { width: 100%; }
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
    button.linklike, a.linklike {
      display: inline-flex;
      align-items: center;
      min-height: 32px;
      padding: 0 10px;
      background: white;
      color: var(--text);
      border-color: var(--line);
      border: 1px solid var(--line);
      border-radius: 6px;
      text-decoration: none;
    }
    .muted { color: var(--muted); }
    .source-ok { color: var(--accent); }
    .source-bad { color: var(--danger); }
    .source-list, .category-list {
      display: grid;
      gap: 10px;
      margin-bottom: 12px;
    }
    .source-row, .category-row {
      display: grid;
      grid-template-columns: minmax(140px, 220px) 1fr auto;
      gap: 10px;
      align-items: center;
    }
    .source-actions, .category-actions, .channel-actions, .line-actions {
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
    .category-options {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      max-width: 420px;
    }
    .category-option {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      min-height: 30px;
      padding: 0 8px;
      border: 1px solid var(--line);
      border-radius: 6px;
      background: white;
      color: var(--text);
      font-size: 13px;
      white-space: nowrap;
    }
    .category-checkbox {
      width: auto;
      min-height: auto;
      margin: 0;
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
    <section class="category-editor">
      <h2>分类</h2>
      <div class="category-list" id="categories"></div>
      <div class="category-actions">
        <button class="secondary" id="add-category">新增分类</button>
        <button id="save-categories">保存分类</button>
        <span class="muted" id="category-message"></span>
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
    const state = { channels: [], status: null, sources: [], categories: [] };
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

    function renderCategories() {
      const rows = state.categories.length ? state.categories : ["推荐频道"];
      $("categories").innerHTML = rows.map((category, index) =>
        "<div class='category-row' data-index='" + index + "'>" +
        "<input class='category-name' value='" + escapeHtml(category) + "' " + (index === 0 ? "readonly" : "") + ">" +
        "<span class='muted'>" + (index === 0 ? "默认打开" : "自定义分类") + "</span>" +
        "<span class='category-actions'>" +
        "<button class='linklike move-category' data-index='" + index + "' data-direction='up' " + (index <= 1 ? "disabled" : "") + ">上移</button>" +
        "<button class='linklike move-category' data-index='" + index + "' data-direction='down' " + (index === 0 || index === rows.length - 1 ? "disabled" : "") + ">下移</button>" +
        "<button class='danger remove-category' data-index='" + index + "' " + (index === 0 ? "disabled" : "") + ">删除</button>" +
        "</span>" +
        "</div>"
      ).join("");
      document.querySelectorAll(".move-category").forEach((button) => {
        button.addEventListener("click", () => {
          syncCategoriesFromInputs();
          const index = Number(button.dataset.index);
          const target = button.dataset.direction === "up" ? index - 1 : index + 1;
          if (index <= 0 || target <= 0 || target >= state.categories.length) {
            return;
          }
          [state.categories[index], state.categories[target]] = [state.categories[target], state.categories[index]];
          renderCategories();
          renderChannels();
        });
      });
      document.querySelectorAll(".remove-category").forEach((button) => {
        button.addEventListener("click", () => {
          syncCategoriesFromInputs();
          state.categories.splice(Number(button.dataset.index), 1);
          renderCategories();
          renderChannels();
        });
      });
    }

    function syncSourcesFromInputs() {
      state.sources = Array.from(document.querySelectorAll(".source-row")).map((row) => ({
        name: row.querySelector(".source-name").value.trim(),
        url: row.querySelector(".source-url").value.trim()
      }));
    }

    function syncCategoriesFromInputs() {
      state.categories = Array.from(document.querySelectorAll(".category-row"))
        .map((row) => row.querySelector(".category-name").value.trim())
        .filter(Boolean);
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
        "<span class='sort-control'>分类<span class='category-options'>" +
        state.categories.map((category) => {
          const checked = (channel.customGroups || []).includes(category) ? " checked" : "";
          return "<label class='category-option'><input class='category-checkbox' type='checkbox' data-id='" + escapeHtml(channel.id) + "' value='" + escapeHtml(category) + "'" + checked + ">" + escapeHtml(category) + "</label>";
        }).join("") + "</span></span>" +
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
          "<a class='linklike' href='/player/" + encodeURIComponent(channel.id) + "?source=" + source.sourceIndex + "' target='_blank' rel='noopener'>测试播放</a>" +
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
      const categoryCheckboxes = Array.from(document.querySelectorAll(".category-checkbox"));
      document.querySelectorAll(".category-option").forEach((label) => {
        label.addEventListener("click", (event) => event.stopPropagation());
      });
      categoryCheckboxes.forEach((checkbox) => {
        checkbox.addEventListener("click", (event) => event.stopPropagation());
        checkbox.addEventListener("change", async (event) => {
          event.preventDefault();
          const customGroups = categoryCheckboxes
            .filter((item) => item.dataset.id === checkbox.dataset.id && item.checked)
            .map((item) => item.value);
          await postJson("/api/channels/" + encodeURIComponent(checkbox.dataset.id) + "/override", {
            customGroups
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
      const [status, channels, sources, categories] = await Promise.all([
        fetch("/api/status").then((response) => response.json()),
        fetch("/api/channels").then((response) => response.json()),
        fetch("/api/sources").then((response) => response.json()),
        fetch("/api/categories").then((response) => response.json())
      ]);
      state.status = status;
      state.channels = channels;
      state.sources = sources;
      state.categories = categories;
      renderStatus();
      renderSources();
      renderCategories();
      renderChannels();
    }

    $("search").addEventListener("input", renderChannels);
    $("add-source").addEventListener("click", () => {
      syncSourcesFromInputs();
      state.sources.push({ name: "", url: "" });
      renderSources();
    });
    $("add-category").addEventListener("click", () => {
      syncCategoriesFromInputs();
      state.categories.push("");
      renderCategories();
    });
    $("save-categories").addEventListener("click", async () => {
      syncCategoriesFromInputs();
      $("save-categories").disabled = true;
      $("category-message").textContent = "保存中...";
      const response = await fetch("/api/categories", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ categories: state.categories })
      });
      const result = await response.json();
      if (!response.ok) {
        $("category-message").textContent = result.error || "保存失败";
        $("save-categories").disabled = false;
        return;
      }
      state.categories = result.categories;
      state.channels = result.channels || state.channels;
      $("category-message").textContent = "已保存";
      renderCategories();
      renderChannels();
      $("save-categories").disabled = false;
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

export function renderPlayerPage({ channel, source, playUrl, streamUrl }) {
  const channelName = escapeHtmlValue(channel?.name || "");
  const sourceName = escapeHtmlValue(source?.sourceName || "线路");
  const rawUrl = String(source?.url || "");
  const escapedRawUrl = escapeHtmlValue(rawUrl);
  const lowerUrl = rawUrl.toLowerCase();
  const protocolUnsupported = lowerUrl.startsWith("rtsp://") ||
    lowerUrl.startsWith("rtp://") ||
    lowerUrl.startsWith("udp://");
  const likelyMpegTs = /^https?:\/\//i.test(rawUrl) && (
    /\/(rtp|udp)\//i.test(rawUrl) ||
    lowerUrl.includes(".ts")
  );

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${channelName} - 测试播放</title>
  <style>
    :root { color-scheme: dark; --bg: #111827; --panel: #1f2937; --text: #f9fafb; --muted: #a7b0c0; --line: #374151; --accent: #2dd4bf; }
    * { box-sizing: border-box; }
    body { margin: 0; background: var(--bg); color: var(--text); font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    main { display: grid; gap: 14px; padding: 20px; max-width: 1100px; margin: 0 auto; }
    video { width: 100%; aspect-ratio: 16 / 9; background: #020617; border: 1px solid var(--line); border-radius: 8px; }
    .panel { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 14px; overflow-wrap: anywhere; }
    .actions { display: flex; flex-wrap: wrap; gap: 10px; }
    button { min-height: 38px; border: 1px solid var(--line); border-radius: 6px; padding: 0 12px; background: var(--accent); color: #04111d; font: inherit; cursor: pointer; }
    button.secondary { background: transparent; color: var(--text); }
    .status-grid { display: grid; grid-template-columns: repeat(4, minmax(120px, 1fr)); gap: 10px; }
    .status-item { border: 1px solid var(--line); border-radius: 6px; padding: 10px; background: rgba(255,255,255,0.03); }
    .status-item strong { display: block; margin-bottom: 4px; font-size: 12px; color: var(--muted); }
    .log { max-height: 160px; overflow: auto; font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 12px; white-space: pre-wrap; }
    .muted { color: var(--muted); }
    a { color: var(--accent); }
    @media (max-width: 720px) { .status-grid { grid-template-columns: 1fr 1fr; } }
  </style>
</head>
<body>
  <main>
    <section class="panel">
      <h1>${channelName}</h1>
      <div class="muted">${sourceName}</div>
      <div>原始地址：<a href="${escapedRawUrl}">${escapedRawUrl}</a></div>
    </section>
    <video id="player" class="player-video" controls autoplay playsinline></video>
    <section class="actions">
      <button id="play-now">播放/继续</button>
      <button id="toggle-muted" class="secondary">静音</button>
      <button id="reload-stream" class="secondary">重试加载</button>
      <a href="${escapeHtmlValue(streamUrl || playUrl)}">打开代理流</a>
      <a href="${escapedRawUrl}">打开原始地址</a>
    </section>
    <section class="panel" id="message">${protocolUnsupported ? "该线路协议不是浏览器可直接拉取的 HTTP/HTTPS，请优先用电视端验证。" : "正在准备播放..."}</section>
    <section class="panel">
      <div class="status-grid" id="player-status">
        <div class="status-item"><strong>状态</strong><span id="status-state">准备中</span></div>
        <div class="status-item"><strong>时间</strong><span id="status-time">0.0s</span></div>
        <div class="status-item"><strong>缓冲</strong><span id="status-buffer">0.0s</span></div>
        <div class="status-item"><strong>网络</strong><span id="status-network">-</span></div>
      </div>
    </section>
    <section class="panel">
      <div class="muted">事件</div>
      <div class="log" id="event-log"></div>
    </section>
  </main>
  <script src="https://cdn.jsdelivr.net/npm/hls.js@latest"></script>
  <script src="https://cdn.jsdelivr.net/npm/mpegts.js@latest/dist/mpegts.min.js"></script>
  <script>
    const playUrl = ${JSON.stringify(playUrl)};
    const streamUrl = ${JSON.stringify(streamUrl || playUrl)};
    const rawUrl = ${JSON.stringify(rawUrl)};
    let video = document.getElementById("player");
    const message = document.getElementById("message");
    const playNow = document.getElementById("play-now");
    const toggleMuted = document.getElementById("toggle-muted");
    const reloadStream = document.getElementById("reload-stream");
    const statusState = document.getElementById("status-state");
    const statusTime = document.getElementById("status-time");
    const statusBuffer = document.getElementById("status-buffer");
    const statusNetwork = document.getElementById("status-network");
    const eventLog = document.getElementById("event-log");
    const lower = rawUrl.toLowerCase();
    const protocolUnsupported = ${JSON.stringify(protocolUnsupported)};
    const likelyMpegTs = ${JSON.stringify(likelyMpegTs)};
    let tsPlayer = null;
    let diagnosticsAttached = false;

    function setMessage(text) {
      message.textContent = text;
    }

    function appendLog(text) {
      const line = "[" + new Date().toLocaleTimeString() + "] " + text;
      eventLog.textContent = [line, ...eventLog.textContent.split("\\n").filter(Boolean)].slice(0, 20).join("\\n");
    }

    function bufferedSeconds() {
      if (!video.buffered.length) {
        return 0;
      }
      const end = video.buffered.end(video.buffered.length - 1);
      return Math.max(0, end - video.currentTime);
    }

    function networkText() {
      return ["空闲", "加载中", "未找到源", "无后续数据"][video.networkState] || String(video.networkState);
    }

    function updateStatus(state) {
      if (state) {
        statusState.textContent = state;
      }
      statusTime.textContent = video.currentTime.toFixed(1) + "s";
      statusBuffer.textContent = bufferedSeconds().toFixed(1) + "s";
      statusNetwork.textContent = networkText() + " / readyState " + video.readyState;
    }

    function resetVideoElement() {
      const nextVideo = video.cloneNode(false);
      nextVideo.id = "player";
      nextVideo.className = "player-video";
      nextVideo.controls = true;
      nextVideo.autoplay = true;
      nextVideo.playsInline = true;
      video.replaceWith(nextVideo);
      video = nextVideo;
      diagnosticsAttached = false;
      attachVideoDiagnostics("测试播放器");
      updateStatus("已重建播放器");
      appendLog("已重建 video 元素，清除 HTMLMediaElement.error 状态");
    }

    async function tryPlay() {
      try {
        await video.play();
        updateStatus("播放中");
        appendLog("play() 成功");
      } catch (error) {
        setMessage("浏览器拦截了自动播放，请点击“播放/继续”。" + (error?.message ? " " + error.message : ""));
        updateStatus("等待手动播放");
        appendLog("play() 失败：" + (error?.message || error?.name || "未知错误"));
      }
    }

    function destroyTsPlayer() {
      if (tsPlayer) {
        try { tsPlayer.unload(); } catch (_error) {}
        try { tsPlayer.detachMediaElement(); } catch (_error) {}
        try { tsPlayer.destroy(); } catch (_error) {}
        tsPlayer = null;
      }
    }

    function attachVideoDiagnostics(prefix) {
      if (diagnosticsAttached) {
        return;
      }
      diagnosticsAttached = true;
      [
        "loadstart",
        "loadedmetadata",
        "canplay",
        "playing",
        "waiting",
        "stalled",
        "pause",
        "error"
      ].forEach((eventName) => {
        video.addEventListener(eventName, () => {
          appendLog("video " + eventName);
          updateStatus(eventName);
        });
      });
      video.addEventListener("playing", () => setMessage(prefix + " 正在播放。直播流时间显示 0:00 属于正常现象。"));
      video.addEventListener("waiting", () => setMessage(prefix + " 正在缓冲..."));
      video.addEventListener("stalled", () => setMessage(prefix + " 数据暂时中断，可能是源站卡顿或线路不可用。"));
      video.addEventListener("pause", () => setMessage(prefix + " 已暂停，请点击“播放/继续”。"));
      video.addEventListener("error", () => setMessage(prefix + " 播放器错误：" + (video.error?.message || video.error?.code || "未知错误")));
    }

    function loadMpegTs() {
      destroyTsPlayer();
      if (video.error) {
        resetVideoElement();
      }
      tsPlayer = mpegts.createPlayer({
        type: "mpegts",
        isLive: true,
        url: streamUrl
      }, {
        enableStashBuffer: false,
        lazyLoad: false
      });
      tsPlayer.on(mpegts.Events.ERROR, (type, detail, info) => {
        setMessage("mpegts.js 错误：" + type + " / " + detail + (info ? " / " + JSON.stringify(info) : ""));
        appendLog("mpegts error: " + type + " / " + detail);
        if (String(detail || "").includes("MediaMSEError") || video.error) {
          appendLog("检测到 MediaMSEError，下一次重试会重建 video 元素");
          setMessage("mpegts.js 错误：" + type + " / " + detail + "。请点“重试加载”，播放器会清理旧状态后重新连接。");
        }
      });
      tsPlayer.on(mpegts.Events.STATISTICS_INFO, (stats) => {
        if (stats?.decodedFrames > 0) {
          setMessage("使用 mpegts.js 播放中。直播流时间显示 0:00 属于正常现象。");
        }
        appendLog("mpegts stats: speed=" + (stats?.speed || "-") + " decoded=" + (stats?.decodedFrames || "-"));
      });
      tsPlayer.attachMediaElement(video);
      tsPlayer.load();
      tryPlay();
      setMessage("使用 mpegts.js 播放 MPEG-TS/组播代理流。若画面停住，请点“播放/继续”或“重试加载”。");
    }

    playNow.addEventListener("click", () => tryPlay());
    toggleMuted.addEventListener("click", () => {
      video.muted = !video.muted;
      toggleMuted.textContent = video.muted ? "取消静音" : "静音";
      appendLog(video.muted ? "已静音" : "已取消静音");
      tryPlay();
    });
    reloadStream.addEventListener("click", () => {
      appendLog("手动重试加载");
      if (likelyMpegTs && window.mpegts && mpegts.isSupported()) {
        loadMpegTs();
      } else {
        video.load();
        tryPlay();
      }
    });

    window.addEventListener("beforeunload", destroyTsPlayer);
    attachVideoDiagnostics("测试播放器");
    setInterval(() => updateStatus(), 1000);

    if (protocolUnsupported) {
      setMessage("浏览器通常不能直接拉取 rtp://、udp://、rtsp://；如无法播放，请复制原始地址到电视端测试。");
    } else if (likelyMpegTs) {
      if (window.mpegts && mpegts.isSupported()) {
        loadMpegTs();
      } else {
        setMessage("当前浏览器不支持 mpegts.js 所需的 Media Source Extensions。");
      }
    } else if (lower.includes(".m3u8")) {
      if (video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = playUrl;
        tryPlay();
        setMessage("使用浏览器原生 HLS 播放。");
      } else if (window.Hls && Hls.isSupported()) {
        const hls = new Hls();
        hls.loadSource(playUrl);
        hls.attachMedia(video);
        hls.on(Hls.Events.ERROR, (_event, data) => {
          setMessage("hls.js 错误：" + data.type + " / " + data.details);
        });
        tryPlay();
        setMessage("使用 hls.js 播放。");
      } else {
        setMessage("当前浏览器不支持 HLS 播放。");
      }
    } else {
      video.src = playUrl;
      tryPlay();
      setMessage("使用浏览器原生播放器尝试播放。");
    }
  </script>
</body>
</html>`;
}
