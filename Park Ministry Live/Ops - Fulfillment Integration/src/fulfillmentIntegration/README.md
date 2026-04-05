Ops - Fulfillment Integration scripts

This folder contains the active Park Ministry fulfillment automation for sold parking PDFs.

Current runtime direction:

- SmartSuite is the source of truth for candidate selection
- PDF validation happens locally before any send attempt
- StubHub POS API is the live provider currently integrated
- ReachPro remains pending until its upload API is confirmed

Current workflow

1. Pull SmartSuite candidates from the inventory table used by `salesTracking`.
2. Apply a conservative SmartSuite prefilter first.
3. Normalize and apply the stricter local eligibility rules.
4. Download the PDF from SmartSuite shared-file handles.
5. Extract PDF text with `pypdf`, then fallback OCR:
   - `swift` Vision on macOS when available
   - portable OCR on Windows / Ubuntu when available
6. Validate:
   - event date
   - parking location / address
   - reservation id when available
7. Group rows for send using:
   - `StubHub Sale #`
   - `Event Date`
   - normalized `Parking Location`
8. Precheck StubHub invoice state.
9. If already fulfilled externally, mark SmartSuite `FULFILLED`.
10. If valid and sendable, upload PDFs to StubHub.
11. If validation or send fails, append a short operational note in SmartSuite and stop retrying that row automatically.

SmartSuite prefilter

Before local eligibility runs, the automation now asks SmartSuite only for rows that already satisfy these broad conditions:

- `Event Date >= start date`
- marketplace sale reference present
- `PDF Checker = PDF ATTACHED`
- `Request for Solution != Yes`

This is intentionally conservative.

Local code still performs the stricter checks for:

- `Sold = yes`
- `Fulfilled != FULFILLED`
- `Resolution Override = N/A` or empty
- automation-note blockers in comments

SmartSuite candidate rules

A row enters the automation only if all of these are true:

- `Event Date >= today` using local runtime date
- `Sold = yes`
- `Fulfilled != FULFILLED`
- `StubHub Sale #` is present
- `PDF Checker = PDF ATTACHED`
- `Resolution Override = N/A` or empty
- `Request for Solution != Yes`
- `Request Comment / Detail` does not already contain one of our automation notes

Automation notes

These notes are append-only in `Request Comment / Detail` and also act as retry blockers:

- `PDF has different event date.`
- `PDF has different location than sale.`
- `PDF content could not be recognized by automation.`
- `PDF could not be sent via API.`
- `TV sale, cannot auto fulfill.`

If one of those messages is already present, the row is skipped on future runs.

Validation outcomes

- `pass_auto`
  - date and location matched
- `pass_provider_exception`
  - provider family is known to omit reliable location data
  - date matched
  - reservation id matched when required
- `review_location_mismatch`
  - date matched but PDF location contradicts SmartSuite
- `review_provider_exception`
  - provider exception family but not enough confidence to auto-pass
- `fail_date_mismatch`
  - PDF date contradicts the expected event date

Provider exception families

These may pass without strict location matching if date and reservation id logic support it:

- `Fargo Airport`
- `Fly Louisville`
- `HersheyPark`
- `Parkobility`
- `Premium Parking`
- `Rightway Parking`
- `SFA Airport`
- `BestParking`
- `ClicknPark`
- `GRS`

Provider detection order

- SmartSuite `Provider Name` when mapped
- SmartSuite `reservation_url` domain inference
- PDF text inference

Current portable OCR direction

- `extractPdfTextOcrPortable.py`
  - renders the PDF to images using `pdftoppm` / `pdftocairo`
  - prefers `PaddleOCR` when installed
  - falls back to `pytesseract` when installed
  - degrades safely back to direct-text mode if no portable OCR backend exists

StubHub integration status

- Base URL: `https://pointofsaleapi.stubhub.net`
- Auth:
  - `Authorization: Bearer <token>`
  - `Account-Id: <uuid>`
- Main endpoints used:
  - `GET /invoices/{marketplaceSaleId}/{marketplace}`
  - `GET /invoices/{invoiceId}`
  - `GET /invoices/{invoiceId}/assets`
  - `PATCH /invoices/{invoiceId}`

