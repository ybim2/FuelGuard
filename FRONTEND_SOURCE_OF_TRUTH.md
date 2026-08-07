# Fuel Guard Frontend Source Of Truth

## Canonical App

The canonical frontend is the root-level mobile-first Fuel Guard PWA. It renders one primary bottom-navigation screen:

- Log

Settings is still part of the canonical app, but it opens from the sticky header settings icon instead of the bottom navigation.

The initial coach-facing beta is a separate route at `/coach/`. It is not a tab inside the athlete Log experience. Keep coach dashboard, roster, and relationship-management UI in the coach route unless the user explicitly asks to merge it elsewhere.

The Settings page includes the permanent marker:

Fuel Guard Mobile PWA
Canonical app: mobile-pwa-v97-coach-beta
Build version: shown from `build-info.js`

The shared top header contains the Fuel Guard logo and a compact settings icon. It remains sticky across the active screens.

## Current Screen Ownership

- Log: default opening screen with current fuel/hydration status including daily log counts, a today-only chronological Fuelling Patterns bar chart, and an expanded Today’s timeline that owns compact Log Fuel, Log Hydration, and Undo actions.
- Settings: account and sync, connected Garmin apps, legacy CSV import, destructive data clearing, app update, app version, and privacy.

Insights, Analysis and Plan are no longer visible product screens. Dormant planning/demand and analysis helper code may remain only where it supports existing records, migrations, Garmin-derived insights, or calculations used by the active screens.

## Removed Legacy Features

These old parked features have been removed from the active app, service worker cache, and visible app shell:

- Fuel Confirmation
- Adherence Log
- Body & Mind
- Nutrition Diary
- Future Ideas Parked
- Settings Bluetooth / live FG Button connection workflow
- Ride Plan
- Food Runway
- Analysis primary screen
- Plan primary screen
- Log tab missed-log card
- Log tab Today’s Context card

Do not reintroduce them unless the user explicitly asks for them.

## Active Files

- `index.html`: static app shell, screen markup, and script/style imports
- `build-info.js`: visible build metadata used by Settings and PWA update checks
- `styles.css`, `mobile-pwa.css`, `mobile-ux-overrides.css`, `fuel-beta.css`: active styles
- `app-state.js`: local app state and persistence helpers
- `fuel-supabase.js`: Supabase Auth plus cloud log, target, and demand-planning sync layer
- `api/supabase-config.js`: Vercel runtime public Supabase config endpoint
- `app-ui.js`: base screen switching and shared UI rendering
- `fuel-beta.js`: canonical mobile PWA behavior for Log and header-accessible Settings
- `fuel-beta-ui-polish.js`: mobile PWA ordering and small UI polish
- `day-type-overrides.js`: day type and training session support
- `fuel-guard-domain.js`: shared Fuel Guard log/status helpers used by the athlete app shell and Coach Beta
- `coach/index.html`, `coach/coach-beta.js`, `coach/coach-beta.css`: separate coach-facing beta dashboard
- `manifest.webmanifest`: PWA manifest
- `sw.js`: service worker and app shell cache
- `app-pwa.js`: service worker registration/update handling
- `vercel.json`: Vercel cache headers for the app shell, manifest, service worker, and build marker
- `icons/icon.svg`: PWA icon
- `FUEL_GUARD_BRAND_SYSTEM.md`: reusable Fuel Guard colour roles and visual identity rules

## Visual Identity

The canonical app uses the Fuel Guard brand tokens documented in `FUEL_GUARD_BRAND_SYSTEM.md` and implemented in `fuel-beta.css`.

Core visual roles:

- Fuel / primary action: warm amber-gold
- Dark / grounding: deep charcoal
- App background: warm off-white
- Surfaces: warm white cards with subtle separation from the app canvas
- Hydration: teal-blue
- Protected state: green
- Suggested fuel times: amber
- Urgent fuelling: orange
- Recovery needed / missed critical state: red
- Inactive / secondary: neutral grey

Use these semantic tokens for navigation, selected states, buttons, progress bars, timelines, charts, cards, empty states, focus states, and status badges. Do not add one-off decorative colours where an existing semantic token fits.

## Deprecated Files

The `deprecated_old_frontends/` folder is retained only as an archive boundary. It is not imported by the canonical PWA.

Do not make future frontend changes in `deprecated_old_frontends/`.

## Local Run

There is no package install or build step. Serve the repository root with a static server:

```sh
python3 -m http.server 8091 --bind 127.0.0.1
```

Then open:

```text
http://127.0.0.1:8091/
```

## Build

No build command is used. This is a static PWA served directly from the repository root.

## Deploy

Deploy the repository root. The `.nojekyll` file indicates the project is safe to serve as a GitHub Pages-style static site without a generated build folder.

No `package.json`, Vite, Next, Netlify, or Firebase config is present in this repo. The `vercel.json` file only sets cache headers for the canonical static PWA. If a build tool is added later, it must point to this canonical root app.

## Mobile PWA Update Rules

1. The canonical app is the mobile PWA with Log in the bottom navigation.
2. The deployed Vercel URL is the source for the installed mobile PWA.
3. Settings must show the canonical marker and build version from `build-info.js`.
4. Service worker caches must be versioned for each app-shell deployment.
5. Old Fuel Guard caches must be cleaned during service worker activation.
6. The installed PWA may need the Settings update action after deploys to check for a waiting service worker and refresh safely.
7. Future frontend work must not ignore PWA cache/update behavior when Safari shows a newer version than the installed iOS PWA.

## Installed/Mobile PWA Updates

When changing deployed frontend files:

1. Bump the cache/app version in `sw.js`.
2. Keep `app-pwa.js` registered to the same versioned service worker URL.
3. Keep `manifest.webmanifest` `start_url` and `scope` pointed at the root canonical app.
4. Update script/style query strings in `index.html` when asset freshness is required.
5. Update `build-info.js` so the Settings build marker changes.
6. Deploy the repository root.
7. Open Settings in Safari and the installed PWA, then compare the build marker.
8. Use Settings > App update > Check for update / Refresh app if the installed PWA is behind.

The current canonical version is `mobile-pwa-v97-coach-beta`.

## Future Frontend Changes

Future Codex chats should make UI changes only in the active files listed above. Before editing UI, verify the rendered app still has the Log bottom tab, with Settings reachable from the sticky header icon.
