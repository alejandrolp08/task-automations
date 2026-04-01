# Task Automations Brain

This document is the central operations brain for Park Ministry parking pass automations.

Its purpose is to store the business logic, provider workflows, SmartSuite structure, and decision rules that power current and future automations.

It should be updated continuously as new providers, edge cases, and workflow steps are discovered.

## Purpose

- Preserve the real operating knowledge behind parking pass buying
- Centralize decision rules that are currently manual
- Give future prompts and automations a stable source of truth
- Support future integrations with SmartSuite, n8n, and provider websites

## Bot Landscape

This brain is broader than the `Buying Bot`.

It should accumulate business logic for:

- `Buying Bot`
- `Listing Bot`
- future pre-purchase bots
- future post-purchase bots
- inventory or listing bots
- any other operational automations built on top of the same business process

So:

- `BRAIN.md` is the shared business brain across all bots
- each bot can have its own code folder and execution flow

## Project Structure

The Park Ministry workspace is now organized by module.

Current top-level structure inside `Park Ministry Automations/`:

- `Bot - Buying/`
- `Bot - Listing/`
- `Ops - Sales Tracking/`
- `Ops - Fulfillment Integration/`
- `Shared/`
- `Workspace/`

Additional shared live project at the workspace root:

- `Park Ministry Live/`

Supporting files at the workspace root:

- `package.json`
- `package-lock.json`
- `.env`

Meaning:

- each module owns its own source and runtime files
- `Shared/` contains reusable business logic
- `Workspace/` contains workspace bootstrap helpers such as:
  - `loadEnv.js`
  - `index.js`
  - `operativePaths.js`

Important rule:

- module-specific outputs, templates, screenshots, sessions, and archives should stay inside each module runtime folder
- reusable business logic belongs in `Shared/`
- workspace wiring belongs in `Workspace/`
- avoid mixing generated outputs into the root of the repository

### Buying Bot Definition

`Buying Bot` means the complete purchase workflow as one coordinated process.

It is the full chain:

1. pull fresh pending buy orders from SmartSuite
2. filter valid orders for the operator-selected date range
3. resolve event times for those orders
4. execute checkout by provider

Important operating rule:

- every run of the buying bot must start from a fresh SmartSuite pull
- do not trust stale candidate lists from prior runs
- this protects against buying passes that another person already covered

Operational phrase to standardize:

- `run buying bot`

Meaning:

- execute the full intake -> event-time -> checkout chain using the current SmartSuite state
- and later any future substeps added to the buying workflow

Current operator entrypoint:

- normal operator commands should be run from the workspace root:
  - `/Users/alejandroleiva/Documents/Documentos Trabajo/Task Automations`
- preferred root commands:
  - `npm run park:buying:live`
  - `npm run park:buying:live:force-event-id`
  - `npm run park:listing:reachpro`
  - `npm run park:sales:track`
  - `npm run park:fulfillment:run`
  - `FULFILLMENT_AUTOMATION_LIMIT=25 npm run park:fulfillment:limited`

### Listing Bot Definition

`Listing Bot` means the post-purchase listing-preparation workflow.

Current V1 definition:

1. pull fresh SmartSuite rows in an operator-selected date range
2. keep only purchased rows that are still not live
3. confirm each row is listing-ready
4. validate or resolve `Event ID`
5. generate a ReachPro bulk-listing draft
6. update selected SmartSuite fields for the rows included in that draft

Current V1 intentionally stops before:

- bulk upload into ReachPro
- changing `Live` from `No` to `Yes`

Why:

- the operator still wants to manually upload the final file
- the operator still wants to manually trigger the final `Live` update in SmartSuite

## Current Scope

Current project stage:

- local Node.js decision engine
- live SmartSuite API intake is active
- live StubHub public-web event validation is active
- live `way.com` browser checkout automation is active
- ReachPro listing draft generation is active as a V1 workflow
- sales tracking reconciliation is active as an operational workflow
- StubHub fulfillment integration is active for supported API cases
- local sample data still exists only as a development fallback

