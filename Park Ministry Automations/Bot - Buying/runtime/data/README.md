BuyingBot data files

This folder contains small operational data files used by the Bot - Buying.

Files:

- `sampleBuying.json`
  - fallback sample records for local or offline testing
- `manualEventTimeResolutions.json`
  - manually curated event-time overrides or fallback resolutions when needed

Usage notes:

- live event-time resolution now prefers StubHub live-web matches first
- manual resolutions remain the fallback for exceptional cases where StubHub does not expose a reliable event time
- general StubHub event pages can now be valid event-time sources when parking-specific pages are not the best match

These are not generated outputs.
