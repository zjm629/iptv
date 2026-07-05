# IPTV VPS M3U Manager Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Docker Compose IPTV M3U manager that runs on a VPS, refreshes configured remote playlists every two hours, merges duplicate channels, and exposes a web page plus generated M3U playlist.

**Architecture:** Use one Node.js Express service. Core playlist parsing, channel normalization, merging, and playlist generation live in testable modules under `src/`; the server wires these modules to scheduled refreshes and HTTP endpoints.

**Tech Stack:** Node.js 20, Express, node-cron, Jest, Supertest, Docker Compose.

---

## File Structure

- `package.json`: npm scripts and runtime/test dependencies.
- `src/m3u.js`: parse M3U text into channel entries and generate M3U output.
- `src/normalize.js`: convert channel display names into stable merge keys.
- `src/store.js`: load source config, fetch playlists, merge channels, persist/read cache.
- `src/server.js`: Express app, scheduled refresh, API routes, playlist route, and web page route.
- `src/web.js`: built-in HTML/CSS/JS management page.
- `config/sources.example.json`: sample source configuration for VPS deployment.
- `config/sources.json`: default local/VPS source configuration using the user-provided URL.
- `data/.gitkeep`: keep cache directory in git.
- `tests/m3u.test.js`: parser and playlist generation tests.
- `tests/normalize.test.js`: duplicate channel key tests.
- `tests/store.test.js`: merge behavior tests.
- `tests/server.test.js`: endpoint smoke tests.
- `Dockerfile`: production container image.
- `docker-compose.yml`: default VPS deployment on port `3080`.
- `.dockerignore`: exclude local-only files from image builds.
- `README.md`: VPS deployment and usage instructions in Chinese.

## Tasks

### Task 1: Project Skeleton And Dependencies

**Files:**
- Create: `package.json`
- Create: `.gitignore`
- Create: `.dockerignore`
- Create: `config/sources.example.json`
- Create: `config/sources.json`
- Create: `data/.gitkeep`

- [ ] **Step 1: Add package metadata and scripts**

Create `package.json` with:

```json
{
  "name": "iptv-vps-m3u-manager",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "start": "node src/server.js",
    "test": "node --experimental-vm-modules node_modules/jest/bin/jest.js --runInBand"
  },
  "dependencies": {
    "express": "^4.19.2",
    "node-cron": "^3.0.3"
  },
  "devDependencies": {
    "jest": "^29.7.0",
    "supertest": "^7.0.0"
  }
}
```

- [ ] **Step 2: Add ignores and default config**

Create `.gitignore`:

```gitignore
node_modules/
data/cache.json
npm-debug.log*
```

Create `.dockerignore`:

```dockerignore
node_modules
data/cache.json
.git
docs
tests
npm-debug.log*
```

Create `config/sources.example.json` and `config/sources.json`:

```json
[
  {
    "name": "Chongqing Source",
    "url": "http://iptv.cqshushu.com/index.php?s=nwleGqYlX1QGiI3Av2MM8A&t=multicast&channels=1&format=m3u"
  }
]
```

Create an empty `data/.gitkeep`.

- [ ] **Step 3: Install dependencies**

Run: `npm install`

Expected: `package-lock.json` is created and npm exits successfully.

### Task 2: M3U Parsing And Generation

**Files:**
- Create: `src/m3u.js`
- Create: `tests/m3u.test.js`

- [ ] **Step 1: Write parser and generator tests**

Create `tests/m3u.test.js` with tests that parse two `#EXTINF` entries, extract `tvg-logo` and `group-title`, skip invalid entries without URLs, and generate a playlist with `/play/<id>` URLs.

- [ ] **Step 2: Run failing tests**

Run: `npm test -- tests/m3u.test.js`

Expected: FAIL because `src/m3u.js` does not exist yet.

- [ ] **Step 3: Implement `src/m3u.js`**

Export:

```js
export function parseM3u(text, sourceName) {}
export function generatePlaylist(channels, baseUrl) {}
```

Implementation requirements:

- Pair each `#EXTINF` line with the next non-comment URL line.
- Parse attributes using quoted values, including `tvg-logo` and `group-title`.
- Use the display name after the comma as the channel name.
- Skip entries without a display name or stream URL.
- Generate one `#EXTINF` entry per merged channel using `/play/<channel.id>`.

- [ ] **Step 4: Run tests**

Run: `npm test -- tests/m3u.test.js`

Expected: PASS.

### Task 3: Channel Normalization

**Files:**
- Create: `src/normalize.js`
- Create: `tests/normalize.test.js`

- [ ] **Step 1: Write normalization tests**

Create tests proving all of these produce the same key:

```text
CCTV1
CCTV-1
CCTV 1
CCTV-1 综合
cctv1综合
```

Also test that `湖南卫视` and `CCTV1` produce different keys.

- [ ] **Step 2: Run failing tests**

Run: `npm test -- tests/normalize.test.js`