Recent structural and runtime confirmations:

- `Bot - Buying`, `Bot - Listing`, `Ops - Sales Tracking`, and `Ops - Fulfillment Integration` now run from the reorganized module structure
- `Park Ministry Live/` is now the active source of truth for fulfillment and subtree publishing
- `ListingApp` remains intentionally self-contained inside `Bot - Listing/app/ListingApp`
- `Shared/` continues to hold reusable business logic used by both buying and listing flows
- `Workspace/` continues to hold only workspace bootstrap and runtime-path helpers
- `Task Automations/package.json` is now the main operator launch surface through `park:*` scripts
- root `park:fulfillment:*` commands now point to `Park Ministry Live/`
- the workspace is now tracked in the private GitHub repository:
  - `https://github.com/alejandrolp08/task-automations`

## Git Workflow

Current source-control rule:

- the root Git repository is `Task Automations/`
- normal Git work should start from:
  - `/Users/alejandroleiva/Documents/Documentos Trabajo/Task Automations`

Current branch policy:

- `main` is the stable branch
- medium or large changes to bots, scripts, shared logic, or workflows should start from a new branch
- very small documentation-only updates may still go directly to `main`

Standard branch workflow:

```bash
git checkout -b improve/buying-bot
git add .
git commit -m "Describe the change"
git push -u origin improve/buying-bot
```

Standard direct workflow on `main`:

```bash
git add .
git commit -m "Describe the change"
git push
```

Operational rule:

- `.env` files remain local-only and must not be committed
- `.env.example` files should be maintained as copy-ready templates for future machines and VPS setup

Current priority provider:

- `way.com`

### Buying Event ID Override

There is now an explicit operator path for cases where SmartSuite already has a trusted StubHub `event_id` but the normal live validation flow does not leave a usable event time.

Operational commands:

- normal Buying run:
  - `npm run park:buying:live`
- Event ID override run:
  - `npm run park:buying:live:force-event-id`
- Event ID override for one specific event id:
  - `LISTING_FORCE_EVENT_IDS=160123456 npm run park:buying:live:force-event-id`

Use this only when:

- the SmartSuite `event_id` is trusted
- normal live validation did not leave a usable event time
- the operator intentionally wants the bot to rely on that `event_id`

## SmartSuite Structure

### Solution and App

- Solution ID: `6904e7fb69384c956ff7afc7`
- Application ID: `6904e82ac51862fbb5108850`
- Buying table ID: `6904e84a27b2fb66b110892e`

### Buying Sheet Field IDs

- `Event Date` -> `sbfd3ad917`
- `Event Time` -> `s171db70d9`
- `Provider` -> `se0faafd98`
- `Performer Name` -> `s8ca99e8cd`
- `Venue Name` -> `sded73199c`
- `Parking Location` -> `s9e0097295`
- `Buy Cost` -> `s73d1f14c7`
- `Sell Price` -> `s376ebbc97`
- `Lookup - Parking Location ID #` -> `s74aed3b66`
- `City & State` -> `s914a271f4`
- `Reservation URL` -> `s884fdb736`
- `Reservation ID` -> `sdb959ef08`
- `Platform(s) listed on` -> `s6539d6d21`
- `Live` -> `sf2896747f`
- `Event ID` -> `s1ded883e9`

### Buying Sheet Choice Values

Current known `Platform(s) listed on` values:

- `ReachPro` -> `6wC94`
- `Stubhub` -> `vXV24`
- `Website Park Ministry` -> `a8CrP`
- `Ticketvault` -> `lbz8M`

### Buying Export Column Names

These are the column names confirmed from the exported `Buying` sheet:

- `Record ID buying Sheet`
- `Event Date`
- `Event Time`
- `Provider`
- `Reservation URL`
- `Reservation ID`
- `Performer Name`
- `Venue Name`
- `Parking Location`
- `Buy Cost`
- `Sell Price`
- `City & State`
- `Platform(s) listed on`
- `Live`
- `Buying Comment`
- `Event ID`
- `Open Comments`
- `Created by`

