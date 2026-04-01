BuyingBot operative workspace

This folder stores the operational files used by the Bot - Buying.

Current live workflow coverage includes:

- SmartSuite live intake for pending buy rows
- StubHub live-web event validation and event-time resolution
- Way checkout execution for standard and airport parking flows
- checkout recovery when Way returns to home after `Proceed`
- direct final-submit handling for airport `Way+` membership flows
- membership preflight and retry logic when `Way+` blocks the first final `Checkout`
- membership-state logging in live runs so blocked airport checkouts are diagnosable from terminal output
- reservation capture from `order-confirmed` and from `Orders` when needed

Main sections:

- `data/`
  - `sampleBuying.json`
    - fallback local input used when SmartSuite live intake is not being used
  - `manualEventTimeResolutions.json`
    - manual event-time fallback data kept for exceptional cases
- `outputs/`
  - latest JSON outputs such as:
    - `result.json`
    - `buying-bot-live-last-run.json`
    - `buy-pass-last-run.json`
  - `screenshots/`
    - important failure screenshots
    - optional debug and trace captures
  - persistent Way browser session data
  - maintenance state

Important current output paths:

- `outputs/screenshots/`
  - stored troubleshooting screenshots and traces for failed or notable runs
- `outputs/sessions/way/`
  - persistent Way browser session used by live checkout runs

Notes:

- this folder is operational, not source code
- generated files should stay here rather than in the project root
- screenshots that are not part of the active flow should be removed when they become stale
Bot - Buying operative workspace

This folder stores the non-code working files for the Bot - Buying.

## Purpose

Keep runtime and operator files outside the source folder.

## Current structure

- `data/`
  - sample records
  - manual event-time resolution helpers
- `outputs/`
  - latest run JSON
  - result files
  - screenshots
  - browser sessions

## Important rule

- source code lives in `Bot - Buying/src/buyingBot/`
- runtime files live here
- do not mix generated outputs into source folders
