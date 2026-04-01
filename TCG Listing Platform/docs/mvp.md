# MVP Scope

## Goal

Build a web MVP that lets a user upload either:
- a single video of Pokemon cards shown one by one
- multiple scans or photos of Pokemon cards

The system should process those inputs into a reviewable inventory batch and export a CSV for eBay listing preparation.

## Input Modes

### 1. Video Mode

User flow:
1. Review capture instructions
2. Upload one MP4 video
3. Wait for processing
4. Review detected cards
5. Correct doubtful matches
6. Export CSV

Video assumptions for MVP:
- one card shown at a time
- frontal view only
- stable top-down or near top-down capture
- good lighting
- plain background
- brief pause before moving to the next card

### 2. Image Mode

User flow:
1. Upload multiple card images
2. Wait for processing
3. Review detected cards
4. Correct doubtful matches
5. Export CSV

Image assumptions for MVP:
- one card per image
- card fills a meaningful portion of the frame
- front side only
- acceptable sharpness and lighting

## Core MVP Features

- batch creation
- media upload
- media processing status
- card candidate extraction
- Pokemon card matching
- confidence scoring
- manual correction workflow
- duplicate grouping
- inventory batch view
- eBay CSV export
- stock catalog image support

## Success Criteria

- user can upload media without friction
- system produces a mostly correct card list
- doubtful matches are easy to fix manually
- user receives a usable CSV export for eBay workflow preparation

## V1 Questions To Answer

- what minimum match confidence is acceptable
- how much manual correction is tolerable per 100 cards
- whether users prefer video or image mode in practice
- whether stock images are enough for initial adoption
- which eBay CSV columns should be fully automated first

