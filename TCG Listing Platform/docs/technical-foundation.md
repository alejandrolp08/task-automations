# Technical Foundation

## Chosen Starting Shape

The project starts as a small workspace:

- root workspace config
- `apps/web` for the user-facing Next.js application
- `packages/` reserved for future shared modules
- `data/` reserved for local development data and import helpers

## Why This Shape

- keeps the product cleanly separated from other projects
- leaves room for future workers, catalog packages, and export logic
- supports a web-first MVP without overengineering the backend too early

## First Build Sequence

1. establish web app shell
2. define data model
3. implement batch creation and upload flow
4. add Pokemon catalog sync
5. add matching and review queue
6. generate eBay CSV export

## Early Backend Direction

The MVP can begin with a single app codebase, then split later if needed.

Suggested near-term additions:
- database with Prisma and PostgreSQL
- storage strategy for uploaded media
- background job processing for video and image analysis
- internal catalog tables for Pokemon cards and sets

## Intentional Delays

These are intentionally postponed until the intake flow is working:
- direct eBay API publishing
- TCGplayer publishing
- automatic condition grading
- multi-game support
- physical hardware integration
