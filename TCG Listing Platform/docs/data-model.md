# Initial Data Model

## Goal

Define the first backend-ready domain model for the Pokemon MVP before adding a real database.

## Core Entities

### Batch

Represents one seller workflow from intake through export.

Suggested fields:
- `id`
- `name`
- `seller_label`
- `game`
- `intake_mode`
- `status`
- `item_count`
- `review_count`
- `export_ready`
- `created_at`
- `updated_at`

### Upload

Represents a media payload attached to a batch.

Suggested fields:
- `id`
- `batch_id`
- `kind`
- `file_name`
- `storage_key`
- `status`
- `duration_seconds`
- `image_count`
- `uploaded_at`

### Detection

Represents one detected card candidate from processed media.

Suggested fields:
- `id`
- `batch_id`
- `upload_id`
- `source_label`
- `suggested_card_id`
- `confidence`
- `status`
- `notes`
- `created_at`

### Review Item

Represents a detection that needs manual confirmation.

Suggested fields:
- `id`
- `batch_id`
- `detection_id`
- `suggested_match_label`
- `reason`
- `state`
- `resolved_card_id`
- `resolved_at`

### Catalog Card

Represents the locally stored Pokemon card catalog entry used by matching.

Suggested fields:
- `id`
- `external_source`
- `external_card_id`
- `name`
- `set_name`
- `set_code`
- `card_number`
- `rarity`
- `image_small_url`
- `image_large_url`
- `raw_source_json`
- `synced_at`

## Batch State Flow

- `draft`
- `processing`
- `review`
- `ready`
- `exported`

## Detection State Flow

- `matched`
- `needs_review`
- `rejected`

## Why This Model

This gives us the right base for:
- video and image intake
- background processing jobs
- review by exception
- CSV export history
- future direct marketplace publishing

## Current Implementation Status

This model has now been translated into a first Prisma schema using a local
SQLite database for development.

Files:
- `prisma/schema.prisma`
- `.env.example`

## Next Step

Move from schema-only to a usable local backend:
- install Prisma dependencies
- generate the client
- push the local schema
- add initial seed data for Pokemon batches and catalog references
