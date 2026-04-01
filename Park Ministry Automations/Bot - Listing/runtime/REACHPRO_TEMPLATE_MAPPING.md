ReachPro template mapping

Reference file:

- [create-purchases-2026-03-19T14_52_35.csv](/Users/alejandroleiva/Documents/Documentos%20Trabajo/Park%20Ministry/Task%20Automations/Bot%20Operative%20Docs/ListingBot/templates/reachpro/create-purchases-2026-03-19T14_52_35.csv)

Status

- This is the active ReachPro-oriented template reference currently used for the V1 builder.
- It includes `StubHubEventId`, which is required for listing and is the key field for the Bot - Listing.
- The template has 20 columns.

Columns and proposed mapping

1. `VendorOrderId`
- Map from `Reservation ID`
- Source: SmartSuite `reservation_id`

2. `VendorName`
- Proposed value: `Default Vendor`
- Note: user mentioned provider may remain hidden, so this should stay fixed unless ReachPro asks otherwise

3. `VendorEmailAddress`
- Proposed value: `null@null.com`
- Note: keep fixed for now until ReachPro confirms a required vendor email

4. `PurchaseDate`
- Proposed value: timestamp when the CSV is generated
- Example target format: `3/19/2026 3:43:06 AM`

5. `DeliveryType`
- Proposed fixed value: `PDF`
- Note: user said it may be `PDF` or `e-ticket`, but current template note says `PDF`

6. `TicketCount`
- Proposed fixed value: `1`
- Reason: each row represents one reservation / one pass

7. `CurrencyCode`
- Proposed fixed value: `USD`

8. `InHandAt`
- Proposed value for v1: literal `24 hours before event`
- Note: this may later need to become a computed timestamp if ReachPro expects a real datetime instead of text

9. `Section`
- Map from `Parking Location`
- Source: SmartSuite `parking_location`

10. `Row`
- Proposed fixed value: `0`

11. `SeatFrom`
- Proposed fixed value: empty

12. `SeatTo`
- Proposed fixed value: empty

13. `StubHubEventId`
- Map from validated parking `Event ID`
- Source: `resolved_event_id`
- Critical rule: must be the parking event id, not the main event id

14. `UnitCost`
- Map from `Buy Cost`
- Source: SmartSuite `buy_cost`

15. `FaceValueCost`
- Proposed fixed value: empty
- Reason: no confirmed source or business rule yet

16. `ExpectedValue`
- Map from `Sell Price`
- Source: SmartSuite `sell_price`

17. `TaxPaid`
- Proposed fixed value: empty

18. `AutoBroadcastCreatedListing`
- Proposed fixed value: `FALSE`
- Note: user wants to confirm later how this should relate to marketplace broadcast behavior

19. `ListingNotes`
- Proposed value: distance / parking detail from `Parking Location`
- Source note: include the distance from the venue as already shown in SmartSuite parking location text

20. `PrivateNotes`
- Proposed value: `Reservation URL`
- Source: SmartSuite `reservation_url`
- Note: user said this is the most likely destination for reservation URL

Important operational rules

- The bot should only populate `StubHubEventId` after parking-event validation, not with the regular show event id.
- If `StubHubEventId` is missing or not validated, the row must not be considered listing-ready.
- If `StubHubEventId` is resolved during the run, it should still be written back to SmartSuite.
- `Platform(s) listed on = ReachPro` should continue updating only for rows that are truly ready for listing.

Open questions for later refinement

- Whether `VendorName` should remain `Default Vendor` or some other fixed value
- Whether `VendorEmailAddress` should remain `null@null.com`
- Whether `DeliveryType` is definitively `PDF` for all listings
- Whether `InHandAt` accepts text or requires a real timestamp
- Whether `AutoBroadcastCreatedListing` should remain `FALSE` or be driven by listing behavior later

Current implementation note

- the current Bot - Listing builder already follows this 20-column mapping
- future changes here should only happen if ReachPro changes its template or import rules
