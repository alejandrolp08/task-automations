# Functional Architecture

## System Overview

The first version should be designed as a media-to-inventory pipeline with a review layer and CSV export layer.

## Main Flow

1. User creates a batch
2. User selects intake mode
3. User uploads media
4. Backend processes media into card candidates
5. Matching engine maps candidates to Pokemon catalog entries
6. Low-confidence results enter review queue
7. Approved results become inventory rows
8. Export service generates eBay CSV

## Main Modules

### 1. Batch Management

Responsibilities:
- create seller batch
- track intake mode
- store processing status
- connect uploads, matches, and exports

### 2. Media Intake

Responsibilities:
- accept MP4 uploads
- accept image uploads
- store metadata
- trigger processing jobs

### 3. Candidate Extraction

Responsibilities:
- for videos: split into card events and choose best frame per card
- for images: normalize image input into card candidates
- produce crops or candidate references for matching

### 4. Matching Engine

Responsibilities:
- compare candidates to local Pokemon catalog
- produce best match suggestions
- assign confidence score
- identify likely duplicates

### 5. Review Queue

Responsibilities:
- surface uncertain matches
- allow manual search and correction
- allow approval or rejection

### 6. Inventory Builder

Responsibilities:
- assemble approved matches into listing-ready rows
- group duplicates
- prepare fields needed for CSV export

### 7. CSV Export

Responsibilities:
- format approved inventory as eBay-ready CSV
- include stock image URLs
- support future custom image sources

## Data Sources

Initial upstream source:
- Pokemon TCG API for sets, cards, rarities, and related metadata

Recommended storage strategy:
- keep a local internal catalog database
- sync external data periodically
- do not depend on live API calls during user batch processing

## Suggested Future Modules

- pricing rules engine
- buylist optimizer
- direct marketplace publishing
- captured frame image hosting

## Initial Technical Shape

- monorepo-style workspace
- `apps/web` for the user-facing product
- `packages/` for future shared catalog, matching, and export logic
- local database to be added after UI and flow foundations are in place
