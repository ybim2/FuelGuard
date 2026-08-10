# Forerunner 255 physical release acceptance

Candidate version: **0.5.0**

Both public apps remain blocked from Connect IQ submission until every required physical result below is recorded against the exact package hashes in `SUBMISSION_RECORD.md`.

## Prerequisites

- Install the exact Forerunner 255 `.prg` binaries extracted from the signed production-candidate `.iq` packages. The permanent release folder contains friendly `*-fr255.prg` copies and `FR255-SHA256SUMS.txt`; do not rebuild a different candidate for this test.
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

## Quick Log outside Training Mode

1. Log Fuel once, Hydrate once and Sleepy once.
2. Confirm exactly three new events appear in the intended athlete's normal Daily timeline.
3. Confirm the Fuel and Hydration rows have `source = 'garmin'`, the correct owner and distinct stable `external_event_id` values.
4. Confirm Sleepy is represented as the intended Daily check-in and is not counted as Fuel or Hydration.
5. Force one offline/queued retry and confirm it resolves to one row, not a duplicate.

## Quick Log during Training Mode

1. Start a temporary Training Mode session from Quick Log with distinctive Fuel and Hydration preset quantities already configured in Fuel Guard.
2. Log Fuel once and Hydrate once from Quick Log.
3. Confirm both events remain visible in the normal Daily timeline.
4. Confirm both refer to the active Training Mode session.
5. Confirm Fuel inherits the active Fuel preset's carbohydrate, fluid, sodium and caffeine values.
6. Confirm Hydrate inherits the active Hydration preset values.
7. Confirm each physical action created exactly one event.
8. End Training Mode from Quick Log and confirm the same canonical session closes without creating a duplicate session.

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
| Quick Log account connection | PENDING | |
| Activity Logger account connection | PENDING | |
| Quick Log Fuel | PENDING | |
| Quick Log Hydrate | PENDING | |
| Quick Log Sleepy | PENDING | |
| Quick Log retry/idempotency | PENDING | |
| Quick Log Training Mode enrichment | PENDING | |
| Quick Log Training Mode start/end | PENDING | |
| Activity Logger one-LAP Fuel | PENDING | |
| Activity Logger retry/idempotency | PENDING | |
| Activity Logger Training Mode enrichment | PENDING | |

Any failed row blocks public submission.
