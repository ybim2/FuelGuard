# Athlete Performance Impact — Phase 1 methodology

## Architecture

The canonical Athlete PWA gains a third `Impact` surface beside Daily and Training. Daily remains action-focused. `athlete-impact.js` owns setup, outcome entry, session feedback and reporting; reusable calculations live in `fuel-guard-domain.js`.

Three additive Supabase tables are the durable source of truth:

- `fuel_performance_metrics`: up to three active athlete outcomes. Active slots 1–3 enforce the maximum. Archiving a metric keeps all history.
- `fuel_performance_results`: dated, source-labelled observations. Phase 1 client writes are `athlete_entry`; Garmin/import sources are reserved for trusted future adapters.
- `fuel_training_feedback`: one optional Strong/Normal/Low energy and Yes/Partially/No completion response per completed workout.

All three tables use explicit authenticated grants and owner-only RLS. No Coach or organisation policy is added in Phase 1, so existing Athlete → Coach → Organisation access cannot widen. Composite ownership keys and immutable identity triggers prevent cross-athlete repointing. The schema is ready for later, permissioned Coach/Performance read services without changing record identity.

Existing evidence is reused rather than copied:

- `fuel_logs` supplies Fuel/Hydration coverage and within-day gap evidence.
- completed `fuel_training_mode_sessions` and `garmin_activity_summaries` adapt through `FuelGuardDomain.normalizeWorkout`.
- `getWorkoutFuelContexts` supplies strict nearest Fuel events before and after each completed session.
- the athlete's existing maximum fuel-gap target is the long-gap and pre/post target.

Phase 2 Garmin-derived pace/heart-rate or power/heart-rate efficiency is deliberately deferred. The current Garmin summary table has duration and distance but not the validated heart-rate, power, elevation, intensity and environmental fields required for defensible comparable-session analysis.

## Baselines and comparison windows

Outcome baseline:

- The earliest dated result for a metric is its Baseline. Athletes can add a genuine historical result to establish a pre-Fuel-Guard baseline.
- Current is the latest dated result.
- A direction is withheld until there are at least two results at least 14 calendar days apart.
- A target-range outcome improves when its distance from the configured range reduces; it declines when that distance increases.
- A numeric change below both 1% of the baseline magnitude and 0.01 stored units is Stable.

Rolling report:

- The default report is the 42 calendar days ending today in the device's IANA timezone.
- Baseline window is days 1–14. Current window is days 29–42. Days 15–28 are an observation buffer and are included in total evidence counts but not either comparison average.
- A 12-week report uses the same first-14/last-14 comparison. “Since first evidence” begins at the earliest valid log, completed workout, result or feedback and also compares its first and last 14 days.
- A full first and last window is required. Until then the UI says `Building your baseline` or `Not enough comparable data yet`.

Fuelling behaviour evidence:

- Fuel and Hydration coverage are calendar days with at least one matching event divided by 14 eligible days.
- A measurable gap day contains at least two Fuel events. Its maximum is the longest valid same-day interval between consecutive Fuel events; intervals over 18 hours are rejected as incomplete-day artefacts.
- Average maximum daily gap and long-gap rates require at least five measurable days in both windows.
- Pre/post-training coverage uses completed, deduplicated workout contexts. Pre is covered when the strict prior Fuel event is within the athlete's target. Post is covered when the strict next Fuel event is within target and on the same local calendar day.
- Pre and post comparisons each require at least three completed sessions in both windows.

Training-experience evidence:

- Feedback is optional and athlete-entered.
- Low-energy rate is `Low energy` responses divided by feedback responses.
- Completion rate is `Yes` responses divided by feedback responses; `Partially` and `No` remain visible evidence rather than being silently treated as complete.
- Each comparison requires at least three feedback responses in both windows.

## Visible directions

Each eligible visible signal is classified independently:

- Coverage improves/declines at a change of at least 10 percentage points.
- Pre/post coverage improves/declines at a change of at least 15 percentage points.
- Low-energy or completion rate improves/declines at a change of at least 15 percentage points in the favourable direction.
- Long-gap rate improves/declines at a relative change of at least 25%; average maximum gap uses 15 minutes.
- Performance outcomes use their configured direction and the 1%/0.01 stability band above.

A component is:

- `Strong improvement` when two or more eligible signals improve and none decline.
- `Improving` when improvements outnumber declines.
- `Mixed` when both improving and declining signals exist without a majority.
- `Stable` when all eligible signals are stable.
- `Declining` when declines outnumber improvements.
- `Insufficient evidence` when no signal meets its sample rule.

Overall evidence is not a score:

- `Insufficient evidence`: fewer than two eligible components.
- `Strong positive trend`: at least two improving components, no declining/mixed component, and at least one component is Strong improvement.
- `Positive trend`: improving components outnumber declining components and there is no mixed component.
- `Negative trend`: one or more declining components and no improving or mixed component.
- `Stable`: every eligible component is Stable.
- `Mixed evidence`: every other eligible combination, including simultaneous positive and negative directions.

Every report exposes days, workouts, feedback responses and performance-result counts. Summary copy uses “during the same period”, “improved alongside” and “associated with”; it never presents observational change as causation.
