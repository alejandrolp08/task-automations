# eBay Export Basis

## Current Export Shape

The current export is intentionally aimed at an eBay `Draft` CSV workflow.

This is safer for the MVP because it lets sellers:
- bulk-create listing drafts
- inspect the results inside eBay
- correct titles, pricing, item specifics, or condition details before publishing

## Official Basis

The initial column set is based on eBay Seller Hub Reports documentation for:
- uploadable templates
- create listings in bulk
- item photo URL support in draft uploads

Official references used:
- `Uploadable Templates`
- `Create listings in bulk / Seller Hub Reports`

## What The MVP Export Includes

- `Action`
- `Category ID`
- `Title`
- `Condition ID`
- `Condition Descriptor Name 1`
- `Condition Descriptor Value 1`
- `Format`
- `Duration`
- `Start price`
- `Available quantity`
- `Custom label (SKU)`
- `Item photo URL`
- `Description`

## Important Limitation

The CSV structure is based on eBay's documented bulk template workflow, but the
trading card condition defaults in this MVP are still provisional.

That means:
- the template shape is deliberate
- the CSV is useful for draft generation
- category-specific condition policy values should later be fetched or configured more precisely

## Why Draft First

This first export is not trying to be the final perfect marketplace sync.

It is trying to be:
- understandable
- inspectable
- useful in eBay right away

That gives us a practical bridge between the internal batch workflow and the
later goal of deeper eBay automation.

## Next Export Improvements

- seller-configurable category and condition defaults
- better title templates
- price rules from rarity or future pricing engine
- true stock image URLs from synced Pokemon catalog data
- direct CSV mapping per exact eBay category template
