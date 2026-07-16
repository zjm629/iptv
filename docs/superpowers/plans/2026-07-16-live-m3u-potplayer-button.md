# Live M3U PotPlayer Button Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add one PotPlayer launch button beside the home page `live.m3u` link.

**Architecture:** The home page already renders playlist links in `src/web.js` and already uses `potplayer://` elsewhere. Reuse that pattern by adding a single button near `live.m3u` and a click handler that builds `window.location.origin + "/live.m3u"`.

**Tech Stack:** Node.js, Express, inline browser JavaScript, Jest, Supertest.

---

### Task 1: Home Page Button

**Files:**
- Modify: `tests/server.test.js`
- Modify: `src/web.js`

- [ ] **Step 1: Write the failing test**

Add assertions to the existing `returns web management page` test in `tests/server.test.js`:

```js
expect(response.text).toContain("id=\"live-m3u-potplayer\"");
expect(response.text).toContain("window.location.origin + \"/live.m3u\"");
expect(response.text).toContain("PotPlayer播放");
expect(response.text).not.toContain("playlist-sources-potplayer");
expect(response.text).not.toContain("live-txt-potplayer");
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
& 'C:/Users/HW/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe' --experimental-vm-modules node_modules/jest/bin/jest.js tests/server.test.js --runInBand -t "returns web management page"
```

Expected: FAIL because `live-m3u-potplayer` is not rendered yet.

- [ ] **Step 3: Add the button and click handler**

In `src/web.js`, place this button immediately after the `live.m3u` link:

```html
<button class="secondary" id="live-m3u-potplayer">PotPlayer播放</button>
```

Add a click handler in the existing home page script:

```js
const liveM3uPotplayer = $("live-m3u-potplayer");
if (liveM3uPotplayer) {
  liveM3uPotplayer.addEventListener("click", () => {
    window.location.href = "potplayer://" + window.location.origin + "/live.m3u";
  });
}
```

- [ ] **Step 4: Run targeted test to verify it passes**

Run the same targeted Jest command. Expected: PASS.

- [ ] **Step 5: Run full suite**

Run:

```powershell
& 'C:/Users/HW/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe' --experimental-vm-modules node_modules/jest/bin/jest.js --runInBand
```

Expected: all tests pass.

- [ ] **Step 6: Commit and push**

```powershell
git add src/web.js tests/server.test.js docs/superpowers/plans/2026-07-16-live-m3u-potplayer-button.md
git commit -m "feat: add PotPlayer button for live m3u"
git push origin main
```
