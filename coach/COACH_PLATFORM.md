# Fuel Guard Coach Platform Contract

`coach-platform.js` is the stable boundary between the existing Coach Beta core and independently owned feature modules. It keeps `coach-beta.js` state private and publishes only frozen snapshots, events, feature registration, athlete selection, refresh, and an RLS-backed data facade.

## Public API

Feature modules use `window.FuelGuardCoachPlatform`:

- `getState()` returns a deeply frozen snapshot containing `coach`, `coachProfile`, `relationships`, active `roster`, `athleteProfiles`, `logs`, `targets`, `reports`, `interventions`, `selectedAthleteId`, `loaded`, and `revision`.
- `getSelectedAthlete()` returns the selected authorized roster entry or `null`.
- `selectAthlete(athleteId)` selects an athlete only when that athlete is in the active authorized roster.
- `refresh(reason)` asks the Coach core to reload all RLS-authorized data after a feature mutation.
- `on(eventName, listener)` subscribes to a platform event and returns an unsubscribe function.
- `registerFeature({ id, host, order, render })` registers feature rendering in `dashboard`, `athletes`, `reports`, or `settings`. The renderer receives `{ container, state, platform }` and never receives core state.
- `data` is a token-free Supabase facade with `select`, `insert`, `update`, `upsert`, `remove`, and `rpc`. Queries still execute as the signed-in coach and remain subject to Supabase grants, RLS, and active sharing relationships.

The raw Supabase client, auth session, access token, refresh token, public key, and the internal state object are not part of the public contract. The one-time bridge used by `coach-beta.js` is deleted before feature modules load.

## Events

- `coach-data-loaded`: first successful authorized load for the current signed-in coach.
- `coach-data-refreshed`: each later successful refresh, including existing Coach mutations.
- `athlete-selected`: emitted when the selected authorized athlete changes or is explicitly selected.

Events are available through `platform.on(...)` and as `CustomEvent`s on `document`. Event details contain frozen public data only.

## Feature modules

Feature scripts and styles are loaded in deterministic order from `coach/index.html`. The checked-in modules register ownership boundaries but intentionally render no product UI yet. A feature engineer adds a `render` function in their owned module and calls `platform.refresh("feature-reason")` after successful writes.

The current Coach core remains responsible for authentication, initial data loading, existing rendering, and existing mutations. New feature modules should not read `coach-beta.js` closure state or create another global state store.
