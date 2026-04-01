# Task Automations Commands

Comandos listos para copiar y pegar desde esta carpeta:

- [Task Automations](/Users/alejandroleiva/Documents/Documentos%20Trabajo/Task%20Automations)

## Park Ministry

### Buying Bot

```bash
npm run park:buying:live
```

```bash
npm run park:buying:live:force-event-id
```

```bash
LISTING_FORCE_EVENT_IDS=160123456 npm run park:buying:live:force-event-id
```

Use `park:buying:live:force-event-id` when:

- the row already has a trusted StubHub `event_id`
- normal live validation did not leave a usable event time
- you want the Buying Bot to trust the SmartSuite `event_id` fallback

### Listing Bot

```bash
npm run park:listing:reachpro
```

```bash
LISTING_ALLOW_SMARTSUITE_EVENT_ID_ONLY_FALLBACK=1 npm run park:listing:reachpro:force-event-id
```

### Sales Tracking

```bash
npm run park:sales:track
```

### Fulfillment Integration

```bash
npm run park:fulfillment:run
```

```bash
FULFILLMENT_AUTOMATION_LIMIT=25 npm run park:fulfillment:limited
```

## Notes

- `park:buying:live`:
  normal Buying Bot run
- `park:buying:live:force-event-id`:
  use when the row already has a trusted StubHub `event_id` and you want to force the Event ID fallback
- `LISTING_FORCE_EVENT_IDS=... npm run park:buying:live:force-event-id`:
  use when you want to force only a specific StubHub `event_id`
- `park:listing:reachpro:force-event-id`:
  use when Listing needs to rely on the SmartSuite `event_id` fallback
- `park:fulfillment:run`:
  full fulfillment run
- `park:fulfillment:limited`:
  full fulfillment run with a manual batch limit

## Current Operational Notes

- all commands in this file are meant to be run from:
  - `/Users/alejandroleiva/Documents/Documentos Trabajo/Task Automations`
- Buying Bot `Way` search was recently hardened for:
  - branded location suggestions that still contain the exact address
  - time picker container detection that was intermittently failing in batch runs
- recent isolated re-tests confirmed:
  - `Netflix is a Joke` now passes `home -> results -> checkout`
  - `Romeo Santos` now passes `home -> results -> checkout`
  - `Puscifer` passes `home -> results`, but the target lot is genuinely `Soldout`
