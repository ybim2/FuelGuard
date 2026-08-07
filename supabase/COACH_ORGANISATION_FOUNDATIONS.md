# Coach organisational foundations

Apply `migrations/20260807172400_coach_organisation_foundations.sql` after the existing Fuel Guard log, target, and Coach Beta schemas.

Apply `migrations/20260807181022_coach_relationship_identity_hardening.sql` afterwards. It makes coach/athlete relationship IDs immutable, preserves sharing audit rows through revocation, and keeps revoked team-roster rows manageable for an authorised reactivation.

## Authorization invariant

Organisation, team, saved-group, and training-assignment rows are context only. They never grant access to athlete data.

Staff access to an athlete requires all of the following at query time:

1. an active organisation membership;
2. an active staff membership for the relevant team with the required access level;
3. an active athlete membership for that team; and
4. an active `fuel_coach_athletes` share from the signed-in staff user to the athlete.

If the direct share is revoked, existing saved-group membership and session-assignment rows remain as organisational records but stop being visible to that staff user. The same revocation continues to be enforced by the existing RLS on `fuel_logs` and `fuel_targets`.

No new policy reads Garmin authorization sessions, device tokens, raw Garmin samples, or Garmin-derived features. Garmin credentials remain server-only and Garmin data retains its existing athlete-only boundary.

## Staff and shared notes

- `fuel_organisations`: top-level tenant. Creating one automatically adds its creator as an owner.
- `fuel_organisation_members`: owner/admin/staff directory and revocation state.
- `fuel_teams`: team and IANA timezone. Creating one automatically adds its creator as a team manager.
- `fuel_team_staff`: job role plus `viewer`, `contributor`, or `manager` access.
- `fuel_team_athletes`: team context; it does not replace athlete sharing consent.
- `fuel_staff_notes`: immutable, audit-friendly staff context. The server trigger records the authenticated author's ID, display-name snapshot, and timestamp. Notes can be selected or inserted, not edited or deleted through the authenticated Data API.

Insert a note with the signed-in Supabase client:

```js
await supabase.from("fuel_staff_notes").insert({
  organisation_id: organisationId,
  team_id: teamId,
  athlete_id: athleteId,
  author_id: user.id,
  category: "travel_plan",
  note_text: "Travel plan adjusted."
});
```

Query by both team and athlete so Postgres can use the composite index as well as RLS:

```js
await supabase
  .from("fuel_staff_notes")
  .select("id,athlete_id,author_id,author_display_name,category,note_text,created_at")
  .eq("team_id", teamId)
  .eq("athlete_id", athleteId)
  .order("created_at", { ascending: false });
```

## Saved groups

`fuel_saved_groups` supports two scopes:

- `personal`: set `coach_id` to the signed-in coach; leave organisation/team null.
- `team`: set organisation/team; leave `coach_id` null.

Use `fuel_saved_group_members` to add or remove athletes. RLS re-checks direct athlete sharing on every read, insert, and delete. For roster and analytics filters, use the security-invoker view `fuel_authorised_group_roster`:

```js
const { data: roster } = await supabase
  .from("fuel_authorised_group_roster")
  .select("group_id,scope,organisation_id,team_id,athlete_id,added_at")
  .eq("group_id", groupId);
```

The returned athlete IDs are the current user's authorised intersection, so both “Needs Attention — First Team” and “Team Patterns — Academy” can feed the existing operational/analytics code with the same filtered IDs. Do not use group membership as a substitute for querying athlete tables under their own RLS.

## Training sessions

`fuel_training_sessions` is the canonical schedule record. Store:

- the absolute `starts_at`/`ends_at` instants as `timestamptz`;
- the IANA `timezone_name` used by the team; and
- `session_date` as the start's local calendar date in that timezone.

The database rejects invalid timezone names, reversed/over-24-hour ranges, and a `session_date` that does not match the timezone-local start date.

Manual Data API inserts default to `source = 'manual'`. Authenticated clients cannot insert external-source provenance columns. Future server-side adapters can map provider records into the same table with:

- `source = 'external_provider'`;
- a stable provider namespace in `source_provider`; and
- the provider's stable ID in `external_session_id`.

The partial unique index on those two adapter fields makes retries idempotent. Provider credentials do not belong in this table or in browser code.

Assignments are explicit rows in `fuel_training_session_athletes`. A session's optional `saved_group_id` is categorisation/provenance, not an implicit authorization or assignment grant. To snapshot the currently authorised members of that group into assignments:

```js
await supabase.rpc("fuel_assign_training_session_group", {
  p_session_id: sessionId,
  p_group_id: groupId
});
```

List sessions visible to the signed-in staff member or athlete:

```js
await supabase.rpc("fuel_upcoming_training_sessions", {
  p_from: new Date().toISOString(),
  p_to: endDate.toISOString(),
  p_group_id: groupId // null for all authorised sessions
});
```

For schedule-aware operational and analytics features, query `fuel_training_operational_context`. It returns one authorised athlete/session row with the configured maximum gap, last authorised fuel timestamp, gap at session start, and status (`within`, `close`, `exceeded`, `no_prior_fuel`, or `threshold_not_configured`). `close` means within 30 minutes of the athlete's own configured threshold.

The view is read-only. It never changes a threshold and does not contain meal, calorie, or nutrition-prescription fields.

## Realtime and refresh behavior

New notes and schedule changes are immediately queryable through the Data API. Consumers can refetch after writes. If the project later enables these tables in Supabase Realtime, keep Realtime private and rely on the same RLS-aware signed-in subscriptions; do not add a public broadcast channel for staff records.

## Tests

- `tests/coach-organisation-foundations.test.js` checks the migration's objects, grants, indexes, RLS composition, adapter boundary, and lack of Garmin/service-role coupling.
- `supabase/tests/coach_organisation_foundations_rls_test.sql` is a 50-assertion pgTAP suite covering authorised collaboration, cross-coach/cross-athlete/cross-organisation isolation, UUID-only attacks, revocation, immutable sharing identities, roster reactivation, non-authorising groups, assignment access, manual updates, upcoming queries, and UTC/local-date boundaries.
