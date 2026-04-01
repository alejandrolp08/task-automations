# Shared

This module contains logic shared across multiple Park Ministry automations.

Current shared areas:

- `src/shared/smartsuite/`
- `src/shared/stubhub/`
- `src/shared/records/`
- `src/shared/providers/`

Current SmartSuite usage examples in shared code:

- generic record listing and headers for workspace modules
- unified Park Ministry SmartSuite config for:
  - Buying / Listing
  - Sales Tracking / Fulfillment Integration
- Buying Bot intake
- Ops - Sales Tracking intake
- Ops - Fulfillment Integration intake

Use `Shared/` for cross-module helpers only. Module-specific logic should stay inside its owning bot or script.
