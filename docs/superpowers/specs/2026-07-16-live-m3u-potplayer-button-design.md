# Live M3U PotPlayer Button Design

## Goal

Add one PotPlayer launch button beside the existing `live.m3u` link on the
home page.

## Behavior

- Keep the existing `live.m3u` download link unchanged.
- Add a `PotPlayer播放` button immediately beside that link.
- Build the playlist URL from the current browser origin plus `/live.m3u`,
  so custom domains, IP addresses, HTTPS, and non-default ports continue to
  work.
- Launch the playlist through the existing `potplayer://` protocol pattern.
- Do not add buttons to `playlist.m3u`, `playlist-sources.m3u`, or `live.txt`.
- Do not change playlist generation or server routes.

## Error Handling

The browser controls whether a registered external protocol can open.
Existing application behavior for an unavailable `potplayer://` handler is
unchanged.

## Testing

- Verify the home page contains exactly one dedicated `live.m3u` PotPlayer
  button.
- Verify its script builds the target from `window.location.origin` and
  `/live.m3u`.
- Verify the other playlist links remain unchanged.
- Run the full Jest test suite.