Important real-world behavior discovered

- `fulfillmentDate` alone is not a reliable indicator of completed fulfillment.
- `/assets` can return an object even when no real assets exist.
- We now treat StubHub as already fulfilled only if:
  - real assets exist
  - or `posState.fullfilmentState = Fulfilled`
- successful upload confirmation should include a real delivered asset, such as `uploaded_tickets_count >= 1`

Known limitation

Some StubHub sales are returned as:

- `saleStatus = PendingAllocation`
- `posState.fullfilmentState = Pending`
- `tickets = []`

We also observed equivalent API-blocked cases where:

- `saleStatus = PendingConfirmation`
- `available_ticket_ids = []`

For those sales, `PATCH /invoices/{invoiceId}` may reject PDF upload with:

- `ETickets[0]: Ticket Id is required`

Current inference:

- the public POS API requires `ticketId` for eTicket upload
- some legacy or allocation-pending sales do not expose those ticket ids yet
- the StubHub web UI likely performs an additional internal allocation step not exposed clearly in the public POS API

Current operational recommendation for that case:

- do not auto-mark as fulfilled
- do not retry blindly
- treat as a non-sendable API case until allocation behavior is better understood
- mark operationally as:
  - `TV sale, cannot auto fulfill.`

Key files

- `runFulfillmentAutomation.js`
  - end-to-end automation runner
- `fetchFulfillmentCandidates.js`
  - SmartSuite candidate selection
- `validateFulfillmentPdf.js`
  - PDF validation, scoring, provider exception logic
- `runFulfillmentPdfValidationPreview.js`
  - validation preview and grouping audit
- `runFulfillmentIntegration.js`
  - direct provider send runner
- `stubhubFulfillmentApi.js`
  - StubHub request builders
- `updateSmartsuiteFulfillmentStatus.js`
  - SmartSuite write-back helper
- `fulfillmentAutomationNotes.js`
  - standard auto-comment messages
- `extractPdfText.py`
  - embedded text extraction
- `extractPdfTextOcr.swift`
  - OCR fallback
- `extractPdfTextOcrPortable.py`
  - cross-platform OCR fallback
- `runFulfillmentPdfDiagnostics.js`
  - compare OCR modes over specific sale IDs without sending PDFs

CLI usage

Validation preview:

- `npm run fulfillment:validate-pdfs`
- `FULFILLMENT_PREVIEW_SALE_IDS=639521159,639550882 npm run debug:fulfillment:validate-pdfs`

Candidate preview:

- `npm run fulfillment:candidates`

Diagnostics:

- `FULFILLMENT_DIAGNOSTIC_SALE_IDS=639521159,639550882 npm run debug:fulfillment:diagnostics`
- optional:
  - `FULFILLMENT_DIAGNOSTIC_OCR_MODES=auto,swift,portable,direct`
  - `FULFILLMENT_PDF_OCR_MODE=portable`

Full automation dry-run:

- `npm run fulfillment:run`

Full automation live:

- `FULFILLMENT_AUTOMATION_APPLY=1 npm run fulfillment:run`

Useful env vars

- `STUBHUB_POS_API_TOKEN`
- `STUBHUB_POS_ACCOUNT_ID`
- `STUBHUB_CLIENT_ID` and `STUBHUB_CLIENT_SECRET` are only needed if the workspace later adds OAuth/token-generation flows
- `FULFILLMENT_AUTOMATION_LIMIT`
- `FULFILLMENT_AUTOMATION_OFFSET`
- `FULFILLMENT_INCLUDE_STUBHUB_PRECHECK=1`
- `FULFILLMENT_START_DATE`

Outputs

All fulfillment audit files are written under:

- `Ops - Fulfillment Integration/runtime/outputs/`

Main output files:

- `fulfillment-integration-last-run-candidates.json`
- `fulfillment-integration-last-run-pdf-validation.json`
- `fulfillment-integration-last-run.json`
- `fulfillment-automation-last-run.json`

References

- StubHub POS Swagger: https://pointofsaleapi.stubhub.net/swagger/index.html
- StubHub POS OpenAPI: https://pointofsaleapi.stubhub.net/swagger/v1/swagger.json
