# Fuel Guard Frontend Source Of Truth

## Canonical app

The canonical frontend is the root-level mobile-first Fuel Guard PWA. It renders the three main tabs:

- Rhythm
- History
- Settings

The Settings page includes the permanent marker:

Fuel Guard Mobile PWA  
Canonical app version: mobile-pwa-v3-habits

## Removed legacy features

These old parked features have been removed from the active app, service worker cache, and visible app shell:

- Fuel Confirmation
- Adherence Log
- Body & Mind
- Nutrition Diary
- Future Ideas Parked

Do not reintroduce them unless the user explicitly asks for them.

## Active files

- `index.html`: static app shell, screen markup, and script/style imports
- `styles.css`, `mobile-pwa.css`, `mobile-ux-overrides.css`, `fuel-beta.css`: active styles
- `app-state.js`: local app state and persistence helpers
- `app-ui.js`: base screen switching and shared UI rendering
- `fuel-beta.js`: canonical 3-tab mobile PWA behavior for Rhythm, History, and Settings
- `fuel-beta-ui-polish.js`: mobile PWA ordering and small UI polish
- `fuel-history-render-guard.js`: History rendering guard
- `day-type-overrides.js`: day type and training session support
- `fg-button-ble.js`: Fuel Guard BLE button support
- `manifest.webmanifest`: PWA manifest
- `sw.js`: service worker and app shell cache
- `app-pwa.js`: service worker registration/update handling
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

No `package.json`, Vite, Next, Vercel, Netlify, or Firebase config is present in this repo. If one is added later, it must point to this canonical root app.

## Installed/mobile PWA updates

When changing deployed frontend files:

1. Bump the cache/app version in `sw.js`.
2. Keep `app-pwa.js` registered to the same versioned service worker URL.
3. Keep `manifest.webmanifest` `start_url` and `scope` pointed at the root canonical app.
4. Update script/style query strings in `index.html` when asset freshness is required.
5. Deploy the repository root.
6. Open the installed PWA, close and reopen it once if needed, then check Settings for the canonical version marker.

The current canonical version is `mobile-pwa-v3-habits`.

## Future frontend changes

Future Codex chats should make UI changes only in the active files listed above. Before editing UI, verify the rendered app still has the main tabs Rhythm, History, and Settings.
