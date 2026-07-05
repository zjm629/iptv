# Web Source Management Design

## Goal

Allow the VPS user to manage IPTV collection source URLs from the web page instead of editing `config/sources.json` by hand.

## Behavior

- The home page shows a source management section above the channel list.
- Users can add, edit, and delete source rows. Each row has a display name and an M3U URL.
- Clicking save writes the full source list to `config/sources.json`.
- After a successful save, the service immediately refreshes playlists.
- The existing two-hour scheduled refresh remains unchanged.
- The generated playlist URL remains `/playlist.m3u`.

## API

- `GET /api/sources`: returns the current configured sources.
- `PUT /api/sources`: accepts `{ "sources": [{ "name": "...", "url": "https://..." }] }`, validates and saves the list, then triggers refresh.

## Validation

- Empty rows are ignored by the web page before saving.
- API rejects sources without a URL.
- API trims names and URLs.
- If a name is empty, the URL is used as the source display name during refresh.

## Persistence

The source list is still stored in `config/sources.json`, which is already mounted into the Docker container by `docker-compose.yml`.

## Testing

Tests should cover reading sources, saving sources, API validation, refresh after save, and web page markup containing the source editor controls.
