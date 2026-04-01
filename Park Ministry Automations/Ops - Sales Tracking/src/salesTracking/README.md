# Ops - Sales Tracking

This folder contains the Park Ministry sales tracking workflow.

## Purpose

The sales tracking script:

1. reads candidate sale information
2. normalizes email / inventory / sale data
3. maps sales back into SmartSuite inventory
4. updates the inventory table after a sale is confirmed

## Current Layout

- `runSalesTracking.js`
  - main runner
- `fetchSalesTrackingCandidates.js`
  - SmartSuite candidate intake
- `normalizeSmartsuiteSaleInventory.js`
  - SmartSuite inventory normalization
- `normalizeSalesTracking.js`
  - common sale normalization
- `selectSaleCandidates.js`
  - sale candidate matching
- `applySaleToSmartSuite.js`
  - SmartSuite write-back
- `parseViagogoSaleEmail.js`
  - email parsing helper
- `smartsuiteSalesConfig.js`
  - sales tracking field mapping

## Runtime

Runtime files should live under:

- `Ops - Sales Tracking/runtime/`

## Current dependency boundary

- this module should use `Shared/` for generic SmartSuite access
- it should not depend directly on `Bot - Buying` for shared infrastructure
- email parsing and reconciliation logic remain local to `Ops - Sales Tracking`

## Apps Script reference

The legacy/live Gmail-oriented Apps Script reference is intentionally preserved here:

- `Ops - Sales Tracking/runtime/outputs/APPS_SCRIPT_PRODUCTION_REFERENCE.md`

That file is a copy/paste production reference, while the maintained Node logic lives in this module source tree.
