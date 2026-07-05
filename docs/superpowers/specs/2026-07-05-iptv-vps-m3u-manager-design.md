# IPTV VPS M3U Manager Design

## Goal

Build a Docker Compose deployable IPTV M3U manager for a VPS. The service accepts one or more remote M3U URLs, refreshes them automatically every two hours, merges duplicate channels into one visible channel, preserves all available stream sources for that channel, and exposes both a web management page and a generated M3U playlist.

## Deployment

The project will run as a single container through `docker compose`.

- Default host port: `3080`
- Persistent configuration: `config/sources.json`
- Persistent generated cache/data: `data/`
- VPS command: `docker compose up -d`

The service is designed to be copied or cloned onto a VPS and run there. Local execution is only for development and verification.

## User-Facing Endpoints

- `/`: Web management page showing update status, source URLs, merged channels, and alternate lines for each channel.
- `/playlist.m3u`: Generated playlist with one entry per merged channel. Each entry points to the selected/default line.
- `/api/channels`: JSON list of merged channels and their available sources.
- `/api/status`: JSON update status and source statistics.
- `/play/:channelId`: Redirects to the selected stream source for a channel. The optional `source` query parameter chooses a specific line index.
- `/api/refresh`: Manual refresh endpoint for the web page.

## M3U Source Configuration

Sources are stored in `config/sources.json`:

```json
[
  {
    "name": "Chongqing Source",
    "url": "http://iptv.cqshushu.com/index.php?s=nwleGqYlX1QGiI3Av2MM8A&t=multicast&channels=1&format=m3u"
  }
]
```

Multiple sources can be added to the array. The service reads this file at startup and on each refresh.

## Channel Merge Rules

Each M3U item is parsed into a channel name, optional logo/group metadata, and stream URL. Channels are merged by a normalized key derived from the display name:

- Convert to lowercase.
- Convert full-width punctuation and whitespace variants to simple ASCII where practical.
- Remove common separators such as spaces, hyphens, underscores, dots, Chinese brackets, and parentheses.
- Normalize common CCTV forms so names like `CCTV1`, `CCTV-1`, `CCTV 1`, and `CCTV-1 综合` merge together.
- Keep the best readable display name from the first matching item.

The first source for a merged channel is the default. All additional stream URLs remain available as alternate lines.

## Refresh Behavior

The service refreshes immediately on startup and every two hours afterward. A refresh fetches all configured source URLs, parses successful responses, merges channels, and writes the generated data to `data/cache.json`. If a later refresh fails, the service keeps serving the last successful cache when available.

## Web Page Behavior

The web page is a simple built-in HTML interface, not a separate frontend build. It shows:

- Last update time and next automatic refresh interval.
- Per-source success/failure counts.
- Searchable merged channel list.
- Alternate source lines for each channel.
- Copyable generated playlist URL.
- Manual refresh button.

## Error Handling

- Bad or unreachable source URLs are recorded in status output but do not stop the service.
- Invalid M3U entries are skipped.
- If no cache exists and all sources fail, API and playlist endpoints return a clear error.
- Refreshes are serialized so manual and scheduled refreshes do not overlap.

## Testing And Verification

Verification should cover:

- M3U parsing with common `#EXTINF` formats.
- Channel normalization and CCTV duplicate merging.
- Playlist generation with one item per merged channel.
- Docker Compose build and container startup on port `3080`.
- API and web endpoints returning useful output after refresh.