## Buying Workflow

Each row in the `Buying` sheet represents a parking pass buying opportunity.

In practice:

- one row usually acts like one buy order
- there may be multiple rows for the same event
- normal volume is usually up to 12 rows per run
- some events may require more
- availability may change while buying, so not all requested passes may be purchasable

This means future automations may need to support:

- row-by-row execution
- partial fulfillment
- retry logic
- replacement parking locations when the original one is unavailable

### Way Search And Checkout Lessons

Recent production debugging confirmed two durable Way behaviors:

- Way may prepend hotel or business branding to an otherwise correct address suggestion
- Way time picker DOM structure is not stable enough to rely on a single strict container geometry

Operational rule now captured in code:

- Buying should accept branded autocomplete suggestions when the exact primary address and street number are still present
- Buying should use a more tolerant time-picker container fallback before concluding that a target time is missing

Recent isolated re-tests:

- `Netflix is a Joke`
  - now passes `home -> results -> checkout`
- `Romeo Santos`
  - now passes `home -> results -> checkout`
- `Puscifer`
  - now passes `home -> results`
  - current blocker is genuine `Soldout`, not a picker or autocomplete bug

## Listing Workflow

Each row in the `Buying` sheet can later become a listing candidate once the pass is purchased.

Current listing intake logic should use only rows that satisfy:

- selected date range
- `Live = No`
- `Reservation ID` is present
- `Reservation URL` is present
- `Provider` is present
- `Performer Name` is present
- `Venue Name` is present
- `Parking Location` is present
- `Parking Location ID` is present
- `Buy Cost` is present
- `Sell Price` is present
- `Platform(s) listed on` is empty

Current V1 listing workflow:

1. pull listing-ready rows from SmartSuite
2. validate existing `Event ID` if present
3. if `Event ID` is missing, try to resolve it from StubHub
4. include only rows with a usable event mapping in the ReachPro draft
5. write back to SmartSuite:
   - `Event ID` if it was newly resolved
   - `Platform(s) listed on = ReachPro` if the row was included in the generated draft

Current V1 operator flow after the bot runs:

1. review the generated ReachPro draft file
2. upload it manually into ReachPro
3. manually update `Live` from `No` to `Yes` in SmartSuite

Important operational note:

- the final `Live` update should remain manual for now
- this is intentionally preserved because downstream inventory automation is sensitive to real SmartSuite record updates

### ReachPro Template Rules

Current V1 listing output is now based on the active ReachPro template mapping, not the original generic draft.

Current mapped columns include:

- `VendorOrderId` -> `Reservation ID`
- `VendorName` -> fixed `Default Vendor`
- `VendorEmailAddress` -> fixed `null@null.com`
- `PurchaseDate` -> generated at run time
- `DeliveryType` -> fixed `PDF`
- `TicketCount` -> fixed `1`
- `CurrencyCode` -> fixed `USD`
- `InHandAt` -> date only, one day before event
- `Section` -> `Parking Location`
- `Row` -> blank
- `SeatFrom` -> blank
- `SeatTo` -> blank
- `StubHubEventId` -> validated parking event id
- `UnitCost` -> `Buy Cost`
- `FaceValueCost` -> blank
- `ExpectedValue` -> `Sell Price`
- `TaxPaid` -> blank
- `AutoBroadcastCreatedListing` -> fixed `FALSE`
- `ListingNotes` -> normalized distance note extracted from parking location
- `PrivateNotes` -> `Reservation URL`

Critical rule:

- the listing bot must use the parking `StubHubEventId`, not the main show event id

## Base Eligibility Rules

Current manual filtering logic before buying:

- date range is confirmed manually by the operator
- rows with `Live = Yes` should not be considered
- `Reservation ID` must be empty
- `Reservation URL` must be empty
- required event information must be present

These rules apply to every fresh SmartSuite pull used by the buying bot.

Meaning of `Live` in `Buying`:

