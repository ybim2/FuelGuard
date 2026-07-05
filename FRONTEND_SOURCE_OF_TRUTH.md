# Fuel Guard Frontend Source Of Truth

## Canonical app

The canonical frontend is the root-level mobile-first Fuel Guard PWA. It renders the four main tabs:

- Rhythm
- Daily
- Trends
- Settings

The Settings page includes the permanent marker:

Fuel Guard Mobile PWA
Canonical app: mobile-pwa-v14-risk-thresholds
Build version: shown from `build-info.js`

## Removed legacy features

These old parked features have been removed from the active app, service worker cache, and visible app shell:

- Fuel Confirmation
- Adherence Log
- Body & Mind
- Nutrition Diary
- Future Ideas Parked
- Settings Bluetooth / live FG Button connection workflow

Do not reintroduce them unless the user explicitly asks for them.

## Active files

- `index.html`: static app shell, screen markup, and script/style imports
- `build-info.js`: visible build metadata used by Settings and PWA update checks
- `styles.css`, `mobile-pwa.css`, `mobile-ux-overrides.css`, `fuel-beta.css`: active styles
- `app-state.js`: local app state and persistence helpers
- `fuel-supabase.js`: Supabase Auth and cloud log sync layer
- `api/supabase-config.js`: Vercel runtime public Supabase config endpoint
- `app-ui.js`: base screen switching and shared UI rendering
- `fuel-beta.js`: canonical 4-tab mobile PWA behavior for Rhythm, Daily, Trends, and Settings
- `fuel-beta-ui-polish.js`: mobile PWA ordering and small UI polish
- `fuel-history-render-guard.js`: History rendering guard
- `day-type-overrides.js`: day type and training session support
- `manifest.webmanifest`: PWA manifest
- `sw.js`: service worker and app shell cache
- `app-pwa.js`: service worker registration/update handling
- `vercel.json`: Vercel cache headers for the app shell, manifest, service worker, and build marker
- `icons/icon.svg`: PWA icon

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

1. The canonical app is the 4-tab mobile PWA with Rhythm, Daily, Trends, and Settings.
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

The current canonical version is `mobile-pwa-v14-risk-thresholds`.

## Future frontend changes

Future Codex chats should make UI changes only in the active files listed above. Before editing UI, verify the rendered app still has the main tabs Rhythm, Daily, Trends, and Settings.
