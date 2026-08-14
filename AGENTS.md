Fuel Guard project instructions
===============================

Source of truth
---------------

The canonical Fuel Guard app is the mobile-first PWA with these main bottom tabs:

- Log
- History

Settings opens from the sticky top header.

Do not use, recreate, or rebuild from the old web PWA design. Do not edit archived or deprecated frontend versions. Do not create a new frontend unless the user explicitly asks for one.

All UI work must be applied to the canonical mobile PWA. Account/login setup belongs inside Settings unless explicitly changed. Today’s status, today-only Fuelling Patterns and the expanded timeline with compact fuel/hydration/undo actions belong on Log. Week/month pattern review belongs in History, not in a new desktop-style frontend.

Before making UI changes, confirm the canonical entry point and active components. Keep the current mobile-first design style.

Removed legacy features
-----------------------

These old parked features have been removed from the active app and must not be reintroduced unless the user explicitly asks for them:

- Fuel Confirmation
- Adherence Log
- Body & Mind
- Nutrition Diary
- Future Ideas Parked
- Log tab missed-log card
- Log tab Today’s Context card

Mobile PWA update rules
-----------------------

- The canonical app is the mobile PWA with Log and History in bottom navigation, plus Settings from the sticky header.
- The deployed Vercel URL is the source for the installed mobile PWA.
- Settings must show the canonical marker and current build version so Safari and the installed PWA can be compared after deploys.
- Service worker caches must be versioned for every deployed app-shell update.
- Old Fuel Guard service worker caches must be cleaned during activation without clearing localStorage user logs.
- The installed PWA may need the Settings update action after deploys to check for a waiting service worker and refresh safely.
- Future Codex chats must inspect PWA cache/update behavior before assuming a visible Vercel update has reached installed iOS PWAs.

Preview-first development and release workflow
----------------------------------------------

- Never merge directly to `main` merely so an update can be reviewed.
- Implement every feature, bug fix, or UX change on a separate feature branch.
- Push the reviewable branch and provide a working Vercel Preview deployment that can be opened on desktop and mobile before requesting Production approval.
- Keep requested review fixes on that same branch and update its Preview deployment.
- Successful tests and builds mean the branch is ready for review; they are not permission to merge or deploy Production.
- Merge to `main` and allow the normal Production deployment only after the user explicitly approves the exact Preview state.
- Once the exact Preview is approved, proceed with the normal merge without restarting redundant verification unless a new blocker or material risk appears.
- Keep Preview database changes isolated from Production wherever practical. Clearly identify any migration that will be required only at the approved Production release step.
- If authentication or another external integration cannot function on a Preview domain, report the exact callback or configuration limitation instead of merging to Production to test it.
- Completion reports for reviewable work must include the branch, Preview URL, validation results, and `Production status: Not merged. Awaiting preview approval.`

Canonical files
---------------

- Main entry point: `index.html`
- App/root component: the static `body.beta-mvp` app shell in `index.html`
- Routing/navigation: `index.html` nav buttons, base `switchScreen` in `app-ui.js`, and mobile PWA overrides in `fuel-beta.js`
- Log screen: `#dashboard` in `index.html`, behavior in `fuel-beta.js`, support state in `app-state.js`, styling in `fuel-beta.css`, `mobile-pwa.css`, and `mobile-ux-overrides.css`; the fuel/hydration/undo actions live compactly inside Today’s Timeline and Fuelling Patterns uses today’s fuel logs only.
- History screen: `#history` in `index.html`, compact week/month navigation plus Fuel Log Frequency, First Fuel Time, Final Fuel Time and Most Common Fuel-Gap Window graphs in `fuel-beta.js`
- Settings screen: `#checklist` in `index.html`, behavior in `fuel-beta.js` and `fuel-beta-ui-polish.js`
- PWA manifest: `manifest.webmanifest`
- Service worker/PWA config: `sw.js` and registration in `app-pwa.js`
- Build command: none; this is a static PWA
- Deploy output folder: repository root

Deprecated files
----------------

Old or unused frontend files belong in `deprecated_old_frontends/`. They must not be imported by `index.html`, included in `sw.js`, or targeted by deployment.

Garmin release and worktree rules
---------------------------------

- Temporary worktrees under `/private/tmp`, `/tmp`, or another disposable path may be used only as scratch space.
- Final commits must be pushed to GitHub before a temporary worktree is treated as preserved.
- Final Garmin IQ release artifacts must be exported to persistent local storage, not left only inside a temporary worktree.
- Never leave the only usable Garmin beta build under `/private/tmp` or `/tmp`.
- Always report both the source build paths and the permanent exported IQ paths.
- Never reset, clean, modify, or discard unrelated dirty local worktrees while integrating Garmin work.
- After merging a Garmin release to `main`, synchronize from `origin/main` and rebuild final IQ packages from that merged main commit.
- Do not commit secrets, Garmin developer keys, Vercel secrets, Supabase service keys, token values, generated `.prg` files, or generated `.iq` packages.