- `Live = No` means the pass is still pending purchase and has not been sent to inventory/marketplace
- `Live = Yes` means the pass has already been bought and/or listed and should disappear from buying-pending logic
- once a pass is marked `Live`, it is effectively mirrored into inventory for sale

Required information currently includes:

- `Event Date`
- `Provider`
- `Performer Name`
- `Venue Name`
- `Parking Location`
- `Buy Cost`
- `Sell Price`

`Event Time` is optional at the SmartSuite level.

Operationally:

- SmartSuite usually does not contain event time
- the buyer often confirms the time directly in StubHub before purchase
- this manual review helps detect cancellations or rescheduled events
- `Event Time` may still be stored for special cases where the same performer appears multiple times on the same date at the same venue

Example special case:

- `Monster Jam` with one show at `12:00 PM`
- another show at `6:00 PM`
- same venue and same date

Because of this, `Event Time` should not be required for candidate eligibility, but it should be used when available.

Important:

- `Event Time` from SmartSuite is a strong operational hint, not final proof by itself
- even when SmartSuite includes an event time, the event should still be validated in StubHub
- this helps detect cancellations, reschedules, and mismatched event mappings before checkout

### Event Matching Inputs For StubHub

When resolving the correct event in StubHub for time detection, use this priority:

1. `Event ID` when it contains a StubHub event reference, event info string, or direct event link
   - preferred direct pattern: `https://www.stubhub.com/event/<EVENT_ID>`
2. `Performer Name` + `Venue Name` + `Event Date`
3. `City & State` as a disambiguator when venue names are repeated across different markets

Why `City & State` matters:

- some venues have the same or very similar names in different cities
- it helps when StubHub search results are ambiguous
- it adds confidence when the venue title in SmartSuite and StubHub are not exact string matches

This event-time resolution step is shared across all providers.

It should happen after generic buying filters pass, but before any provider-specific search or checkout flow begins.

This is step 2 of the `Bot de compra`.

Validation rule when `Event ID` exists:

- still validate the event at least once before accepting the match
- required checks:
  - event date should match
  - performer name should have a reasonable match, not necessarily exact
  - venue name should have a reasonable match, not necessarily exact
- this protects against bad mappings or stale event ids in SmartSuite

Validation rule when `Event Time` exists in SmartSuite:

- still validate the event in StubHub before accepting the event time
- treat the SmartSuite time as a high-value hint
- this is especially useful for multiple-show dates such as `Monster Jam`

Current implementation state:

- shared event-time resolution is already wired into the buying bot pipeline
- the active production path uses live StubHub public web lookup, not the StubHub API
- event validation is grouped by event/venue/date/city so repeated buy orders do not trigger repeated web lookups
- grouped lookups retry short volatile failures before concluding `missing_on_stubhub`
- manual resolution data still exists only as an operational fallback mode if needed

This same resolution logic is now also used by the `Listing Bot` for `Event ID` validation and backfilling.

## Core Business Rules

### Parking Time Window

Parking is purchased to cover:

- 1 hour before the event
- 5 hours after the event

Total target parking window:

- 6 hours

Example:

- if event time is `6:00 PM`
- parking window should be approximately `5:00 PM` to `11:00 PM`

If `Event Time` is missing:

- the record can still remain eligible
- the automation should obtain the event time later from StubHub or another trusted source before checkout

Purpose:

- give the customer time to arrive
- park before the event
- attend the event
- return and exit the parking location without issue

### Price Tolerance

The `Buy Cost` stored in SmartSuite is usually based on the most recent known purchase price.

Operational rule for now:

- if checkout price is within about `$2-$3` above the expected buy cost, purchase can still proceed
- if the price is meaningfully higher, do not buy for now
- alternative location logic may be added later

### Profitability

Current local engine also checks:

- `buy_cost < sell_price`

This is a safe baseline rule for identifying buy candidates.

## Provider Workflow: way.com

`way.com` is one of the main target providers for automation.

Current provider implementation priority:

- `Way` first

Long-term purchase bot goal:

- run the same full intake -> event-time -> checkout flow for all supported providers

### Current Human Flow

