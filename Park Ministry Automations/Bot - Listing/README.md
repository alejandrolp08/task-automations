# Bot - Listing

This module owns ReachPro listing preparation for purchased inventory and the shareable desktop app used for listing operations.

Structure:

- `src/listingBot/`
  - main listing workflow, candidate fetch, ReachPro CSV draft generation, SmartSuite write-back
- `app/ListingApp/`
  - self-contained desktop app workspace for Mac/Windows sharing
- `runtime/`
  - templates, outputs, archived runs, and listing-specific operative notes

Shared dependencies:

- `../../../Shared/`
  - SmartSuite helpers, record normalization, StubHub event-time resolution
- `../../../Workspace/`
  - env loading and operative path resolution for the main workspace runner

Notes:

- `src/listingBot/README.md`
- `app/ListingApp/README.md`

Current operational notes:

- the main `Bot - Listing` runner is wired to the shared workspace and current module layout
- the desktop `ListingApp` remains intentionally self-contained for sharing to other Macs or Windows machines
- `ListingApp` should not be treated as a runtime dependency of the main workspace runner
