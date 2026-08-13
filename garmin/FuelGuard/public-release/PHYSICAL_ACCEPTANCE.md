# Forerunner 255 physical release acceptance

Candidate version: **0.5.5**

The original signed Quick Log 0.5.1 package with SHA-256 `d9b6561551e5a2ab62b28bc8d3ab159322d995284d07f7ec0da76cf9a273484a` and the first signed replacement with SHA-256 `33c6beb99a9518ceb4e5ec501de1620dce1de4e490fb2603bda24ae871f36c23` both failed physical acceptance with delayed `IQ!` after connection. Both are permanently marked not releasable. Version 0.5.2 was then physically blocked because the disconnected Quick Log screen displayed `Press START` without handling the raw Garmin `KEY_START` input. Version 0.5.3 added the Quick Log raw-key path; version 0.5.4 applies the same shared START/ENTER mapping to both public apps while preserving the existing OAuth flow.

## Production database dependency — not yet applied

Production project `kwnfbdoxppiajrnkejjk` has the Athlete Training Mode schema but is missing the two accepted Garmin command migrations below. They must be applied once, in this exact order, under a separate explicit Production authorisation before the Store-delivered watch start/end test can pass:

1. `20260810091806_garmin_training_mode_commands`
2. `20260810100500_garmin_training_mode_command_hardening`

This completion branch does not apply either migration and does not modify Production data or configuration.

## Prerequisites

- Install or update the exact public candidate through its existing Connect IQ Store listing after the upload has been explicitly authorised and Garmin has made that version available. USB `.prg` sideloading is not the physical acceptance route.
- Keep the Connect IQ Store mobile app installed, signed in and allowed to open notifications.
- Sign in to the intended Fuel Guard athlete account on the phone.
- Use temporary events where practical; do not alter another athlete's data.

## Account connection — repeat for both apps

1. Start `Connect Fuel Guard` on the watch.
2. Confirm the watch says `Open Connect IQ on phone`.
3. Open the notification in the **Connect IQ Store** mobile app.
4. Confirm the Fuel Guard approval page opens for the correct app.
5. Sign in and approve.
6. Confirm the browser returns through the Garmin `connectiq://oauth` callback.
7. Confirm the watch advances through `Completing connection` to `Connected`.
8. Record the result and exact failure status if any.

## Connected-runtime recovery status

- Known-good physical beta reference: `1be8d5fcef55f380bd5fa9a8b6ced166e6bf1c89`, after the original runtime and timestamp crash fixes and before source consolidation.
- The 0.5.1 physical result proves the new `onAuthenticationRequest()` callback path works and must remain.
- The connected public app introduced a Training Mode status request that could let a request-start exception escape during `onShow()` or `onUpdate()`. The known-good runtime guarded request startup instead of allowing an exception to terminate the app.
- Source consolidation also removed the known-good defensive Glance state-render fallback.
- The first isolated source recovery restored both safety boundaries without moving network work into `onStart()`, removing actions, or changing queue/idempotency behavior, but its signed replacement still failed physically after the connected UI appeared.
- The delayed failure matched the Training status response timing. Its callback required `(responseCode, data, context)`, but its `makeWebRequest()` options did not provide `:context`. Garmin SDK 9.2.0 documents that the third callback argument is supplied only when `:context` is populated.
- The corrected source now pairs the Training callback with explicit request context, matching the physically known-good `FuelGuardApi` and `FuelGuardHealthApi` pattern. The same audit also corrected the latent revoke callback mismatch.
- Version 0.5.2 source validation: 31-product simulator matrix **1,953/1,953**; full Node **391/391**; isolated Garmin command/RLS pgTAP **26/26**.
- Quick Log now leaves the last confirmed active state unchanged while start/end is queued, changes it only after an authoritative command/status response, retains failed commands for idempotent retry, and never shows a successful start/end solely because the watch queued the action.
- Fuel Guard Athlete performs a bounded authenticated foreground read of canonical Training sessions while visible, adopts Garmin starts/stops without a reload, and discards stale responses after an account switch.

