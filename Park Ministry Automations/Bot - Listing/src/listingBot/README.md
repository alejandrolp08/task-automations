# Bot - Listing

This folder contains the ReachPro listing draft workflow.

## Purpose

The Bot - Listing:

1. pulls purchased, not-live rows from SmartSuite
2. validates listing-ready fields
3. resolves missing parking event ids through shared StubHub logic
4. builds the ReachPro draft CSV
5. writes approved listing fields back to SmartSuite

## Current Layout

- `runListingBot.js`
  - main runner
- `fetchListingCandidates.js`
  - SmartSuite candidate intake
- `buildReachProDraftCsv.js`
  - ReachPro CSV generation
- `updateSmartsuiteListingFields.js`
  - SmartSuite write-back

## Runtime / Operative Files

Bot - Listing runtime files live under:

- `Bot - Listing/runtime/`

## Listing App

The packaged desktop app for listing operations now lives under:

- `Bot - Listing/app/ListingApp/`

## Important note

`ListingApp` is still a distinct subproject, but it now lives inside the Bot - Listing unit instead of the old shared operative-docs location.