1. A row is received in `Buying` as a purchase order candidate.
2. The operator reviews the event details in SmartSuite.
3. The operator confirms the correct event and event time in StubHub.
4. The operator goes to `way.com`.
5. Search is performed using either:
   - the parking address directly, or
   - the venue/stadium name
   - and later should prioritize `Event ID` / event info when available
6. The operator confirms the correct location for the event.
7. The operator sets the parking window based on the event time:
   - start = 1 hour before event
   - end = 5 hours after event
8. The operator reviews availability and price.
9. If the final price is acceptable, checkout is completed.
10. After purchase, the operator retrieves:
   - reservation URL
   - reservation ID
11. Those values are written back into SmartSuite.

### Current Automated Flow for way.com

The current live bot already automates:

- search
- date/time entry
- availability validation
- checkout flow
- reservation capture
- SmartSuite write-back

Current hardening rules:

- clear stale cart/checkout state before each new Way search
- validate that the checkout page still matches the selected lot before proceeding
- reject stale or reused reservation IDs by snapshotting `orders` before checkout
- retry some recoverable failures only when no new reservation appeared in `orders`
- treat `license_plate_required` as a recoverable case first, not an immediate terminal error
- if the target lot is explicitly `Soldout`, mark it as sold out instead of treating it like a generic match failure
- if one pass proves the target lot is sold out, skip equivalent passes for that same event/date/parking target in the same batch

Still deferred for later:

- alternate parking location search
- advanced market-price validation
- more complex exception handling

### Way Login and Navigation

- Login URL: `https://www.way.com/login`
- Home/Search URL: `https://www.way.com/`
- Orders URL: `https://www.way.com/orders`

Way session rule:

- first check whether the account is already logged in
- if not, sign in with the configured credentials

### Way Search and Checkout Rules

- use the parking location or venue name in the main search box
- when using parking location text, trim everything after the parentheses distance marker
- if the location search does not produce a usable match, this may be an airport parking case
- maintain a tracked list of airport parking locations and airport lot aliases
- for those airport cases, prefer a direct `Airport` search using the mapped airport query instead of trusting street-address results
- in airport mode, if available:
  - click `Show All (...)`
  - collect more results
  - and if still needed switch sort to `Cheapest`
- for airport lots, require a strong alias match before proceeding to checkout
- if the expected airport lot does not appear strongly, fail safe as `parking_lot_not_found` instead of buying a nearby airport lot
- use validated event date and event time to build the parking window
- calendar month navigation must work both backward and forward across months, not just for the current month on screen
- click `Reserve now` on the chosen lot
- final confirmation button is `Checkout`
- some lots may show an upsell or membership option that should be declined
- for `Way+` membership, do not treat passive copy alone as proof that the decline option was selected
- before final `Checkout`, run a membership preflight and stop if the decline choice cannot be confirmed strongly
- if final `Checkout` stays on `/checkout` and membership is still present, re-run the decline flow and retry checkout before failing
- log the membership state when checkout is blocked so operators can distinguish a real membership block from a generic timeout
- before each new search, clear stale cart/order-summary state if Way is still carrying a previous lot
- after reaching checkout, validate that the visible lot/title/address still matches the selected lot
- if checkout is for the wrong lot, stop and retry from a clean state rather than risking a wrong purchase
- if Way redirects back to home after `Proceed to Checkout`, recover by reopening `/checkout`
- if Way shows `License plate is mandatory to book ...`, first try local recovery inside checkout before retrying the full purchase flow
- after final `Checkout`, prefer `https://www.way.com/checkout/order-confirmed` as the strong confirmation signal
- if `order-confirmed` does not appear but a new reservation later shows up in `orders`, capture it and treat it as the real purchase result

Known airport parking exceptions to track:

- `78100 Varner Rd` -> `Motel 6 Palm Desert PSP Airport Parking`
- `2617 McGavock Pk` -> `Quality Inn BNA Airport Parking`
- `580 W Shaw Ave` -> `TownePlace Suites by Marriott Fresno Clovis / Fresno Air Terminal FAT`
- `1520 N 84th Dr` -> `Victory Inn PHX Airport Parking`
- `1211 N W Ave` -> `Fargo airport parking`

