# Fuel Guard Frontend Source Of Truth

## Canonical app

The canonical frontend is the root-level mobile-first Fuel Guard PWA. It renders the four main bottom-navigation tabs:

- Log
- Plan
- History
- Trends

Settings is still part of the canonical app, but it opens from the sticky header settings icon instead of the bottom navigation.

The Settings page includes the permanent marker:

Fuel Guard Mobile PWA
Canonical app: mobile-pwa-v79-brand-identity
Build version: shown from `build-info.js`

The shared top header contains the Fuel Guard logo and a compact settings icon. It remains sticky across the active screens.

Current card ownership:

- Log: current fuelling status, quick fuel/hydration/low-energy logging, and today's logs.
- Plan: selected day setup, Today/Work/Training/Targets subtabs, flexible break estimates, protected fuel times, fuelling window length, and daily targets with calculated weekly targets.
- History: compact daily summary cards with full day detail for logged days.
- Trends: Fuel Score, Personalised Insights, seven-day Fuel Debt, demand adherence, weekly trend review, graph comparisons, and actual-versus-target weekly progress.
- Settings: risk thresholds, account sync, import, update, app metadata, and support copy.

## Removed legacy features

These old parked features have been removed from the active app, service worker cache, and visible app shell:

- Fuel Confirmation
- Adherence Log
- Body & Mind
- Nutrition Diary
- Future Ideas Parked
- Settings Bluetooth / live FG Button connection workflow
- Ride Plan
- Food Runway

Do not reintroduce them unless the user explicitly asks for them.

## Active files

- `index.html`: static app shell, screen markup, and script/style imports
- `build-info.js`: visible build metadata used by Settings and PWA update checks
- `styles.css`, `mobile-pwa.css`, `mobile-ux-overrides.css`, `fuel-beta.css`: active styles
- `app-state.js`: local app state and persistence helpers
- `fuel-supabase.js`: Supabase Auth plus cloud log, target, and demand-planning sync layer
- `api/supabase-config.js`: Vercel runtime public Supabase config endpoint
- `app-ui.js`: base screen switching and shared UI rendering
- `fuel-beta.js`: canonical 4-tab mobile PWA behavior for Log, Plan, History, Trends, and header-accessible Settings
- `fuel-beta-ui-polish.js`: mobile PWA ordering and small UI polish
- `day-type-overrides.js`: day type and training session support
- `manifest.webmanifest`: PWA manifest
- `sw.js`: service worker and app shell cache
- `app-pwa.js`: service worker registration/update handling
- `vercel.json`: Vercel cache headers for the app shell, manifest, service worker, and build marker
- `icons/icon.svg`: PWA icon
- `FUEL_GUARD_BRAND_SYSTEM.md`: reusable Fuel Guard colour roles and visual identity rules

## Visual identity

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

Use these semantic tokens for navigation, Plan subtabs, selected states, buttons, progress bars, timelines, charts, cards, empty states, focus states, and status badges. Do not add one-off decorative colours where an existing semantic token fits.

## Deprecated files

The `deprecated_old_frontends/` folder is retained only as an archive boundary. It is not imported by the canonical PWA.

Do not make future frontend changes in `deprecated_old_frontends/`.

## Local run

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

## Mobile PWA update rules

1. The canonical app is the 4-tab mobile PWA with Log, Plan, History, and Trends in the bottom navigation.
2. The deployed Vercel URL is the source for the installed mobile PWA.
3. Settings must show the canonical marker and build version from `build-info.js`.
4. Service worker caches must be versioned for each app-shell deployment.
5. Old Fuel Guard caches must be cleaned during service worker activation.
6. The installed PWA may need the Settings update action after deploys to check for a waiting service worker and refresh safely.
7. Future frontend work must not ignore PWA cache/update behavior when Safari shows a newer version than the installed iOS PWA.

## Installed/mobile PWA updates

When changing deployed frontend files:

1. Bump the cache/app version in `sw.js`.
2. Keep `app-pwa.js` registered to the same versioned service worker URL.
3. Keep `manifest.webmanifest` `start_url` and `scope` pointed at the root canonical app.
4. Update script/style query strings in `index.html` when asset freshness is required.
5. Update `build-info.js` so the Settings build marker changes.
6. Deploy the repository root.
7. Open Settings in Safari and the installed PWA, then compare the build marker.
8. Use Settings > App update > Check for update / Refresh app if the installed PWA is behind.

The current canonical version is `mobile-pwa-v79-brand-identity`.

## Future frontend changes

Future Codex chats should make UI changes only in the active files listed above. Before editing UI, verify the rendered app still has the main bottom tabs Log, Plan, History, and Trends, with Settings reachable from the sticky header icon.
