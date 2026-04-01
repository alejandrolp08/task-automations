# Bot - Buying

This folder contains the Park Ministry buying automation.

## Purpose

The Bot - Buying is the purchase workflow that:

1. pulls fresh pending buy orders from SmartSuite
2. filters valid candidates
3. resolves or validates event time against StubHub
4. routes records into provider-specific checkout flows
5. writes reservation details back to SmartSuite after successful purchase

## Current Layout

- `runBuyingBotLive.js`
  - main live runner
- `fetchBuying.js`
  - intake orchestration
- `fetchSmartsuiteBuying.js`
  - SmartSuite read layer
- `normalizeBuying.js`
  - common record normalization
- `filterBuying.js`
  - eligibility filtering
- `providerPlanning.js`
  - provider routing plan
- `updateSmartsuiteReservation.js`
  - SmartSuite write-back after purchase
- `buildOutput.js`
  - output assembly
- `maintenance.js`
  - maintenance state helpers
- `stages/eventTimeResolution/`
  - shared event-time resolution stage
- `providers/`
  - provider-specific implementations
- `providers/way/`
  - current live provider flow

## Runtime / Operative Files

Bot - Buying runtime files do not live in this source folder.

They live under:

- `Bot - Buying/runtime/data/`
- `Bot - Buying/runtime/outputs/`

## Current Provider Status

- `Way` -> active
- others -> future

## Current Way Notes

- the location suggestion flow now prefers the exact address match more reliably
- `parking_lot_not_found` is allowed to try shorter checkout windows before returning final failure
- `checkout_target_mismatch` remains a distinct review signal for incorrect lot selection
- successful retries still depend on the lot actually appearing in Way results for the chosen window

## Local Run

Recommended:

```bash
npm run buying:live
```

Direct:

```bash
BUYING_SOURCE=smartsuite node "Bot - Buying/src/buyingBot/runBuyingBotLive.js"
```
