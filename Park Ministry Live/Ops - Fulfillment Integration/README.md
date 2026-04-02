# Ops - Fulfillment Integration

This module owns PDF validation and StubHub fulfillment automation.

Structure:

- `src/fulfillmentIntegration/`
  - candidate fetch, PDF validation, StubHub API integration, SmartSuite write-back
- `runtime/`
  - outputs, downloaded PDFs, and fulfillment operative notes

Shared dependencies:

- `../Shared/`
  - generic SmartSuite API access, shared inventory SmartSuite table-field config, and shared business helpers
- `../Workspace/`
  - env loading and runtime path resolution

Current operational notes:

- candidate intake now starts with a conservative SmartSuite server-side prefilter before local normalization
- TV / legacy sales with missing StubHub `ticketId` are treated as manual:
  - `TV sale, cannot auto fulfill.`
- confirmed StubHub success requires a real uploaded asset after send, not just a `PATCH 200`

Detailed technical notes:

- `src/fulfillmentIntegration/README.md`
- `runtime/README.md`
