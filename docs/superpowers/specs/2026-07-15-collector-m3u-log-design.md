# Collector M3U Log Design

## Goal

Make the collector log clearly distinguish the channel-list page from the final M3U interface URL.

## Behavior

- Keep the existing channel-list log and its final browser URL.
- When an event contains `m3uUrl`, append `M3U 实际地址` and the complete URL.
- If Chromium clicks the channel-list link but lands on the base index page, report that as a redirect error instead of a successful channel-list load.
- Do not change source validation, retry counts, or collection ordering.

## Testing

- Verify the collector page renderer includes `event.m3uUrl` and the `M3U 实际地址` label.
- Verify all existing collector and playlist tests remain green.
