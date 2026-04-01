# Ops - Sales Tracking

This module owns post-sale reconciliation from marketplace/email data back into SmartSuite.

Structure:

- `src/salesTracking/`
  - parsing, candidate selection, normalization, SmartSuite updates
- `runtime/`
  - outputs and sales-tracking operative notes

Shared dependencies:

- `../Shared/`
  - generic SmartSuite API access, shared Sales Tracking SmartSuite table/field config, and reusable helpers
- `../Workspace/`
  - env loading and runtime path resolution

Operational note:

- the live production Gmail-driven flow still exists as an Apps Script reference
- the approved copy/paste reference is stored at:
  - `runtime/outputs/APPS_SCRIPT_PRODUCTION_REFERENCE.md`

Detailed technical notes:

- `src/salesTracking/README.md`
- `runtime/README.md`
