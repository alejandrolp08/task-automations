ReachPro template folder

Use this folder to keep the canonical ReachPro import template used as the reference for the `Bot - Listing`.

Recommended filename:

- `reachpro-bulk-template.csv`

Current note:

- keep the original or copied working ReachPro template inside this folder so there is only one canonical template location

Template rules already validated:

- `StubHubEventId` is required for listing
- `VendorOrderId` maps to `Reservation ID`
- `TicketCount` is `1` per row
- `CurrencyCode` is `USD`
- `InHandAt` must be date only, for example `05/22/2026`
- `Row` should be blank
- `AutoBroadcastCreatedListing` is currently `FALSE`

Operational notes:

- keep the original template unchanged as the source-of-truth reference
- the `Bot - Listing` generates outputs in `Bot - Listing/runtime/outputs/`
- previous generated outputs are archived automatically into `Bot - Listing/runtime/outputs/old_runs/`
- `StubHubEventId` must always be the parking event id, never the main show event id
- if a manually confirmed SmartSuite Event ID must be used for an edge case, the Bot - Listing supports an allowlist fallback via:
  - `LISTING_ALLOW_SMARTSUITE_EVENT_ID_ONLY_FALLBACK=1`
  - `LISTING_FORCE_EVENT_IDS=<comma-separated ids>`
- even with fallback enabled, the bot still attempts normal live validation first