Expected: FAIL because `src/normalize.js` does not exist yet.

- [ ] **Step 3: Implement `normalizeChannelName(name)`**

Implementation requirements:

- Lowercase names.
- Normalize full-width forms with `String.prototype.normalize("NFKC")`.
- Remove bracketed text.
- Remove separators: spaces, hyphens, underscores, dots, slashes, vertical bars, Chinese punctuation.
- Normalize CCTV suffix words such as `综合`, `高清`, `hd`, `频道`.
- Return a stable non-empty key.

- [ ] **Step 4: Run tests**

Run: `npm test -- tests/normalize.test.js`

Expected: PASS.

### Task 4: Store, Refresh, Merge, And Cache

**Files:**
- Create: `src/store.js`
- Create: `tests/store.test.js`

- [ ] **Step 1: Write store tests**

Create tests that:

- Merge duplicate channel names into one channel.
- Preserve multiple source lines under `channel.sources`.
- Keep cache data when a refresh fetch fails after a prior success.
- Report per-source success and failure status.

- [ ] **Step 2: Run failing tests**

Run: `npm test -- tests/store.test.js`

Expected: FAIL because `src/store.js` does not exist yet.

- [ ] **Step 3: Implement store module**

Export:

```js
export function createStore(options) {}
```

The returned object exposes:

```js
{
  refresh,
  getChannels,
  getChannel,
  getStatus
}
```

Implementation requirements:

- Read sources from `configPath`.
- Fetch with global `fetch`.
- Parse with `parseM3u`.
- Merge by `normalizeChannelName`.
- Persist successful cache to `cachePath`.
- Load existing cache on startup when present.
- Serialize refresh calls with an internal `refreshPromise`.

- [ ] **Step 4: Run tests**

Run: `npm test -- tests/store.test.js`

Expected: PASS.

### Task 5: HTTP Server And Web Page

**Files:**
- Create: `src/server.js`
- Create: `src/web.js`
- Create: `tests/server.test.js`

- [ ] **Step 1: Write endpoint tests**

Create tests covering:

- `GET /api/channels` returns merged channels.
- `GET /playlist.m3u` returns `application/x-mpegURL`.
- `GET /play/:channelId?source=1` redirects to the requested stream.
- `POST /api/refresh` triggers refresh and returns status.
- `GET /` returns HTML.

- [ ] **Step 2: Run failing tests**

Run: `npm test -- tests/server.test.js`

Expected: FAIL because `src/server.js` does not exist yet.

- [ ] **Step 3: Implement server app factory**

Export:

```js
export function createApp(store, options = {}) {}
export async function startServer() {}
```

Implementation requirements:

- Use Express.
- Trust proxy so generated URLs work behind a VPS reverse proxy.
- Mount the routes from the design.
- Generate playlist base URL from the request host/protocol.
- Start scheduled refresh every two hours using `node-cron`.
- Listen on `PORT`, defaulting to `3080`.

- [ ] **Step 4: Implement `src/web.js`**

Export:

```js
export function renderHomePage() {}
```

The page should fetch `/api/status` and `/api/channels`, show source status, search channels, expand alternate lines, copy playlist URL, and call `POST /api/refresh`.

- [ ] **Step 5: Run tests**

Run: `npm test -- tests/server.test.js`

Expected: PASS.

### Task 6: Docker And VPS Documentation

**Files:**
- Create: `Dockerfile`
- Create: `docker-compose.yml`
- Create: `README.md`

- [ ] **Step 1: Add Docker files**

Create `Dockerfile`:

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
ENV NODE_ENV=production
ENV PORT=3080
EXPOSE 3080
CMD ["npm", "start"]
```

Create `docker-compose.yml`:

```yaml
services:
  iptv-manager:
    build: .
    container_name: iptv-manager
    restart: unless-stopped
    ports:
      - "3080:3080"
    environment:
      PORT: "3080"
      SOURCES_PATH: "/app/config/sources.json"
      CACHE_PATH: "/app/data/cache.json"
      REFRESH_CRON: "0 */2 * * *"
    volumes:
      - ./config:/app/config
      - ./data:/app/data
```

- [ ] **Step 2: Add Chinese README**

Document:

- How to edit `config/sources.json`.
- How to upload/clone to VPS.
- How to run `docker compose up -d --build`.
- How to visit `http://VPS-IP:3080`.
- How to use `http://VPS-IP:3080/playlist.m3u` in an IPTV player.
- How to check logs with `docker compose logs -f`.

- [ ] **Step 3: Run full verification**

Run:

```bash
npm test
docker compose config
docker compose build
```

Expected: tests pass, compose config validates, image builds.

## Self-Review

- Spec coverage: deployment, source config, duplicate merging, two-hour refresh, cache behavior, API, playlist, web page, and Docker are covered by the tasks above.
- Placeholder scan: no `TBD`, `TODO`, or unspecified implementation steps remain.
- Type consistency: module exports and route names are consistent across tasks.
