Bot - Listing operative workspace

This folder stores the operational files, reference docs, templates, and generated outputs for the `Bot - Listing`.

Main sections:

- `templates/`
  - stores the ReachPro import template received from the migration team
  - the canonical template should live inside `templates/reachpro/`
  - `templates/reachpro/README.md` explains how to store the canonical template reference
- `outputs/`
  - latest generated ReachPro CSV: `outputs/reachpro-bulk-draft-latest.csv`
  - latest JSON run summary: `outputs/listing-bot-last-run.json`
  - archived prior runs: `outputs/old_runs/`
- `CURRENT_OUTPUT_REVIEW.md`
  - notes from output QA and validation
- `REACHPRO_TEMPLATE_MAPPING.md`
  - column mapping and ReachPro import assumptions

Primary command:

- `npm run listing:reachpro`

Optional fallback command for exceptional, manually validated Event IDs only:

- `LISTING_ALLOW_SMARTSUITE_EVENT_ID_ONLY_FALLBACK=1 LISTING_FORCE_EVENT_IDS=159791332,160282956,160467405 npm run listing:reachpro`

Current behavior:

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
- the current builder already follows the active 20-column ReachPro mapping

Notes:

- this folder is operational, not source code
- previous generated outputs are archived automatically before the latest files are overwritten
