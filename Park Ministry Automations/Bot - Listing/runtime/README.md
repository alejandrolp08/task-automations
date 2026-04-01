Bot - Listing operative workspace

This folder stores the operational files, reference docs, templates, generated outputs, and the shareable desktop app workspace for the `Bot - Listing`.

Main sections:

- `templates/`
  - stores the ReachPro import template received from the migration team
  - the canonical template should live inside `templates/reachpro/`
  - `templates/reachpro/README.md` explains how to store the canonical template reference
- `outputs/`
  - latest generated ReachPro CSV: `outputs/reachpro-bulk-draft-latest.csv`
  - latest JSON run summary: `outputs/listing-bot-last-run.json`
  - archived prior runs: `outputs/old_runs/`
- `ListingApp/`
  - self-contained desktop app workspace for sharing the Bot - Listing with other users
  - includes its own trimmed `src/`, `.env`, `license.json`, packaged app builds, and delivery folders
- `CURRENT_OUTPUT_REVIEW.md`
  - notes from output QA and validation
- `REACHPRO_TEMPLATE_MAPPING.md`
  - column mapping and ReachPro import assumptions

Primary command:

- `npm run listing:reachpro`

Optional fallback command for exceptional, manually validated Event IDs only:

- `LISTING_ALLOW_SMARTSUITE_EVENT_ID_ONLY_FALLBACK=1 LISTING_FORCE_EVENT_IDS=159791332,160282956,160467405 npm run listing:reachpro`

Current bot behavior:

- pulls SmartSuite rows by date range
- filters only rows eligible for listing
- validates or resolves the `parking` StubHub Event ID
- generates the ReachPro CSV in `outputs/`
- writes a detailed JSON summary in `outputs/`
- updates SmartSuite with resolved `Event ID` when missing
- updates `Platform(s) listed on = ReachPro`
- does not upload to ReachPro automatically
- does not mark `Live = Yes` yet

Critical rules:

- the bot must use the `parking` StubHub Event ID, not the main show event ID
- `scheduled_time_not_found` does not mean the event failed validation
- if the `Event ID` is validated and the event status is acceptable, the row can still be listed
- the fallback command is only for edge cases where the SmartSuite Event ID was already manually confirmed
- when fallback env vars are present, the bot still tries normal StubHub live validation first
- the allowlist fallback is used only if live validation fails and the SmartSuite Event ID is included in `LISTING_FORCE_EVENT_IDS`
- fallback is not global: only explicitly allowlisted Event IDs can use it
- in practice, StubHub public search can be inconsistent for some parking events, so a row may validate in one run and fail in another without any SmartSuite change

How Event ID validation works:

- normal mode:
  - tries to validate or discover the parking Event ID from StubHub live web results
  - rejects the main show Event ID if the result does not show strong parking signals
  - accepts rows with `validated` or `scheduled_time_not_found` when the parking Event ID is present
- fallback mode:
  - only applies when `LISTING_ALLOW_SMARTSUITE_EVENT_ID_ONLY_FALLBACK=1`
  - only applies when the SmartSuite Event ID is explicitly included in `LISTING_FORCE_EVENT_IDS`
  - normal validation still runs first
  - if validation succeeds, the normal validated result is used
  - if validation fails, the allowlisted SmartSuite Event ID can still be accepted for listing as a controlled manual override

How to verify which path was used:

- open `outputs/listing-bot-last-run.json`
- rows that validated normally will show `match_method = event_id_then_validate` or `search_then_disambiguate`
- rows accepted only by manual fallback will show `match_method = smartsuite_event_id_only_fallback`

ReachPro template notes:

- `InHandAt` must be sent as date only, for example `05/22/2026`
- `Row` must stay blank
- `ListingNotes` should include only the distance note, normalized to lowercase
- `ExpectedValue` is not exported as raw `Sell Price`
- the CSV now calculates `ExpectedValue` as net payout after marketplace fee
- default marketplace fee is `9%`
- the current builder already follows the active 20-column ReachPro mapping

ListingApp notes:

- `ListingApp/` is the self-contained desktop wrapper for sharing the bot outside the main workflow
- it now includes:
  - copied Bot - Listing source
  - only the shared modules required by Bot - Listing
  - local `.env` and `.env.example`
  - local `license.json`
  - packaged Mac and Windows builds
  - `Deliverables/ListingApp-Mac` for Mac sharing
  - `Deliverables/ListingApp-Windows` for Windows sharing
- `ListingApp/src` should stay lean:
  - keep `listingBot/`, `shared/`, `loadEnv.js`, and `operativePaths.js`
  - avoid copying unrelated `buyingBot`, `operativeScripts`, or other parent-project folders into the shareable app
- the app uses a local license gate:
  - badge shows `Active` while valid
  - badge shows `Renew` after expiration
  - when expired, `Run Bot - Listing` is blocked
- the app advanced section allows:
  - enabling the SmartSuite Event ID fallback mode
  - changing the marketplace fee percent used for `ExpectedValue`
  - saving the marketplace fee percent so it persists between app launches
- current local license window ends on `2026-05-23`
- for sharing, compress the full deliverable folder, not only the `.app` or `.exe`

Notes:

- previous generated outputs are archived automatically before the latest files are overwritten
- `old_runs/` is also pruned automatically; files older than 14 days are removed
- this folder is operational, not the source-of-truth application repo
