# Task Automations Workspace

This workspace contains internal automation projects plus a shared high-level brain.

## Folders

- `TCG Listing Platform/`
  - independent project
  - not part of Park Ministry automations

- `Park Ministry Automations/`
  - Park Ministry operational workspace
  - organized by module:
    - `Bot - Buying`
    - `Bot - Listing`
    - `Ops - Sales Tracking`
    - `Ops - Fulfillment Integration`
    - `Shared`
    - `Workspace`

- `Park Ministry Live/`
  - shared and deployable Park Ministry subset
  - current source of truth for fulfillment

- `BRAIN.md`
  - shared high-level operational brain across the automation projects
  - stays at the workspace root on purpose

## Current Direction

Park Ministry work should happen inside:

- `Park Ministry Automations/`
- `Park Ministry Live/`

TCG work should stay isolated inside:

- `TCG Listing Platform/`

Current Park Ministry infrastructure split:

- `Shared/`
  - reusable business logic
- `Workspace/`
  - bootstrap helpers and runtime path wiring

This keeps unrelated projects separated while allowing only the production-safe Park Ministry subset to be published separately.

Current Park Ministry notes:

- `Bot - Buying` and `Bot - Listing` now run from the new module structure
- commands are intended to be copied and run from the `Task Automations/` root via the `park:*` scripts
- root fulfillment commands now run from `Park Ministry Live/`
- `ListingApp` remains a self-contained app workspace under `Bot - Listing`
- the fulfillment copy inside `Park Ministry Automations/` is now legacy reference only
- fulfillment automation remains active for supported StubHub API cases, while TV / legacy no-`ticketId` cases remain manual
- the Way checkout flow was recently hardened for:
  - branded autocomplete suggestions that still contain the correct address
  - more tolerant time-picker container detection during check-in / checkout selection

## GitHub Workflow

Private repository:

- `https://github.com/alejandrolp08/task-automations`

Working rules from now on:

- run Git commands from:
  - `/Users/alejandroleiva/Documents/Documentos Trabajo/Task Automations`
- keep `main` as the stable branch
- create a new branch first for medium or large bot / script changes
- direct commits to `main` are acceptable only for very small controlled updates

Branch workflow:

```bash
git checkout -b improve/buying-bot
git add .
git commit -m "Describe the change"
git push -u origin improve/buying-bot
```

Direct workflow on `main`:

```bash
git add .
git commit -m "Describe the change"
git push
```
