# Park Ministry Automations

This workspace contains the Park Ministry operational automation modules.

Top-level modules:

- `Bot - Buying/`
- `Bot - Listing/`
- `Ops - Sales Tracking/`
- `Ops - Fulfillment Integration/`
- `Shared/`

Support infrastructure:

- `Workspace/`
  - shared bootstrap files like `loadEnv.js`, `index.js`, and `operativePaths.js`
- `BRAIN.md`
  - kept one level above this folder as the shared operational brain

## Project Structure

- `Bot - Buying/`
  - purchasing workflow
- `Bot - Listing/`
  - listing workflow and app assets
- `Ops - Sales Tracking/`
  - sales reconciliation workflow
- `Ops - Fulfillment Integration/`
  - PDF validation and StubHub fulfillment workflow
- `Shared/`
  - shared SmartSuite, StubHub, record, and provider helpers
- `Workspace/`
  - workspace-level bootstrap helpers only
- `Ops - Fulfillment Integration/vendor/`
  - vendored Python dependencies used by PDF extraction

Current status:

- `Bot - Buying` has been revalidated after the workspace reorganization
- `Bot - Buying` now handles branded Way autocomplete suggestions more safely when the real address is still present
- `Bot - Buying` now uses a more tolerant time-picker container fallback for Way check-in / checkout selection
- `Bot - Listing` runner starts and writes outputs correctly from the new module layout
- `ListingApp` remains a self-contained distribution workspace inside `Bot - Listing/app/ListingApp`
- `Ops - Fulfillment Integration` is active for supported StubHub API cases

## Git And Repo Workflow

This module now lives inside the root private repository:

- `https://github.com/alejandrolp08/task-automations`

Operational rule:

- Git commands should normally be run from the workspace root:
  - `/Users/alejandroleiva/Documents/Documentos Trabajo/Task Automations`
- `main` should remain stable
- use a new branch first for medium or large changes to buying, listing, sales, fulfillment, or shared logic

## Run Locally

### Bot - Buying

Recommended:

```bash
npm run buying:live
```

When a row already has a trusted SmartSuite `event_id` and normal live validation did not leave a usable event time:

```bash
npm run buying:live:force-event-id
```

To limit that override to one specific StubHub event id:

```bash
LISTING_FORCE_EVENT_IDS=160123456 npm run buying:live:force-event-id
```

Equivalent direct command:

```bash
BUYING_SOURCE=smartsuite node "Bot - Buying/src/buyingBot/runBuyingBotLive.js"
```

### Bot - Listing

Recommended:

```bash
npm run listing:reachpro
```

Equivalent direct command:

```bash
node "Bot - Listing/src/listingBot/runListingBot.js"
```

Force fallback when SmartSuite already contains manual Event IDs:

```bash
npm run listing:reachpro:force-event-id
```

### Other Utility Scripts

Available package scripts:

- `npm run debug:way:checkout`
- `npm run debug:way:buy-pass`

## SmartSuite Notes

Current production reads use the `Buying` table in SmartSuite.

The project expects the usual SmartSuite credentials in `.env` when running live:

```bash
BUYING_SOURCE=smartsuite
SMARTSUITE_API_TOKEN=your_api_token_here
SMARTSUITE_ACCOUNT_ID=your_workspace_id_here
SMARTSUITE_BUYING_TABLE_ID=your_buying_table_id_here
SMARTSUITE_INVENTORY_TABLE_ID=your_inventory_table_or_app_id_here
STUBHUB_LOOKUP_MODE=live_web
```

Notes:

- `SMARTSUITE_ACCOUNT_ID` is the workspace id from the SmartSuite URL
- `SMARTSUITE_BUYING_TABLE_ID` is optional if you want to override the configured table id
- `SMARTSUITE_INVENTORY_TABLE_ID` is optional if you want to override the configured inventory app/table id used by Sales Tracking and Fulfillment
- `STUBHUB_LOOKUP_MODE` should stay as `live_web` for the current production path

If SmartSuite credentials are missing, review module-specific runtime/data notes inside:

- `Bot - Buying/runtime/`

## Outputs

- `Bot - Buying/runtime/outputs/`
- `Bot - Listing/runtime/outputs/`
- `Ops - Sales Tracking/runtime/outputs/`
- `Ops - Fulfillment Integration/runtime/outputs/`

## Operational Notes

- The `Bot - Buying` should always start from a fresh SmartSuite pull.
- `Bot - Buying` now retries shorter checkout windows for `parking_lot_not_found`, but keeps `checkout_target_mismatch` as a separate selection error.
- `Bot - Buying` now accepts branded Way suggestions when the exact address is still present inside the suggestion text.
- `Bot - Buying` now uses a more tolerant time-picker container fallback before concluding that a target time is missing.
- The `Bot - Listing` should only work from purchased rows that are still `Live = No`.
- The `Bot - Listing` must use the parking `StubHubEventId`, not the main show event id.
- `Event ID` is a critical field for listing accuracy. If missing, the listing flow should try to resolve it before generating the ReachPro draft.
- `ListingApp` is intentionally self-contained for sharing and should not depend on the root workspace at runtime.
- Business rules and edge cases should be maintained in `BRAIN.md`.