### Way Post-Purchase Capture

- after purchase, go to the orders page
- locate the new pass in the right-side list
- capture the `Reservation ID`
- construct the reservation link as:
  - `https://www.way.com/order-print/<RESERVATION_ID>`
- if the order title is unclear, validate using the parking pass/address shown in the pass view
- only accept reservation IDs that were not already present in the pre-checkout `orders` snapshot
- validate the captured pass against the expected lot plus the actual purchased parking window
- for airport parking passes, include airport aliases and airport query metadata in the validation score
- if `order-confirmed` is missing but `orders` shows a new matching reservation, still accept and write it back

## Current Buying Bot Runtime Flow

Today the full buying bot flow is:

1. pull fresh pending buy orders from SmartSuite
2. filter base eligibility
3. group orders by event identity for shared StubHub validation
4. validate event time/status against live StubHub web pages
5. build a shared checkout window plan
6. route eligible records to provider execution
7. execute provider checkout with retries and protections
8. capture only a new reservation ID
9. write results back to SmartSuite
10. write a batch summary JSON and terminal summary

Important runtime safety rules:

- every batch must start from a fresh SmartSuite pull
- event validation happens before provider checkout
- provider checkout must not trust stale Way cart/checkout state
- retries are only allowed when no new reservation appeared in `orders`
- if there is any sign a reservation may have changed, the bot should stop retrying and flag manual review
- summary should explicitly call out blocked records with no event-time detection so operators know which rows may need manual `Event ID` help

## Shared Event-Time Resolution

Event-time resolution is shared across all providers.

Current source of truth:

- StubHub public web pages
- not the StubHub API
- not Playwright browser clicks for routine event-time lookup

Current matching strategy:

- first use `Event ID` / StubHub-style event reference when available
- otherwise use `Performer Name + Venue Name + Event Date`
- use `City & State` as disambiguation
- use venue-page fallback when search results are too generic
- group duplicate buy orders so the same event is validated once per batch
- retry a small number of volatile lookup failures before marking `missing_on_stubhub`

Current event statuses used by the bot:

- `scheduled`
- `tbd`
- `tbh`
- `canceled`
- `rescheduled`
- `missing_on_stubhub`

Purchase eligibility:

- `scheduled` -> eligible if a usable window can be built
- `tbd` / `tbh` -> eligible using the special full-day window policy
- `canceled` / `rescheduled` / `missing_on_stubhub` -> blocked

## Shared Checkout Window Policy

Window planning is shared infrastructure, not Way-specific logic.

Standard scheduled event:

- start = 1 hour before event
- end = 5 hours after event
- for Way, times are rounded down to the nearest 15-minute increment before entering the picker
- if `parking_lot_not_found` occurs in Way, the bot may retry shorter windows before failing final

If that crosses midnight:

- try the standard window first
- then shorter overnight fallbacks

`TBD` / `TBH` events:

- normal window: `10:00 AM` to `1:00 AM` next day
- fallback window: `11:00 AM` to `11:00 PM`

Festival / all-day style events:

- use the same full-day policy as `TBD` / `TBH`
- this applies even when a festival page also shows a time, because operationally we usually need broad coverage

## Retry and Exception Policy

Current live retry behavior:

- retry only limited times per record
- retry only for explicitly recoverable statuses
- do not retry if a new reservation appeared in `orders`
- if the same event/date/parking target fails with the same type of deterministic search issue, later equivalent passes may be skipped in the same batch to save time
- for repeated deterministic Way search failures, allow up to 2 real records from the same equivalent group to validate the pattern, then skip the rest of that group in the same batch

Examples of recoverable statuses:

- `execution_error`
- `checkout_completed_but_reservation_not_captured`
- `reservation_match_not_found`
- `license_plate_required`

Important distinction:

