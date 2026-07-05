# Web Source Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add web-based M3U source management so the user can configure collection URLs from the browser.

**Architecture:** Extend `src/store.js` with source read/write methods, expose them through Express routes in `src/server.js`, and update the built-in `src/web.js` page to edit sources. Existing refresh and playlist generation remain unchanged.

**Tech Stack:** Node.js 20, Express, Jest, Supertest.

---

## Tasks

### Task 1: Store Source Read/Write

**Files:**
- Modify: `src/store.js`
- Modify: `tests/store.test.js`

- [ ] Add tests for `getSources()` and `saveSources()`.
- [ ] Verify tests fail because methods do not exist.
- [ ] Implement trimming, validation, JSON persistence, and source reload behavior.
- [ ] Verify store tests pass.

### Task 2: API Endpoints

**Files:**
- Modify: `src/server.js`
- Modify: `tests/server.test.js`

- [ ] Add tests for `GET /api/sources`, `PUT /api/sources`, invalid source payloads, and refresh after save.
- [ ] Verify tests fail because routes do not exist.
- [ ] Implement routes using store methods.
- [ ] Verify server tests pass.

### Task 3: Web Page And Documentation

**Files:**
- Modify: `src/web.js`
- Modify: `tests/server.test.js`
- Modify: `README.md`

- [ ] Add a test that the home page contains source editor controls.
- [ ] Update the web page to load, add, delete, and save source rows.
- [ ] Update README with browser-based source management instructions.
- [ ] Run all tests.

## Self-Review

- Spec coverage: source editing, persistence, immediate refresh, scheduled refresh preservation, API validation, and docs are covered.
- Placeholder scan: no incomplete implementation steps remain.
- Type consistency: store methods and route names match across tasks.
