# Park Ministry Live

This folder is the shared live subset of Park Ministry that is published to its own private GitHub repository with `git subtree`.

Current scope:

- `Ops - Fulfillment Integration`
- minimal `Shared/` SmartSuite helpers required by fulfillment
- minimal `Workspace/` env and runtime path helpers required by fulfillment

This folder intentionally excludes:

- `Bot - Buying`
- `Bot - Listing`
- `Ops - Sales Tracking`
- personal internal tooling from the main workspace
- `TCG Listing Platform`

## Commands

Run from this folder after it is published as its own repo:

```bash
npm run fulfillment:run
```

```bash
FULFILLMENT_AUTOMATION_LIMIT=25 npm run fulfillment:limited
```

Debug commands:

```bash
npm run debug:fulfillment:preview
```

```bash
npm run debug:fulfillment:validate-pdfs
```

```bash
npm run debug:fulfillment:stubhub
```

## Environment

Copy:

```bash
cp .env.example .env
```

Then fill in:

- `SMARTSUITE_API_TOKEN`
- `SMARTSUITE_ACCOUNT_ID`
- `SMARTSUITE_INVENTORY_TABLE_ID`
- `STUBHUB_POS_API_TOKEN`
- `STUBHUB_POS_ACCOUNT_ID`

## Publishing With Subtree

This folder is the active source of truth for fulfillment. Production and VPS-facing fulfillment changes should be made here, not in the older copy under `Park Ministry Automations/`.

This folder is published from the internal workspace repo using `git subtree`.

Example later:

```bash
git subtree push --prefix "Park Ministry Live" park-live main
```

## Rule

Only shared production-safe fulfillment code should live here.
