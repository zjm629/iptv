function escapeHtmlValue(value) {
  return String(value || "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[char]));
}

function baseStyles() {
  return `
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
  `;
}

function renderVersion(version) {
  return `<div class="muted">版本：${escapeHtmlValue(version || "unknown")}</div>`;
}

export function renderHomePage(options = {}) {
  const appVersion = options.appVersion || "unknown";
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>IPTV M3U Manager</title>
  <style>
    ${baseStyles()}
    .toolbar, .status, .channel, .source-editor, .auto-source-editor, .category-editor {
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
    .source-ok { color: var(--accent); }
    .source-bad { color: var(--danger); }
    .source-list, .category-list {
      display: grid;
      gap: 10px;
      margin-bottom: 12px;
    }
    .source-row.hidden {
      opacity: 0.62;
    }
    .source-row.hidden .source-name,
    .source-row.hidden .source-url {
      text-decoration: line-through;
      color: var(--muted);
    }
    .source-row, .category-row {
      display: grid;
      grid-template-columns: minmax(140px, 220px) 1fr auto;
      gap: 10px;
      align-items: center;
    }
    .auto-source-grid {
      display: grid;
      grid-template-columns: minmax(180px, 260px) 1fr minmax(100px, 140px);
      gap: 10px;
      align-items: center;
      margin-bottom: 12px;
    }
    .auto-source-preview {
      display: grid;
      gap: 8px;
      margin-top: 12px;
    }
    .auto-source-preview-row {
      display: grid;
      grid-template-columns: minmax(180px, 280px) 1fr auto;
      gap: 10px;
      align-items: center;
      padding-top: 8px;
      border-top: 1px solid var(--line);
      overflow-wrap: anywhere;
      color: var(--muted);
      font-size: 14px;
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
    .header-actions {
      display: flex;
      gap: 8px;
      align-items: center;
      flex-wrap: wrap;
    }
    .auto-source-editor { display: none; }
    @media (max-width: 860px) {
      header, .toolbar, .source-row, .auto-source-grid, .auto-source-preview-row, .line {
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
      ${renderVersion(appVersion)}
    </div>
    <div class="header-actions">
      <a class="linklike" href="/collector">自动采集</a>
      <button id="refresh">刷新</button>
    </div>
  </header>
  <main>
    <section class="source-editor">
      <h2>采集源</h2>
      <div class="source-list" id="sources"></div>
      <div class="source-actions">
        <button class="secondary" id="add-source">新增源</button>
        <a class="linklike" href="/collector">自动采集</a>
        <button id="save-sources">保存并刷新</button>
        <span class="muted" id="source-message"></span>
      </div>
    </section>
    <section class="auto-source-editor">
      <h2>自动采集</h2>
      <div class="auto-source-grid">
        <label class="category-option"><input class="category-checkbox" id="auto-source-enabled" type="checkbox">启用自动采集</label>
        <input id="auto-source-page-url" placeholder="采集网页，例如 https://iptv.cqshushu.com/index.php">
        <input id="auto-source-max-pages" type="number" min="1" max="20" step="1" placeholder="页数">
      </div>
      <input id="auto-source-keywords" placeholder="关键词，多个用逗号分隔，例如 电信">
      <div class="source-actions" style="margin-top: 12px;">
        <button class="secondary" id="preview-auto-sources">预览自动采集</button>
        <button id="save-auto-sources">保存自动采集</button>
        <span class="muted" id="auto-source-message"></span>
      </div>
      <div class="auto-source-preview" id="auto-source-preview"></div>
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
    const state = {
      channels: [],
      status: null,
      sources: [],
      categories: [],
      autoSourceConfig: {
        enabled: false,
        pageUrl: "https://iptv.cqshushu.com/index.php",
        keywords: ["电信"],
        disabledTypeNames: [],
        maxPages: 20
      },
      autoSourcePreview: []
    };
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

    async function fetchJsonOrFallback(url, fallback) {
      try {
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error("HTTP " + response.status);
        }
        return await response.json();
      } catch (error) {
        console.error("Load failed:", url, error);
        return fallback;
      }
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
        " <strong>手动：</strong>" + (status.manualSourceCount ?? state.sources.length) +
        " <strong>自动：</strong>" + (status.autoSourceCount ?? 0) +
        " <strong>刷新中：</strong>" + (status.refreshing ? "是" : "否") +
        "<div>" + status.sources.map((source) =>
          "<div class='" + (source.ok ? "source-ok" : "source-bad") + "'>" +
          escapeHtml(source.name) + " - " + (source.ok ? "成功 " + source.channels + " 个频道" : "失败：" + escapeHtml(source.error)) +
          "</div>"
        ).join("") + "</div>";
    }

    function renderSources() {
      const rows = state.sources.length ? state.sources : [{ name: "", url: "", hidden: false }];
      $("sources").innerHTML = rows.map((source, index) =>
        "<div class='source-row " + (source.hidden ? "hidden" : "") + "' data-index='" + index + "' data-hidden='" + Boolean(source.hidden) + "'>" +
        "<input class='source-name' placeholder='名称，可留空' value='" + escapeHtml(source.name) + "'>" +
        "<input class='source-url' placeholder='M3U 地址，例如 https://example.com/list.m3u' value='" + escapeHtml(source.url) + "'>" +
        "<span class='source-actions'>" +
        (source.hidden ? "<span class='badge'>已隐藏</span>" : "") +
        "<button class='linklike move-source' data-index='" + index + "' data-direction='top' " + (index === 0 ? "disabled" : "") + ">置顶</button>" +
        "<button class='linklike move-source' data-index='" + index + "' data-direction='up' " + (index === 0 ? "disabled" : "") + ">上移</button>" +
        "<button class='linklike move-source' data-index='" + index + "' data-direction='down' " + (index === rows.length - 1 ? "disabled" : "") + ">下移</button>" +
        "<button class='linklike move-source' data-index='" + index + "' data-direction='bottom' " + (index === rows.length - 1 ? "disabled" : "") + ">置底</button>" +
        "<button class='secondary toggle-source-hidden' data-index='" + index + "'>" + (source.hidden ? "恢复" : "隐藏") + "</button>" +
        "<button class='danger remove-source' data-index='" + index + "'>删除</button>" +
        "</span>" +
        "</div>"
      ).join("");
      document.querySelectorAll(".toggle-source-hidden").forEach((button) => {
        button.addEventListener("click", () => {
          syncSourcesFromInputs();
          const index = Number(button.dataset.index);
          state.sources[index].hidden = !state.sources[index].hidden;
          renderSources();
        });
      });
      document.querySelectorAll(".move-source").forEach((button) => {
        button.addEventListener("click", () => {
          syncSourcesFromInputs();
          const index = Number(button.dataset.index);
          if (button.dataset.direction === "top" && index > 0) {
            state.sources.unshift(...state.sources.splice(index, 1));
            renderSources();
            return;
          }
          if (button.dataset.direction === "bottom" && index < state.sources.length - 1) {
            state.sources.push(...state.sources.splice(index, 1));
            renderSources();
            return;
          }
          const target = button.dataset.direction === "up" ? index - 1 : index + 1;
          if (target < 0 || target >= state.sources.length) {
            return;
          }
          [state.sources[index], state.sources[target]] = [state.sources[target], state.sources[index]];
          renderSources();
        });
      });
      document.querySelectorAll(".remove-source").forEach((button) => {
        button.addEventListener("click", () => {
          syncSourcesFromInputs();
          state.sources.splice(Number(button.dataset.index), 1);
          renderSources();
        });
      });
    }

    function autoSourceConfigFromForm() {
      return {
        ...state.autoSourceConfig,
        enabled: $("auto-source-enabled").checked,
        pageUrl: $("auto-source-page-url").value.trim(),
        keywords: $("auto-source-keywords").value.split(/[,，\\n]/).map((item) => item.trim()).filter(Boolean),
        maxPages: Number($("auto-source-max-pages").value || 20),
        todayOnly: true,
        onlyStatus: "新上线",
        uniqueByType: true,
        disabledTypeNames: Array.from(new Set(state.autoSourceConfig.disabledTypeNames || []))
      };
    }

    function renderAutoSources() {
      const config = state.autoSourceConfig || {};
      $("auto-source-enabled").checked = Boolean(config.enabled);
      $("auto-source-page-url").value = config.pageUrl || "https://iptv.cqshushu.com/index.php";
      $("auto-source-keywords").value = (config.keywords || ["电信"]).join(", ");
      $("auto-source-max-pages").value = config.maxPages || 20;

      const disabled = new Set(config.disabledTypeNames || []);
      const previewRows = state.autoSourcePreview || [];
      $("auto-source-preview").innerHTML = previewRows.length
        ? previewRows.map((source) =>
          "<div class='auto-source-preview-row'>" +
          "<strong>" + escapeHtml(source.typeName || source.name) + "</strong>" +
          "<span>" + escapeHtml(source.url || "") + (source.updatedAt ? " · " + escapeHtml(source.updatedAt) : "") + "</span>" +
          "<span class='source-actions'>" +
          (disabled.has(source.typeName) ? "<span class='badge'>已隐藏</span>" : "") +
          "<button class='" + (disabled.has(source.typeName) ? "secondary" : "danger") + " toggle-auto-source-type' data-type='" + escapeHtml(source.typeName || "") + "'>" +
          (disabled.has(source.typeName) ? "恢复" : "隐藏") + "</button>" +
          "</span></div>"
        ).join("")
        : "<div class='muted'>预览后会显示当天新上线的电信源；同类型只保留网页最前面的一条。</div>";

      document.querySelectorAll(".toggle-auto-source-type").forEach((button) => {
        button.addEventListener("click", () => {
          state.autoSourceConfig = autoSourceConfigFromForm();
          const typeName = button.dataset.type;
          const nextDisabled = new Set(state.autoSourceConfig.disabledTypeNames || []);
          if (nextDisabled.has(typeName)) {
            nextDisabled.delete(typeName);
          } else if (typeName) {
            nextDisabled.add(typeName);
          }
          state.autoSourceConfig.disabledTypeNames = Array.from(nextDisabled);
          renderAutoSources();
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
        "<button class='linklike move-category' data-index='" + index + "' data-direction='top' " + (index <= 1 ? "disabled" : "") + ">置顶</button>" +
        "<button class='linklike move-category' data-index='" + index + "' data-direction='up' " + (index <= 1 ? "disabled" : "") + ">上移</button>" +
        "<button class='linklike move-category' data-index='" + index + "' data-direction='down' " + (index === 0 || index === rows.length - 1 ? "disabled" : "") + ">下移</button>" +
        "<button class='linklike move-category' data-index='" + index + "' data-direction='bottom' " + (index === 0 || index === rows.length - 1 ? "disabled" : "") + ">置底</button>" +
        "<button class='danger remove-category' data-index='" + index + "' " + (index === 0 ? "disabled" : "") + ">删除</button>" +
        "</span>" +
        "</div>"
      ).join("");
      document.querySelectorAll(".move-category").forEach((button) => {
        button.addEventListener("click", () => {
          syncCategoriesFromInputs();
          const index = Number(button.dataset.index);
          if (button.dataset.direction === "top" && index > 1) {
            state.categories.splice(1, 0, ...state.categories.splice(index, 1));
            renderCategories();
            renderChannels();
            return;
          }
          if (button.dataset.direction === "bottom" && index > 0 && index < state.categories.length - 1) {
            state.categories.push(...state.categories.splice(index, 1));
            renderCategories();
            renderChannels();
            return;
          }
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
        url: row.querySelector(".source-url").value.trim(),
        hidden: row.dataset.hidden === "true"
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
        "<button class='linklike move-channel' data-id='" + escapeHtml(channel.id) + "' data-direction='bottom'>置底</button>" +
        "<button class='" + (channel.hidden ? "secondary" : "danger") + " toggle-channel' data-id='" + escapeHtml(channel.id) + "' data-hidden='" + (!channel.hidden) + "'>" +
        (channel.hidden ? "恢复" : "隐藏") + "</button>" +
        "</span></summary><div class='lines'>" +
        channel.sources.map((source, lineIndex) =>
          "<div class='line " + (source.disabled ? "disabled" : "") + "'>" +
          "<a href='/play/" + encodeURIComponent(channel.id) + "?line=" + lineIndex + "'>线路 " +
          (lineIndex + 1) + " - " + escapeHtml(source.sourceName) + "</a><span>" + escapeHtml(source.url) + "</span>" +
          "<span class='line-actions'>" +
          "<a class='linklike' href='/player/" + encodeURIComponent(channel.id) + "?line=" + lineIndex + "' target='_blank' rel='noopener'>测试播放</a>" +
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
      const [status, channels, sources, categories, autoSourceConfig] = await Promise.all([
        fetchJsonOrFallback("/api/status", { lastSuccessAt: null, channelCount: 0, sourceCount: 0, sources: [] }),
        fetchJsonOrFallback("/api/channels", []),
        fetchJsonOrFallback("/api/sources", []),
        fetchJsonOrFallback("/api/categories", ["推荐频道"]),
        fetchJsonOrFallback("/api/auto-sources", state.autoSourceConfig)
      ]);
      state.status = status;
      state.channels = channels;
      state.sources = sources;
      state.categories = categories;
      state.autoSourceConfig = autoSourceConfig;
      renderStatus();
      renderSources();
      renderAutoSources();
      renderCategories();
      renderChannels();
    }

    $("search").addEventListener("input", renderChannels);
    $("add-source").addEventListener("click", () => {
      syncSourcesFromInputs();
      state.sources.push({ name: "", url: "", hidden: false });
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
    $("preview-auto-sources").addEventListener("click", async () => {
      state.autoSourceConfig = autoSourceConfigFromForm();
      $("preview-auto-sources").disabled = true;
      $("auto-source-message").textContent = "预览中...";
      const response = await fetch("/api/auto-sources/discover", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...state.autoSourceConfig, enabled: true })
      });
      const result = await response.json();
      if (!response.ok) {
        $("auto-source-message").textContent = result.error || "预览失败";
        $("preview-auto-sources").disabled = false;
        return;
      }
      state.autoSourcePreview = result.sources || [];
      const existingUrls = new Set(state.sources.map((source) => source.url));
      for (const source of state.autoSourcePreview) {
        if (source.url && !existingUrls.has(source.url)) {
          state.sources.push({ name: source.typeName || source.name || "自动采集", url: source.url, hidden: false });
          existingUrls.add(source.url);
        }
      }
      $("auto-source-message").textContent = "预览到 " + state.autoSourcePreview.length + " 个自动源，已填入采集源列表";
      renderAutoSources();
      renderSources();
      $("preview-auto-sources").disabled = false;
    });
    $("save-auto-sources").addEventListener("click", async () => {
      state.autoSourceConfig = autoSourceConfigFromForm();
      $("save-auto-sources").disabled = true;
      $("auto-source-message").textContent = "保存中...";
      const response = await fetch("/api/auto-sources", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(state.autoSourceConfig)
      });
      const result = await response.json();
      if (!response.ok) {
        $("auto-source-message").textContent = result.error || "保存失败";
        $("save-auto-sources").disabled = false;
        return;
      }
      state.autoSourceConfig = result.config;
      $("auto-source-message").textContent = "已保存并刷新";
      await load();
      $("save-auto-sources").disabled = false;
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

export function renderCollectorPage(options = {}) {
  const appVersion = options.appVersion || "unknown";
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>自动采集 - IPTV M3U Manager</title>
  <style>
    ${baseStyles()}
    .panel {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 14px;
    }
    .collector-grid {
      display: grid;
      grid-template-columns: 1fr minmax(100px, 140px) minmax(100px, 140px) minmax(130px, 170px);
      gap: 10px;
      margin-bottom: 10px;
    }
    .collector-field {
      display: grid;
      gap: 4px;
      color: var(--muted);
      font-size: 12px;
    }
    .actions, .result-actions {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
      align-items: center;
      margin-top: 12px;
    }
    .results {
      display: grid;
      gap: 8px;
      margin-top: 12px;
    }
    .result-row {
      display: grid;
      grid-template-columns: auto minmax(180px, 280px) minmax(180px, 260px) 1fr auto;
      gap: 10px;
      align-items: center;
      padding-top: 8px;
      border-top: 1px solid var(--line);
      overflow-wrap: anywhere;
      color: var(--muted);
      font-size: 14px;
    }
    .result-meta {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      align-items: center;
    }
    .progress-wrap {
      margin-top: 12px;
      display: grid;
      gap: 8px;
    }
    .progress-track {
      height: 12px;
      border-radius: 999px;
      background: var(--soft);
      overflow: hidden;
      border: 1px solid var(--line);
    }
    .progress-bar {
      width: 0%;
      height: 100%;
      background: var(--accent);
      transition: width 180ms ease;
    }
    .log {
      margin-top: 12px;
      max-height: 260px;
      overflow: auto;
      display: grid;
      gap: 6px;
      font-size: 13px;
    }
    .log-line {
      display: grid;
      grid-template-columns: minmax(70px, 90px) 1fr;
      gap: 8px;
      padding: 6px 0;
      border-top: 1px solid var(--line);
      color: var(--muted);
    }
    .skipped {
      margin-top: 12px;
      display: grid;
      gap: 8px;
      color: var(--muted);
      font-size: 13px;
    }
    .skipped-row {
      border-top: 1px solid var(--line);
      padding-top: 8px;
      overflow-wrap: anywhere;
    }
    .warning { color: var(--danger); }
    @media (max-width: 760px) {
      .collector-grid, .result-row { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <header>
    <div>
      <h1>自动采集</h1>
      <div class="muted" id="subtitle">采集完成后会自动加入首页采集源</div>
      ${renderVersion(appVersion)}
    </div>
    <a class="linklike" href="/">返回首页</a>
  </header>
  <main>
    <section class="panel">
      <h2>采集设置</h2>
      <div class="collector-grid">
        <label class="collector-field">采集页面<input id="collector-page-url" value="https://iptv.cqshushu.com/index.php?q=%E7%94%B5%E4%BF%A1"></label>
        <label class="collector-field">起始页<input id="collector-start-page" type="number" min="1" max="200" step="1" value="1"></label>
        <label class="collector-field">采集页数<input id="collector-max-pages" type="number" min="1" max="20" step="1" value="2"></label>
        <label class="collector-field">首次点击等待秒数<input id="collector-click-delay" type="number" min="0" max="60" step="1" value="8"></label>
      </div>
      <input id="collector-keywords" value="电信" placeholder="关键词，多个用逗号分隔">
      <div class="actions">
        <button id="preview">预览采集</button>
        <button id="stop-preview" class="danger" disabled>停止采集</button>
        <button id="select-all" class="secondary">全选</button>
        <button id="clear-selected" class="secondary">取消全选</button>
        <button id="collect" class="secondary">提交选中到首页采集源</button>
        <span class="muted" id="message"></span>
      </div>
      <div class="progress-wrap">
        <div class="progress-track"><div class="progress-bar" id="progress-bar"></div></div>
        <div class="muted" id="progress-text">等待开始</div>
      </div>
    </section>
    <section class="panel">
      <h2>采集结果</h2>
      <div id="warnings"></div>
      <div class="results" id="results"></div>
      <div class="skipped" id="skipped"></div>
      <div class="log" id="progress-log"></div>
    </section>
  </main>
  <script>
    const $ = (id) => document.getElementById(id);
    let latestSources = [];
    let currentJobId = "";

    function escapeHtml(value) {
      return String(value || "").replace(/[&<>"']/g, (char) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
      }[char]));
    }

    function configFromForm() {
      return {
        enabled: true,
        pageUrl: $("collector-page-url").value.trim(),
        keywords: $("collector-keywords").value.split(/[,，\\n]/).map((item) => item.trim()).filter(Boolean),
        startPage: Number($("collector-start-page").value || 1),
        maxPages: Number($("collector-max-pages").value || 2),
        todayOnly: true,
        onlyStatus: "新上线",
        uniqueByType: false,
        resolveDetailUrls: true,
        pageDelayMs: 8000,
        rateLimitDelayMs: 45000,
        rateLimitRetries: 1,
        detailDelayMs: 3000,
        detailInitialDelayMs: Number($("collector-click-delay").value || 8) * 1000,
        detailRetryDelayMs: 10000,
        detailRetries: 2,
        m3uCheckRetries: 2,
        browserFetch: true,
        browserTimeoutMs: 25000,
        m3uCheckRetryDelayMs: 10000,
        requestTimeoutMs: 15000
      };
    }

    function renderProgress(job) {
      const progress = job.progress || [];
      const latest = progress[progress.length - 1] || {};
      const progressEvent = progress.slice().reverse().find((event) =>
        event.current !== undefined || event.total !== undefined
      ) || latest;
      const result = job.result || {};
      const total = progressEvent.total || (result.rows || []).length || 0;
      const current = progressEvent.current || (job.status === "done" ? total : 0);
      const percent = total > 0 ? Math.min(100, Math.round((current / total) * 100)) : (job.status === "done" ? 100 : 0);
      $("progress-bar").style.width = percent + "%";
      $("progress-text").textContent = (latest.message || "正在准备采集...") + "（" + percent + "%）";
      $("progress-log").innerHTML = progress.slice(-120).reverse().map((event) =>
        "<div class='log-line'>" +
        "<span>" + escapeHtml(event.time ? new Date(event.time).toLocaleTimeString() : "") + "</span>" +
        "<span>" + escapeHtml(event.message || event.phase || "") +
        (event.error ? "；" + escapeHtml(event.error) : "") +
        (event.finalUrl ? "；实际 " + escapeHtml(event.finalUrl) : "") +
        (event.m3uUrl ? "；M3U 实际地址 " + escapeHtml(event.m3uUrl) : "") +
        (event.pageTitle ? "；标题 " + escapeHtml(event.pageTitle) : "") +
        (event.hasSecurityChallenge ? "；安全验证页" : "") +
        (event.hasAccessDenied ? "；访问被拒绝" : "") +
        (event.pageBytes !== undefined ? "；页面字节 " + escapeHtml(event.pageBytes) : "") +
        (event.anchorCount !== undefined ? "；链接 " + escapeHtml(event.anchorCount) : "") +
        (event.channelLines !== undefined ? "；频道 " + escapeHtml(event.channelLines) : "") +
        (event.bytes !== undefined ? "；字节 " + escapeHtml(event.bytes) : "") +
        "</span></div>"
      ).join("");
    }

    function renderDiscovery(result) {
      latestSources = result.sources || [];
      const warnings = result.warnings || [];
      const pageMessages = (result.pages || [])
        .filter((page) => page.error || page.rows === 0)
        .map((page) => "第 " + page.page + " 页：" + (page.error || "未解析到源列表") + "（" + page.url + "）");
      $("warnings").innerHTML = warnings.concat(pageMessages).map((warning) =>
        "<div class='warning'>" + escapeHtml(warning) + "</div>"
      ).join("");
      $("results").innerHTML = latestSources.length
        ? latestSources.map((source) =>
          "<div class='result-row'>" +
          "<input class='result-check' type='checkbox' checked data-url='" + escapeHtml(source.url) + "'>" +
          "<strong>" + escapeHtml(source.typeName || source.name) + "</strong>" +
          "<span class='result-meta'>" +
          (source.channelCount ? "<span>频道数：" + escapeHtml(source.channelCount) + "</span>" : "<span>频道数：未知</span>") +
          (source.updatedAt ? "<span>更新时间：" + escapeHtml(source.updatedAt) + "</span>" : "<span>更新时间：未知</span>") +
          (source.ip ? "<span>IP：" + escapeHtml(source.ip) + "</span>" : "") +
          "</span>" +
          "<span>" + escapeHtml(source.url) + "</span>" +
          "<button class='secondary test-potplayer' data-url='" + escapeHtml(source.url) + "'>PotPlayer测试</button>" +
          "</div>"
        ).join("")
        : "<div class='muted'>暂未采集到符合条件的源。</div>";
      const skipped = result.skippedSources || [];
      $("skipped").innerHTML = skipped.length
        ? "<strong>跳过明细</strong>" + skipped.map((source) =>
          "<div class='skipped-row'>" +
          "<div><strong>" + escapeHtml(source.ip || "") + "</strong> " + escapeHtml(source.typeName || "") + "</div>" +
          "<div>原因：" + escapeHtml(source.message || source.reason || "") +
          (source.detailSummary?.title ? "；标题：" + escapeHtml(source.detailSummary.title) : "") +
          (source.detailSummary?.hasSecurityChallenge ? "；安全验证页" : "") +
          (source.detailSummary?.hasAccessDenied ? "；访问被拒绝" : "") +
          (source.detailSummary?.text ? "；正文：" + escapeHtml(source.detailSummary.text) : "") +
          (source.channelLines !== undefined ? "；频道数：" + escapeHtml(source.channelLines) : "") +
          (source.bytes !== undefined ? "；字节：" + escapeHtml(source.bytes) : "") +
          "</div>" +
          (source.m3uUrl ? "<div>M3U：" + escapeHtml(source.m3uUrl) + "</div>" : "") +
          (source.head ? "<div>返回开头：" + escapeHtml(source.head) + "</div>" : "") +
          "</div>"
        ).join("")
        : "";
      document.querySelectorAll(".test-potplayer").forEach((button) => {
        button.addEventListener("click", () => {
          window.location.href = "potplayer://" + button.dataset.url;
        });
      });
    }

    async function parseJsonResponse(response) {
      const text = await response.text();
      if (!text.trim()) {
        throw new Error("服务器返回空响应");
      }
      try {
        return JSON.parse(text);
      } catch (_error) {
        throw new Error("服务器返回的不是 JSON：" + text.slice(0, 120));
      }
    }

    async function postJson(url, payload) {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload)
      });
      const result = await parseJsonResponse(response);
      if (!response.ok) {
        throw new Error(result.error || "操作失败");
      }
      return result;
    }

    async function getJson(url) {
      const response = await fetch(url);
      const result = await parseJsonResponse(response);
      if (!response.ok) {
        throw new Error(result.error || "操作失败");
      }
      return result;
    }

    function setCollectorRunning(running) {
      $("preview").disabled = running;
      $("stop-preview").disabled = !running || !currentJobId;
    }

    $("preview").addEventListener("click", async () => {
      currentJobId = "";
      setCollectorRunning(true);
      $("message").textContent = "已启动慢速精采，正在逐条进入详情页提取真实 M3U。";
      $("warnings").innerHTML = "";
      $("results").innerHTML = "";
      $("skipped").innerHTML = "";
      $("progress-log").innerHTML = "";
      $("progress-bar").style.width = "0%";
      $("progress-text").textContent = "正在启动采集任务...";
      try {
        let job = await postJson("/api/auto-sources/discover-jobs", configFromForm());
        currentJobId = job.id;
        setCollectorRunning(true);
        renderProgress(job);
        while (job.status === "running") {
          await new Promise((resolve) => setTimeout(resolve, 1000));
          job = await getJson("/api/auto-sources/discover-jobs/" + encodeURIComponent(job.id));
          renderProgress(job);
        }
        if (job.status === "error") {
          throw new Error(job.error || "采集失败");
        }
        if (job.status === "cancelled") {
          renderDiscovery(job.result || {});
          $("message").textContent = "\u91c7\u96c6\u5df2\u505c\u6b62\uff0c\u4fdd\u7559\u5df2\u6210\u529f " + latestSources.length + " \u4e2a\u6e90";
          renderProgress(job);
          return;
        }
        renderDiscovery(job.result || {});
        renderProgress(job);
        $("message").textContent = "预览到 " + latestSources.length + " 个源";
      } catch (error) {
        $("message").textContent = error.message;
      } finally {
        currentJobId = "";
        setCollectorRunning(false);
      }
    });

    $("stop-preview").addEventListener("click", async () => {
      if (!currentJobId) {
        return;
      }
      $("stop-preview").disabled = true;
      $("message").textContent = "正在停止采集...";
      try {
        const job = await postJson("/api/auto-sources/discover-jobs/" + encodeURIComponent(currentJobId) + "/cancel", {});
        renderDiscovery(job.result || {});
        renderProgress(job);
        $("message").textContent = "\u91c7\u96c6\u5df2\u505c\u6b62\uff0c\u4fdd\u7559\u5df2\u6210\u529f " + latestSources.length + " \u4e2a\u6e90";
      } catch (error) {
        $("message").textContent = error.message;
        $("stop-preview").disabled = false;
      }
    });

    $("select-all").addEventListener("click", () => {
      document.querySelectorAll(".result-check").forEach((checkbox) => {
        checkbox.checked = true;
      });
    });

    $("clear-selected").addEventListener("click", () => {
      document.querySelectorAll(".result-check").forEach((checkbox) => {
        checkbox.checked = false;
      });
    });

    $("collect").addEventListener("click", async () => {
      $("collect").disabled = true;
      $("message").textContent = "正在提交选中源...";
      try {
        const selectedUrls = new Set(Array.from(document.querySelectorAll(".result-check"))
          .filter((checkbox) => checkbox.checked)
          .map((checkbox) => checkbox.dataset.url));
        const selectedSources = latestSources.filter((source) => selectedUrls.has(source.url));
        const result = await postJson("/api/auto-sources/collect", { sources: selectedSources });
        $("message").textContent = "新增 " + (result.added || []).length + " 个源，已写入首页采集源";
      } catch (error) {
        $("message").textContent = error.message;
      } finally {
        $("collect").disabled = false;
      }
    });
  </script>
</body>
</html>`;
}

export function renderPlayerPage({ channel, source, playUrl, streamUrl, hlsPreviewUrl }) {
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
  const useDirectHls = lowerUrl.includes(".m3u8");
  const useHlsPreview = false;

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
    .player-wrap { position: relative; }
    video { width: 100%; aspect-ratio: 16 / 9; background: #020617; border: 1px solid var(--line); border-radius: 8px; }
    .start-overlay {
      position: absolute;
      inset: 0;
      display: grid;
      place-items: center;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: linear-gradient(transparent 45%, rgba(2, 6, 23, 0.72));
      color: var(--text);
      font-size: 22px;
      font-weight: 700;
      text-shadow: 0 1px 2px #020617;
    }
    .start-overlay.hidden { display: none; }
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
    <section class="player-wrap">
      <video id="player" class="player-video" controls playsinline autoplay></video>
      <button id="start-overlay" class="start-overlay">点击播放</button>
    </section>
    <section class="actions">
      <button id="play-now">播放/继续</button>
      <button id="toggle-muted" class="secondary">静音</button>
      <button id="reload-stream" class="secondary">重试加载</button>
      <button id="ffmpeg-preview" class="secondary">FFmpeg预览</button>
      <button id="open-potplayer" class="secondary">PotPlayer打开</button>
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
    const hlsPreviewUrl = ${JSON.stringify(hlsPreviewUrl || playUrl)};
    const rawUrl = ${JSON.stringify(rawUrl)};
    let video = document.getElementById("player");
    const message = document.getElementById("message");
    const startOverlay = document.getElementById("start-overlay");
    const playNow = document.getElementById("play-now");
    const toggleMuted = document.getElementById("toggle-muted");
    const reloadStream = document.getElementById("reload-stream");
    const ffmpegPreview = document.getElementById("ffmpeg-preview");
    const openPotPlayer = document.getElementById("open-potplayer");
    const statusState = document.getElementById("status-state");
    const statusTime = document.getElementById("status-time");
    const statusBuffer = document.getElementById("status-buffer");
    const statusNetwork = document.getElementById("status-network");
    const eventLog = document.getElementById("event-log");
    const lower = rawUrl.toLowerCase();
    const protocolUnsupported = ${JSON.stringify(protocolUnsupported)};
    const likelyMpegTs = ${JSON.stringify(likelyMpegTs)};
    const useDirectHls = ${JSON.stringify(useDirectHls)};
    const useHlsPreview = ${JSON.stringify(useHlsPreview)};
    let tsPlayer = null;
    let hlsPlayer = null;
    let diagnosticsAttached = false;
    let hasDecodedFrames = false;

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

    function updateStartOverlay() {
      startOverlay.classList.toggle("hidden", !video.paused);
    }

    async function tryAutoplay(reason) {
      video.muted = false;
      toggleMuted.textContent = "静音";
      appendLog("尝试有声自动播放" + (reason ? "：" + reason : ""));
      try {
        await video.play();
        updateStatus("播放中");
        updateStartOverlay();
        appendLog("有声自动播放成功");
      } catch (error) {
        appendLog("有声自动播放被浏览器拦截，改用静音自动播放：" + (error?.message || error?.name || "未知错误"));
        video.muted = true;
        toggleMuted.textContent = "取消静音";
        setMessage("浏览器拦截了有声自动播放，已改为静音自动播放。需要声音请点“取消静音”。");
        await tryPlay();
      }
    }

    function resetVideoElement() {
      const nextVideo = video.cloneNode(false);
      nextVideo.id = "player";
      nextVideo.className = "player-video";
      nextVideo.controls = true;
      nextVideo.playsInline = true;
      nextVideo.autoplay = true;
      nextVideo.muted = false;
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
        updateStartOverlay();
        appendLog("play() 成功");
      } catch (error) {
        setMessage("请点击视频中间的“点击播放”或下方“播放/继续”启动有声播放。" + (error?.message ? " " + error.message : ""));
        updateStatus("等待手动播放");
        updateStartOverlay();
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
      if (hlsPlayer) {
        try { hlsPlayer.destroy(); } catch (_error) {}
        hlsPlayer = null;
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
      video.addEventListener("play", updateStartOverlay);
      video.addEventListener("pause", updateStartOverlay);
      video.addEventListener("click", () => tryPlay());
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
        enableWorker: true,
        enableStashBuffer: false,
        stashInitialSize: 64 * 1024,
        lazyLoad: false,
        autoCleanupSourceBuffer: true,
        autoCleanupMaxBackwardDuration: 30,
        autoCleanupMinBackwardDuration: 10
      });
      tsPlayer.on(mpegts.Events.ERROR, (type, detail, info) => {
        appendLog("mpegts error: " + type + " / " + detail);
        if (String(detail || "").includes("MediaMSEError") || video.error) {
          appendLog("检测到 MediaMSEError，下一次重试会重建 video 元素");
          if (!hasDecodedFrames || video.paused) {
            setMessage("mpegts.js 错误：" + type + " / " + detail + "。如画面不动，请点“重试加载”。");
          }
        } else {
          setMessage("mpegts.js 错误：" + type + " / " + detail + (info ? " / " + JSON.stringify(info) : ""));
        }
      });
      tsPlayer.on(mpegts.Events.STATISTICS_INFO, (stats) => {
        if (stats?.decodedFrames > 0) {
          hasDecodedFrames = true;
          setMessage("使用 mpegts.js 播放中。直播流时间显示 0:00 属于正常现象。");
        }
        appendLog("mpegts stats: speed=" + (stats?.speed || "-") + " decoded=" + (stats?.decodedFrames || "-"));
      });
      tsPlayer.attachMediaElement(video);
      tsPlayer.load();
      updateStartOverlay();
      setMessage("已预加载 MPEG-TS/组播代理流。请点击画面中间的“点击播放”启动有声播放。");
    }

    function loadHlsStream(url, label, startupMessage) {
      destroyTsPlayer();
      if (video.error) {
        resetVideoElement();
      }
      const isSafariNativeHls = video.canPlayType("application/vnd.apple.mpegurl") &&
        /^((?!chrome|android|crios|fxios|edg).)*safari/i.test(navigator.userAgent);
      if (window.Hls && Hls.isSupported() && !isSafariNativeHls) {
        hlsPlayer = new Hls({
          liveSyncDurationCount: 5,
          maxBufferLength: 30,
          maxMaxBufferLength: 60,
          maxLiveSyncPlaybackRate: 1.25,
          enableWorker: true,
          lowLatencyMode: false
        });
        hlsPlayer.on(Hls.Events.MEDIA_ATTACHED, () => {
          appendLog("hls media attached");
          hlsPlayer.loadSource(url);
        });
        hlsPlayer.on(Hls.Events.MANIFEST_PARSED, () => {
          appendLog("hls manifest parsed");
          updateStartOverlay();
          setMessage(label + " 已解析播放清单，正在尝试自动播放。");
          tryAutoplay("HLS 清单已解析");
        });
        hlsPlayer.on(Hls.Events.ERROR, (_event, data) => {
          appendLog("hls error: " + data.type + " / " + data.details + (data.response ? " / HTTP " + data.response.code : ""));
          if (!data.fatal) {
            setMessage(label + " 正在播放，检测到可恢复缓冲错误：" + data.details);
            return;
          }
          if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
            appendLog("hls fatal media error, recoverMediaError()");
            hlsPlayer.recoverMediaError();
            setMessage(label + " 正在自动恢复媒体缓冲。");
            return;
          }
          if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
            appendLog("hls fatal network error, startLoad()");
            hlsPlayer.startLoad();
            setMessage(label + " 网络加载异常，正在重新拉流。");
            return;
          }
          setMessage(label + " 错误：" + data.type + " / " + data.details + (data.response ? " / HTTP " + data.response.code : ""));
        });
        hlsPlayer.attachMedia(video);
        updateStartOverlay();
        setMessage(startupMessage);
        return;
      }
      if (isSafariNativeHls) {
        video.src = url;
        video.load();
        updateStartOverlay();
        setMessage(label + " 已加载，正在尝试自动播放。");
        tryAutoplay("Safari 原生 HLS 已加载");
        return;
      }
      setMessage("当前浏览器不支持 HLS 播放。");
    }

    function loadHlsPreview(url, label) {
      loadHlsStream(url, label, label + " 正在启动，FFmpeg 需要几秒生成首个片段。请稍后点击播放。");
    }

    function loadDirectHls(url, label) {
      loadHlsStream(url, label, label + " 正在加载代理播放清单，避免浏览器跨域和分片路径问题。");
    }

    function restartPreviewUrl(url) {
      return url + (url.includes("?") ? "&" : "?") + "restart=1&t=" + Date.now();
    }

    playNow.addEventListener("click", () => tryPlay());
    startOverlay.addEventListener("click", () => tryPlay());
    toggleMuted.addEventListener("click", () => {
      video.muted = !video.muted;
      toggleMuted.textContent = video.muted ? "取消静音" : "静音";
      appendLog(video.muted ? "已静音" : "已取消静音");
      tryPlay();
    });
    reloadStream.addEventListener("click", () => {
      appendLog("手动重试加载");
      if (likelyMpegTs) {
        loadMpegTs();
      } else if (useDirectHls) {
        loadDirectHls(restartPreviewUrl(streamUrl), "代理 HLS 直连播放");
      } else if (useHlsPreview) {
        loadHlsPreview(restartPreviewUrl(hlsPreviewUrl), "FFmpeg HLS 稳定预览");
      } else {
        video.load();
        updateStartOverlay();
      }
    });
    ffmpegPreview.addEventListener("click", () => {
      appendLog("手动切换 FFmpeg HLS 预览");
      loadHlsPreview(restartPreviewUrl(hlsPreviewUrl), "FFmpeg HLS 稳定预览");
    });
    openPotPlayer.addEventListener("click", () => {
      const targetUrl = rawUrl || streamUrl || playUrl;
      if (!targetUrl) {
        setMessage("当前线路没有可打开的地址。");
        return;
      }

      appendLog("尝试调用 PotPlayer");
      setMessage("正在尝试打开 PotPlayer。如果浏览器弹出确认框，请选择允许。");
      const openedAt = Date.now();
      let leftPage = false;
      const markLeftPage = () => { leftPage = true; };
      window.addEventListener("blur", markLeftPage, { once: true });
      document.addEventListener("visibilitychange", markLeftPage, { once: true });
      window.location.href = "potplayer://" + targetUrl;

      setTimeout(() => {
        window.removeEventListener("blur", markLeftPage);
        document.removeEventListener("visibilitychange", markLeftPage);
        if (!leftPage && Date.now() - openedAt >= 1200) {
          setMessage("如果 PotPlayer 没有打开，说明本机可能未安装或未注册 potplayer:// 协议。请安装 PotPlayer，或点击“打开原始地址”后复制到 PotPlayer 的 Ctrl+U。");
          appendLog("PotPlayer 可能未安装或协议未注册");
        }
      }, 1400);
    });

    window.addEventListener("beforeunload", destroyTsPlayer);
    attachVideoDiagnostics("测试播放器");
    updateStartOverlay();
    setInterval(() => updateStatus(), 1000);

    if (protocolUnsupported) {
      setMessage("浏览器通常不能直接拉取 rtp://、udp://、rtsp://；如无法播放，请复制原始地址到电视端测试。");
    } else if (useDirectHls) {
      loadDirectHls(streamUrl, "代理 HLS 直连播放");
    } else if (likelyMpegTs) {
      loadMpegTs();
    } else if (useHlsPreview) {
      loadHlsPreview(hlsPreviewUrl, "FFmpeg HLS 稳定预览");
    } else {
      video.src = playUrl;
      video.load();
      updateStartOverlay();
      setMessage("已加载浏览器原生播放器，正在尝试自动播放。");
      tryAutoplay("原生播放器已加载");
    }
  </script>
</body>
</html>`;
}
