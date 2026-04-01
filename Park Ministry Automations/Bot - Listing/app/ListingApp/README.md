# ListingApp

This folder is the self-contained distribution workspace for the desktop version of `Bot - Listing`.

Purpose:

- keep the main `Bot - Listing` module unchanged
- maintain a shareable app package with its own wrapper, source copy, env file, license file, templates, docs, and outputs
- let another user run the app on another machine without depending on the parent workspace layout

What is inside:

- `app/`
  - Electron desktop wrapper source
- `src/`
  - app-local source used by the packaged bundle
  - includes only the listing workflow and the internal helpers the app needs
- `.env`
  - local credentials/config for the app workspace
- `.env.example`
  - blank template for setup on another machine
- `license.json`
  - local license/expiration file used to allow or block execution
- `templates/`
  - ReachPro template and branding assets
- `outputs/`
  - generated CSV and JSON outputs
- `dist/mac-arm64/`
  - packaged Mac app build
- `dist/win-unpacked/`
  - packaged Windows app build
- `Deliverables/`
  - exported deliverable folders prepared for handoff/sharing

Runtime behavior:

- the packaged Mac app uses the listing code bundled inside this `ListingApp` workspace
- the packaged Windows app uses the same bundled listing code from this workspace
- the app reads credentials from `ListingApp/.env`
- the app reads the expiration date from `ListingApp/license.json`
- the app saves UI settings in `ListingApp/settings.json`
- the app writes outputs to `ListingApp/outputs`
- the app does not depend on the parent `Park Ministry Automations` workspace at runtime
- the generated ReachPro CSV calculates `ExpectedValue` as net payout after marketplace fee
- default marketplace fee is `9%`, but the app can override it from the advanced section
- saved marketplace fee changes persist between app launches
- this app is intentionally autosufficient and should stay decoupled from the main workspace `Shared/` and `Workspace/` folders

Parent workspace relationship:

- in the main Park Ministry workspace, the source module lives under:
  - `Bot - Listing/`
- `ListingApp` is intentionally separate and self-contained so it can be zipped and shared independently

Source note:

- `ListingApp/src` is intentionally smaller than the parent workspace source tree
- it should include:
  - `src/bots/listingBot/`
  - `src/loadEnv.js`
  - `src/bots/operativePaths.js`
  - `src/shared/`
- it should not carry unrelated Park Ministry modules such as:
  - buying bot sources
  - fulfillment sources
  - sales tracking sources
  - unrelated workspace entrypoints

How to run locally:

1. Open terminal in this folder.
2. Run `npm start` for dev mode.
3. Or open the packaged app in `dist/mac-arm64/`.
4. Enter the date range.
5. Click `Run Bot - Listing`.

How to share it:

- compress the entire `ListingApp` folder, not only the `.app`
- the receiving Mac should extract the whole folder before opening the app
- if credentials should differ, replace `ListingApp/.env` or start from `.env.example`
- if you want to renew access, send an updated `license.json` or a refreshed zip

License policy:

- the app checks `license.json` on startup and before every run
- current trial window ends on `2026-05-23`
- after that date, the app stays visible but `Run Bot - Listing` is blocked until the license is renewed

Platform note:

- the packaged app currently targets Mac Apple Silicon `arm64`
- we can generate additional Mac `x64` or universal builds later if needed
