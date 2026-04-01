Bot - Listing current output review

This document is a lightweight reminder of what the current Bot - Listing output is expected to do.

Current behavior

- pulls SmartSuite rows by event date range and `Live = No`
- only keeps rows eligible for listing when these fields are present:
  - `Reservation ID`
  - `Reservation URL`
  - `Provider`
  - `Performer`
  - `Venue`
  - `Parking Location`
  - `Parking Location ID`
  - `Buy Cost`
  - `Sell Price`
  - `Platform(s) listed on` must be empty
- validates existing parking `Event ID` values or resolves missing ones
- generates the ReachPro CSV using the current validated template mapping
- updates SmartSuite with:
  - `Event ID` when a valid one was resolved
  - `Platform(s) listed on = ReachPro` for included rows
- does not upload to ReachPro yet
- does not mark `Live = Yes` yet

Current review sources

- [reachpro-bulk-draft-latest.csv](/Users/alejandroleiva/Documents/Documentos Trabajo/Park Ministry/Task Automations/Bot Operative Docs/ListingBot/outputs/reachpro-bulk-draft-latest.csv)
- [listing-bot-last-run.json](/Users/alejandroleiva/Documents/Documentos Trabajo/Park Ministry/Task Automations/Bot Operative Docs/ListingBot/outputs/listing-bot-last-run.json)

Important operational notes

- if the latest CSV contains only a header row, check the JSON summary first
- the most common block reasons should come from missing listing-required fields, not from template format
- the listing bot must always use the parking `StubHubEventId`, not the main show event id

Files reviewed

- [fetchListingCandidates.js](/Users/alejandroleiva/Documents/Documentos Trabajo/Park Ministry/Task Automations/src/bots/listingBot/fetchListingCandidates.js)
- [buildReachProDraftCsv.js](/Users/alejandroleiva/Documents/Documentos Trabajo/Park Ministry/Task Automations/src/bots/listingBot/buildReachProDraftCsv.js)
- [runListingBot.js](/Users/alejandroleiva/Documents/Documentos Trabajo/Park Ministry/Task Automations/src/bots/listingBot/runListingBot.js)
- [updateSmartsuiteListingFields.js](/Users/alejandroleiva/Documents/Documentos Trabajo/Park Ministry/Task Automations/src/bots/listingBot/updateSmartsuiteListingFields.js)