## Quick Log outside Training Mode

1. Log Fuel once, Hydrate once and Sleepy once.
2. Confirm exactly three new events appear in the intended athlete's normal Daily timeline.
3. Confirm the Fuel and Hydration rows have `source = 'garmin'`, the correct owner and distinct stable `external_event_id` values.
4. Confirm Sleepy is represented as the intended Daily check-in and is not counted as Fuel or Hydration.
5. Force one offline/queued retry and confirm it resolves to one row, not a duplicate.

## Quick Log during Training Mode

1. Start a temporary Training Mode session from Quick Log with distinctive Fuel and Hydration preset quantities already configured in Fuel Guard.
2. Confirm the watch shows a queued/starting state until the backend response and only then shows Training Mode active.
3. Confirm the already-open Fuel Guard Athlete app enters Training Mode without a reload.
4. Log Fuel once and Hydrate once from Quick Log.
5. Confirm both events remain visible in the normal Daily timeline.
6. Confirm both refer to the active Training Mode session.
7. Confirm Fuel inherits the active Fuel preset's carbohydrate, fluid, sodium and caffeine values.
8. Confirm Hydrate inherits the active Hydration preset values.
9. Confirm each physical action created exactly one event.
10. End Training Mode from Quick Log; confirm the watch remains confirmed-active while end is pending, then confirms completion only after the backend response.
11. Confirm the same canonical session closes, Athlete exits Training Mode without a reload, and no duplicate session appears.

## Activity Logger outside Training Mode

1. Add Fuel Guard Activity Logger to a Run activity.
2. Disable Auto Lap on the Forerunner 255.
3. Start Run and press LAP once.
4. Confirm the Garmin acknowledges the Fuel Guard action.
5. Finish and sync the activity.
6. Confirm exactly one new Fuel Guard event exists with `source = 'garmin'`, the correct athlete and a stable `external_event_id`.
7. Retry/sync again and confirm no duplicate appears.

## Activity Logger during Training Mode

1. Start a temporary Training Mode session with a distinctive Fuel preset.
2. Start the Garmin activity and press LAP once.
3. Finish/sync and confirm exactly one Fuel event.
4. Confirm the event refers to that Training Mode session and contains its Fuel preset quantities.
5. Confirm the event also remains visible in the normal Daily timeline.

## Gate record

| Gate | Result | Evidence/notes |
| --- | --- | --- |
| Quick Log account connection | PASS | Physical FR255 OAuth completed against public 0.5.1 candidate. |
| Quick Log device registration/details | PASS | Fuel Guard displayed the connected watch/device details. |
| Quick Log connected runtime | PENDING USER HARDWARE SPOT-CHECK 0.5.5 | Both 0.5.1 packages displayed delayed `IQ!`; the corrected runtime remains present. |
| Quick Log disconnected START action | PENDING USER HARDWARE SPOT-CHECK 0.5.5 | Raw `KEY_START` now invokes the same existing OAuth path as the selection behavior. |
| Activity Logger account connection | PENDING | |
| Quick Log Fuel | PENDING | Replacement Store candidate. |
| Quick Log Hydrate | PENDING | Replacement Store candidate. |
| Quick Log Sleepy | PENDING | Replacement Store candidate. |
| Quick Log retry/idempotency | PENDING | Replacement Store candidate. |
| Quick Log Training Mode enrichment | PENDING | Replacement Store candidate. |
| Quick Log Training Mode start/end | PENDING | Replacement Store candidate. |
| Activity Logger one-LAP Fuel | PENDING | |
| Activity Logger retry/idempotency | PENDING | |
| Activity Logger Training Mode enrichment | PENDING | |

Both physically failed 0.5.1 Quick Log packages and the physically blocked 0.5.2 package are not releasable. Version 0.5.5 is the next Store-delivered hardware spot-check candidate; it preserves the accepted 0.5.4 connect path and updates Fuel Guard-owned artwork to the canonical mark. All advertised products must remain source/build/package compatible.
