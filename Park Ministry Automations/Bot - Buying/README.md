# Bot - Buying

This module owns the live parking-pass purchase workflow for Park Ministry.

Structure:

- `src/buyingBot/`
  - SmartSuite intake, filtering, provider planning, checkout flows
- `runtime/`
  - outputs, screenshots, sessions, and module-specific operative notes

Shared dependencies:

- `../Shared/`
  - SmartSuite helpers, record normalization, StubHub event-time resolution, checkout window planning
- `../Workspace/`
  - env loading and runtime path resolution

Current operational notes:

- the Way address picker now accepts branded suggestions when the exact primary address is still present
- the Way time-picker lookup now uses a more tolerant container fallback before concluding a target time is missing
- `parking_lot_not_found` now retries shorter checkout windows before failing final
- `checkout_target_mismatch` remains a separate selection error and does not trigger the shorter-window fallback
- explicit Event ID override runs are supported through:
  - `npm run buying:live:force-event-id`
  - `LISTING_FORCE_EVENT_IDS=160123456 npm run buying:live:force-event-id`

Recent isolated regression checks:

- `Netflix is a Joke`
  - passed `home -> results -> checkout`
- `Romeo Santos`
  - passed `home -> results -> checkout`
- `Puscifer`
  - passed `home -> results`
  - blocked only by real `Soldout`

Detailed technical notes:

- `src/buyingBot/README.md`
- `runtime/README.md`