- `parking_lot_not_found` may trigger shorter-window fallback attempts
- `checkout_target_mismatch` should remain a distinct selection error and not be silently downgraded into a lot-availability retry

Examples of terminal-but-safe outcomes:

- `price_out_of_range`
- `best_match_unavailable`
- `missing_on_stubhub`

## License Plate Handling

Way license plate behavior is intermittent and lot-dependent.

Current handling order:

1. detect the explicit Way message `License plate is mandatory to book ...`
2. dismiss the modal if present
3. verify / reselect the saved vehicle when possible
4. retry final checkout inside the same checkout page
5. if still blocked, allow a full record retry only if no new reservation appeared in `orders`

Operational note:

- some lots appear to accept the saved vehicle intermittently
- some lots may still block even after vehicle reselection
- when multiple saved vehicles exist, prefer trying alternative saved vehicles during recovery instead of blindly reusing the currently selected one

## Runtime Maintenance

To keep the buying bot lighter and faster over time:

- keep `WAY_DEBUG` off by default during routine runs
- do not persist routine screenshots unless debugging or explicitly requested
- periodically clear heavy Way browser cache directories while preserving the login session
- rotate old screenshots and old output JSON files automatically
- avoid spending retry attempts on clearly unrecoverable deterministic errors

## Sold Out Handling

Sold out behavior must be recognized separately from a generic lot-match failure.

Current rule for Way:

- if the strongest address match for the target parking location is marked `Soldout`, return `target_lot_sold_out`
- do not silently replace that target with another lot inside the same attempt
- once a target lot is confirmed sold out for one pass, skip equivalent passes for the same event/date/parking target during the same batch

Operational purpose:

- this makes it easier to identify when SmartSuite needs an alternate parking address
- it prevents wasting repeated attempts on the same sold out target

## AI Fallback Policy

AI should not be the primary decision engine for routine checkout clicks when deterministic selectors still work.

Recommended order of operations:

1. deterministic selectors
2. waits / retries / multiple DOM patterns
3. regex / structured HTML parsing
4. AI fallback only for genuinely ambiguous content

Best current candidates for AI fallback:

- ambiguous StubHub HTML/text when deterministic event-time extraction fails
- extracting a likely event time or event status from messy venue-page text
- classifying uncertain web content into:
  - `scheduled`
  - `tbd/tbh`
  - `canceled`
  - `rescheduled`
  - `missing`

Not recommended yet for AI fallback:

- deciding where to click in Way checkout
- routine lot matching when deterministic address/title checks are available
- overriding reservation safety logic

If AI fallback is added later, it should:

- run only after deterministic lookup fails
- receive a compact HTML/text excerpt, not the whole page blindly
- return a structured decision with confidence
- log every fallback invocation for later review and parser improvement

Current implementation note:

- the StubHub resolver now has an optional AI fallback path for ambiguous `missing_on_stubhub` cases
- it is intended only as a last resort after deterministic search, venue fallback, and retries fail
- it should remain disabled by default unless the environment is configured for it

## Output Goals

Current version should help identify and prepare candidate purchases.

Future versions should support:

- direct SmartSuite API reads for the `Buying` table
- provider-specific execution plans
- direct checkout automation
- SmartSuite updates after purchase
- use inside n8n workflows
- post-purchase validation and exception handling

## Stage 1 Integration Plan

Stage 1 goal:

- read `Buying` records directly from SmartSuite by API
- normalize them into the project buying-order shape
- apply the same business filters used locally
- keep local sample data as a fallback for development

Current implementation direction:

- use SmartSuite `records/list` endpoint on the `Buying` table
- authenticate with `Authorization: Token ...`
- include `Account-Id` header with the SmartSuite workspace id
- filter server-side first by:
  - selected date range
  - `Live = No`
  - empty `Reservation ID`
  - empty `Reservation URL`
- paginate only through the filtered result set
- normalize SmartSuite responses before filtering

## Provider Architecture

Provider flows must remain isolated from each other because:

- checkout steps differ by provider
- event-time resolution may differ by provider
- search inputs and validation rules differ by provider
- reservation capture formats differ by provider

