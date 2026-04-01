# TCG Listing Platform

Web platform for Pokemon card sellers to turn a single video or multiple card images into a reviewable inventory and eBay-ready CSV export.

## Current Product Direction

Initial focus:
- Pokemon only
- Web only
- Video upload as the main differentiator
- Multi-image upload as a secondary intake path
- Stock catalog images for initial eBay CSV generation
- Manual review flow for low-confidence matches

## Core Promise

Upload your Pokemon cards your way:
- one video
- multiple scans or photos

Then review matched cards, fix doubtful matches, and export a listing-ready CSV for eBay.

## MVP Goals

- Accept one Pokemon batch as video or images
- Detect cards from uploaded media
- Match cards against a local Pokemon catalog
- Flag uncertain matches for manual correction
- Generate a clean inventory batch
- Export an eBay-friendly CSV using stock images

## Project Structure

- `apps/web/`
  Next.js web application
- `docs/`
  Product, MVP, and architecture notes
- `packages/`
  Shared logic and future reusable modules
- `data/`
  Local development data and import references

## Near-Term Priorities

1. Define product flow and data model
2. Design Pokemon catalog sync strategy
3. Design media intake pipeline
4. Define review workflow
5. Define eBay CSV export schema
6. Replace mock workflow data with a real database model

## Local Development

This project is scaffolded as a small workspace with a web app in `apps/web`.

Recommended runtime:
- `Node 22 LTS`

Planned commands:
- `npm install`
- `npm run dev`
- `npm run build`
- `npm run db:generate`
- `npm run db:push`
- `npm run db:init`
- `npm run db:seed`

Note:
- The project scripts now force `node@22` from Homebrew so local development stays on a compatible runtime.
- `prisma db push` remains unreliable in this environment, so `npm run db:init` creates the local SQLite schema from the Prisma datamodel SQL diff.
