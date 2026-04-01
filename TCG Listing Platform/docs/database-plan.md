# Database Plan

## Why SQLite First

The product is still in the logic-validation stage.

SQLite is enough for now because it lets us:
- test the real batch workflow locally
- move off mocks quickly
- avoid infrastructure setup too early
- iterate on schema changes fast

## What This Database Must Support

- seller batches
- video and image uploads
- detection results
- review-by-exception workflow
- catalog card references
- export history

## Current Choice

- Prisma ORM
- SQLite for local development

## Later Migration Path

Once the MVP flow is stable, the schema can move to PostgreSQL with minimal
domain changes.

That future phase would likely add:
- real user accounts
- shared team access
- background job coordination
- object storage metadata
- production export tracking

## Immediate Next Tasks

1. install dependencies
2. generate Prisma client
3. push schema to local database
4. add seed data
5. replace mock batch reads with Prisma queries

## Current Progress

The app now has:
- a Prisma schema
- a seed script path
- a repository layer prepared to read from Prisma and fall back to mock data
- a corrected local SQLite path for the schema directory

## Environment Note

Current machine runtime:
- `Node v25.8.1`

Recommended project runtime:
- `Node 22 LTS`

Reason:
- Prisma client generation succeeds
- Prisma schema validation succeeds
- `prisma db push` is still failing with a schema engine error in the current local runtime

The next environment fix should be trying the project again under Node 22 LTS before changing the data model further.

That means the next real unlock is environment setup and running:
- `npm install`
- `npm run db:generate`
- `npm run db:push`
- `npm run db:seed`
