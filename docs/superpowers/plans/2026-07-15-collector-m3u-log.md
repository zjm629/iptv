# Collector M3U Log Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Display the complete extracted M3U URL in collector logs and identify channel-list redirects to the source homepage.

**Architecture:** Reuse the existing `m3uUrl` progress-event field in the collector frontend. Validate the Chromium channel-list destination before returning its HTML so homepage redirects are reported accurately.

**Tech Stack:** Node.js, Express, browser JavaScript, Jest

---

### Task 1: Display the final M3U URL

**Files:**
- Modify: `src/web.js`
- Test: `tests/server.test.js`

- [ ] **Step 1: Write the failing page test**

Add assertions to the collector-page test:

```js
expect(response.text).toContain("event.m3uUrl");
expect(response.text).toContain("M3U 实际地址");
```

- [ ] **Step 2: Run the focused test**

Run:

```powershell
node --experimental-vm-modules node_modules/jest/bin/jest.js --runInBand tests/server.test.js -t "returns collector page"
```

Expected: FAIL because the collector renderer does not display `m3uUrl`.

- [ ] **Step 3: Append the escaped M3U URL**

In the progress-log renderer, append:

```js
(event.m3uUrl ? "；M3U 实际地址 " + escapeHtml(event.m3uUrl) : "")
```

- [ ] **Step 4: Run the focused test**

Expected: PASS.

### Task 2: Identify channel-list homepage redirects

**Files:**
- Modify: `src/auto-source.js`
- Test: `tests/auto-source.test.js`

- [ ] **Step 1: Write a failing redirect test**

Add a browser-flow test where the detail page is correct but the channel-list click returns the base index URL. Assert that no `channelListHtml` is accepted and a `source:channel-list-redirect-home` progress event is emitted.

- [ ] **Step 2: Run the focused test**

Expected: FAIL because the current browser flow accepts the homepage HTML.

- [ ] **Step 3: Validate the clicked destination**

Compare the clicked page token with the expected channel-list token. When the final URL has no matching `s` token, report `source:channel-list-redirect-home` and return only the detail-page result.

- [ ] **Step 4: Run focused and full tests**

Run the two focused tests, then the complete Jest suite. Expected: all tests pass.

### Task 3: Commit and push

**Files:**
- Modify: `src/web.js`
- Modify: `src/auto-source.js`
- Modify: `tests/server.test.js`
- Modify: `tests/auto-source.test.js`
- Add: design and plan documents

- [ ] **Step 1: Check the diff**

Run `git diff --check`.

- [ ] **Step 2: Commit**

```powershell
git add src/web.js src/auto-source.js tests/server.test.js tests/auto-source.test.js docs/superpowers
git commit -m "fix: clarify collector m3u progress"
```

- [ ] **Step 3: Push**

Run `git push origin main`.
