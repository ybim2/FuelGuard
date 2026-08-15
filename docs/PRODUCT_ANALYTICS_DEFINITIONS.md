# Fuel Guard product analytics definitions

Version: `2026-08-15-v1`

This document is the source of truth for the founder-only Usage & Retention view in Fuel Guard Performance. Metrics are intended to answer product questions without overstating incomplete data.

## Data sources

- **Authoritative domain records** provide meaningful historical actions: Fuel/Hydration/Sleepy logs, grouped supplement logs, Training Mode sessions, Everyday reflections, Performance Reflection results and Training feedback. These records remain the source of truth for user behaviour.
- **Explicit product events** begin only after this release. They cover app/session starts, selected screens, onboarding, confirmed successful actions and privacy-minimised failure categories.
- Historical app opens, sessions, screens, acquisition visitors and failures are not reconstructed. The dashboard labels that coverage gap explicitly.
- The client never holds a service-role key and never inserts directly into the analytics table. Authenticated events pass through a narrowly allowlisted database function that derives `user_id` from `auth.uid()` and uses server time.

## Activation

An account is activated at its first authoritative meaningful action:

- Fuel, hydration, Sleepy or grouped supplement log;
- Training Mode started or completed;
- Everyday Reflection completed;
- Performance Reflection result or Training feedback saved.

Account creation, sign-in, app open and page view do not activate an account. Time-to-activation is the elapsed time between the Supabase Auth account creation timestamp and that first action.

## Active usage

An **active day** is a user-local calendar day containing at least one meaningful action. The calculation uses the most recently observed IANA timezone from explicit product events, falling back to `UTC` when no valid timezone is available.

- **DAU:** users with a meaningful action on their current local day.
- **WAU:** users with a meaningful action during their current local day and the preceding six local days.
- **MAU:** users with a meaningful action during their current local day and the preceding 29 local days.
- **DAU / MAU:** DAU divided by MAU; unavailable when MAU is zero.

Passive authentication refresh, leaving the app open, background service-worker work and duplicate explicit events do not count as meaningful activity.

## Retention

Retention starts at the activation local day, not signup. Only cohorts old enough to reach a window enter its denominator.

- **D1:** a meaningful action exactly one local calendar day after activation.
- **D7:** a meaningful action on local day 7 through 13 after activation.
- **D30:** a meaningful action on local day 30 through 36 after activation.
- **Week 1:** any meaningful action on days 1–7 after activation.
- **Week 2:** any meaningful action on days 8–14 after activation.
- **Week 4:** any meaningful action on days 22–28 after activation.

The dashboard always shows numerator and eligible denominator. Unaged cohorts are unavailable, not zero.

## Engagement states

- **Signed up:** no meaningful action yet.
- **Activated:** one meaningful action, with no later active day yet.
- **Active:** meaningful actions on at least two local days.
- **Retained:** a meaningful action at least seven local days after activation.
- **At risk:** activated, but no meaningful action during the last seven elapsed days.
- **Dormant:** activated, but no meaningful action during the last 30 elapsed days.

These are product-use descriptions, not health or clinical classifications.

## Feature usage

Feature adoption reports both unique users and event totals. It is derived from authoritative records for Daily logging, supplements, Training Mode and reflections. Garmin connection, Coach connection and organisation access use their canonical relationship tables. App/screen usage is available only from the explicit-event start date.

## Acquisition

First-touch attribution accepts only the supported campaign fields: source, medium, campaign, creator, content and landing variant. The first captured record is immutable. Later visits cannot overwrite it.

Visitor totals and visitor-to-signup conversion are unavailable in v1 because anonymous visitor tracking is intentionally not included. Paid conversion is also unavailable until a canonical billing source exists. The funnel must show those values as unavailable rather than invented.

## Test-account exclusions

An active Fuel Guard platform administrator can exclude a test/development account from aggregate metrics. Exclusion is auditable and reversible; it does not delete the user or their product records. The dashboard can temporarily include excluded accounts for QA.

## Privacy and access

- Aggregate and individual product analytics RPCs require the existing active platform-admin identity.
- Ordinary authenticated users can read only their own explicit events and attribution row, and cannot insert arbitrary events directly.
- Event metadata is a short scalar allowlist. Raw form values, journal/reflection text, free-text notes, full URLs, tokens and health detail are rejected or omitted.
- Founder individual timelines show account identity and product-use context needed for support, not sensitive journal content.
- Analytics write failures are swallowed by the client and must never block Fuel, Hydration, Sleepy, Supplement or Training actions.
