Ops - Fulfillment Integration operative workspace

This folder stores the working docs, outputs, downloaded PDFs, and audit artifacts for the live fulfillment automation.

Current production direction

- source of truth: SmartSuite inventory table
- validation: local PDF parser + OCR fallback
- active provider: StubHub POS API
- pending provider: ReachPro

Operational rules in effect

- only sold, future-event, unfulfilled rows are considered
- rows with `Request for Solution = Yes` are skipped
- rows with our auto-comments are skipped on future runs
- rows already fulfilled in StubHub are marked `FULFILLED` in SmartSuite
- rows sent successfully are marked `FULFILLED` in SmartSuite
- rows with validation or send problems get a short note in `Request Comment / Detail`

Standard auto-comments

- `PDF has different event date.`
- `PDF has different location than sale.`
- `PDF content could not be recognized by automation.`
- `PDF could not be sent via API.`

Current known StubHub limitation

Some invoices return:

- `saleStatus = PendingAllocation`
- `posState.fullfilmentState = Pending`
- no `tickets`
- no assets

Those sales can reject upload with:

- `Ticket Id is required`

Current interpretation:

- some sales need an allocation step not clearly exposed in the public POS API
- the StubHub web app may support that step even when the public API does not

Outputs and saved artifacts

This folder is already being used correctly.

Important subpaths:

- `outputs/fulfillment-integration-last-run-candidates.json`
- `outputs/fulfillment-integration-last-run-pdf-validation.json`
- `outputs/fulfillment-integration-last-run.json`
- `outputs/fulfillment-automation-last-run.json`
- `outputs/downloads/`
- `outputs/downloads-targeted/`

Current next step

- continue using the automation for clean StubHub sends
- treat `PendingAllocation` sales as a separate investigation / manual path until ticket allocation is understood