Architecture direction:

- shared pipeline for intake, normalization, and generic eligibility filtering
- shared pre-provider stage for event-time resolution
- provider routing after filtering
- one module per provider for search/check-out logic
- one output bucket per provider so execution can be handled independently

Current provider modules:

- `Way` -> active design target

Planned provider modules:

- `Spothero`
- `LAZ Parking`
- `ParkMobile`
- others as needed

For `Way`, Stage 2 begins with:

- receiving records after the shared event-time resolution stage
- preparing the provider-specific search plan
- only then moving into checkout automation

## Fulfillment Integration

Fulfillment automation is now an active operational workflow separate from buying.

Current fulfillment source of truth:

- SmartSuite inventory table used by `salesTracking`

Current fulfillment provider status:

- `StubHub POS API` -> active
- `ReachPro` -> pending API upload implementation

Current StubHub fulfillment boundary:

- supported ReachPro-style / exposed-ticket sales can be auto-uploaded and confirmed
- TV / legacy sales with no usable `ticketId` remain manual and should not be auto-marked fulfilled

Fulfillment entry rules:

- `Event Date >= current local day`
- `Sold = yes`
- `Fulfilled != FULFILLED`
- `StubHub Sale #` present
- `PDF Checker = PDF ATTACHED`
- `Resolution Override = N/A` or empty
- `Request for Solution != Yes`
- `Request Comment / Detail` does not already contain one of our automation notes

Fulfillment automation notes:

- `PDF has different event date.`
- `PDF has different location than sale.`
- `PDF could not be validated.`
- `PDF could not be sent.`

Those notes are append-only and also remove the row from future automated retries.

Fulfillment validation rules:

- validate event date from PDF
- validate parking location / address from PDF
- validate reservation id when available
- use OCR fallback when embedded PDF text is insufficient

Fulfillment status outcomes:

- `pass_auto`
- `pass_provider_exception`
- `review_location_mismatch`
- `review_provider_exception`
- `fail_date_mismatch`

Known provider exception families for location matching:

- `Fargo Airport`
- `Fly Louisville`
- `HersheyPark`
- `Premium Parking`
- `Rightway Parking`
- `SFA Airport`

Fulfillment grouping rule:

- never group only by `StubHub Sale #`
- group by:
  - `StubHub Sale #`
  - `Event Date`
  - normalized `Parking Location`

This protects against re-scheduled events and stale PDFs under the same sale context.

StubHub fulfillment rules learned in production:

- do not trust `fulfillmentDate` alone
- do not trust `/assets` object existence alone
- consider externally fulfilled only if:
  - real assets exist
  - or `posState.fullfilmentState = Fulfilled`

Known StubHub limitation:

Some invoices return:

- `saleStatus = PendingAllocation`
- `posState.fullfilmentState = Pending`
- empty `tickets`
- empty assets

Those can reject upload with `Ticket Id is required`.

Current working assumption:

- some legacy or allocation-pending StubHub sales require an internal allocation step not exposed clearly in the public POS API
- those should not be auto-marked fulfilled
- those should not be blindly retried for upload

## Project Knowledge Map

Current “brain” is implemented across:

- `BRAIN.md` -> business knowledge and operating rules
- `src/smartsuiteConfig.js` -> SmartSuite IDs and field mapping
- `src/normalizeBuying.js` -> normalization of raw records into buying orders
- `src/filterBuying.js` -> filtering logic and parking window logic
- `README.md` -> project-level overview

## Open Questions

These items still need to be defined later:

- when to add AI fallback into StubHub resolution and what compact prompt/output schema to use
- whether some Way lots require explicit license-plate text entry rather than selecting a saved vehicle
- how to detect and handle partial fulfillment
- when and how to search alternative parking locations
- how SmartSuite should be updated after failed or partial purchases

## Update Policy

This file should be updated whenever we learn:

- a new provider workflow
- a new SmartSuite field or dependency
- a new exception case
- a pricing or eligibility rule
- a post-purchase workflow step
- an n8n integration rule
