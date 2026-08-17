# GrainLink Site Planner

A site-design suite for planning grain bin storage layouts: a drag-and-drop
yard planner, a cable-length estimator for bin monitoring cables, a bin
specification database, and client-ready PDF report generation. Designs can
be saved locally or synced to Google Drive.

## Features

- **Site Planner** — drag-and-drop canvas for laying out bins, markers, and
  zones with snap-to-grid and snap-to-object alignment, wiring between
  assets, and full keyboard nudge/duplicate/undo support.
- **Cable Length Estimator** — interactive bin cross-section with a
  measurement tool for planning center and radius temperature cable runs,
  with recommended lengths pulled from the bin specification database.
- **Bin Specs** — a searchable database of manufacturer bin models (flat
  bottom and hopper bottom) with capacity, dimensions, and verified cable
  lengths.
- **PDF Reports** — a unified, multi-yard client report combining the site
  layout, cable estimates, and an optional asset directory table.
- **Google Drive sync** — sign in with Google to save/load designs to a
  connected Drive folder, with autosave every minute while a project is
  open.

## Run Locally

**Prerequisites:** Node.js

1. Install dependencies:
   ```
   npm install
   ```
2. Start the dev server:
   ```
   npm run dev
   ```
3. Open the printed local URL in your browser.

## Build

```
npm run build
```

Type-check without emitting:

```
npm run lint
```

## Project Structure

- `src/components/` — the four main views (Dashboard, Site Planner, Cable
  Estimator, Bin Specs) plus shared UI.
- `src/utils/` — PDF generation, Google Drive integration, and shared bin
  math.
- `src/data/` — the bundled bin specification database.
- `server.ts` — a small Express server used for local development and
  serving bin-spec data; not used by the static production deployment.
- `.github/workflows/static.yml` — builds the app with Vite and deploys the
  static output to GitHub Pages.
