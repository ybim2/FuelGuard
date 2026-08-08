# Fuel Guard Release Status

Last updated: 2026-08-08 after the consolidated Performance production release.
This file tracks accepted source work and its next delivery action. `VERIFIED`
means the named commit passed its recorded acceptance gate; production delivery
is stated explicitly.

## Active product work

| Feature | Branch | Commit | State | Blocker | Next action |
| --- | --- | --- | --- | --- | --- |
| Athlete log-history safety hotfix | `main` | `8891d28690bd0ba311810f8da8dfd28b5d378e2a` | VERIFIED | None | Preserve its reconciliation and service-worker safety in every release. |
| Fuel Guard Performance | `main` (source: `codex/fuel-guard-performance`) | production merge `99e8fd4`; accepted source `fab21d7d462665bfa3b002d8f2beffe327f5d06e` | VERIFIED | None | Maintain capability/scope enforcement and rerun Performance acceptance for future schema changes. |
| Pre/Post Training Fuel | `main` (canonical source lineage: `codex/fuel-guard-performance`) | production merge `99e8fd4`; source checkpoint `c931d593` | VERIFIED | None | Keep the shared calculation in `lib/garmin-health.js`; do not fork Athlete, Coach or Performance calculations. |
| Garmin completed-activity deduplication | `main` (source: `codex/garmin-completed-activity-audit`) | production merge `99e8fd4`; accepted source `5d9bba75db7817909c310ed91f8eabd27b85e33c` | VERIFIED | None | Preserve source-ID and fallback activity identity during future ingestion work. |
| Main-screen account identity and product switcher | `main` | production merge `99e8fd4`; integration source `ac37484` | VERIFIED | None | Preserve live-session identity updates and server-authoritative product access. |
| Multi-user / second-athlete onboarding | `codex/multi-user-beta-onboarding` | `850790c` (no unique onboarding implementation) | BLOCKED | Separate-account local-cache isolation and cross-user attack acceptance are not implemented | Create the next clean feature branch after this release; test Theo → Hal → Theo with no state leakage. |
| Garmin Activity API cloud ingestion | None | None | BLOCKED | NOT IMPLEMENTED and explicitly outside this release | Design and accept as a later, separate integration; do not describe Connect IQ history upload as Activity API ingestion. |

## Production release

- Release PR: #8, `Integrate Fuel Guard Performance and shared training context`
- Tested integration SHA: `ac374841f4161144ed665f226cb4b2d9a072411a`
- Production merge/main SHA: `99e8fd4c36c8805bf62027b81cc38230feda5ef4`
- PWA: `mobile-pwa-v114-performance-platform`
- Vercel deployment: SUCCEEDED
- Production smoke: VERIFIED for Athlete history/manual persistence, main identity,
  product navigation, Pre/Post context, Performance authorization/revocation and
  cleanup of the temporary smoke identity/data

## Garmin watch pull requests

| Feature | Branch / PR | Commit | State | Blocker | Next action |
| --- | --- | --- | --- | --- | --- |
| Garmin health UX 0.4.2 | `codex/garmin-health-ux-0.4.2` / PR #4 | `a29f8f8` | SUPERSEDED | Its useful work is represented by the later #5/#6 branches | Close PR #4 as superseded; preserve the branch. |
| Garmin health status and glance UX | `codex/garmin-beta-trust-fixes` / PR #5 | `67bc6d4` | BLOCKED | Unique health queue/upload/rejection UX remains, and physical FR255 acceptance is outstanding | Keep open until that unique scope is either accepted or deliberately split from the glance fix. |
| FR255 Quick Log glance | `codex/fix-fr255-quick-log-glance` / PR #6 | `1be8d5f` | BLOCKED | Physical FR255 install, rollover, persistence and return-to-glance checks remain | Keep as the canonical glance PR and complete the real-watch gate before merge. |

## Consolidated release acceptance

- Integration branch: `release/performance-platform-integration`
- Tested integration SHA: `ac374841f4161144ed665f226cb4b2d9a072411a`
- Merged main SHA: `99e8fd4c36c8805bf62027b81cc38230feda5ef4`
- Production base: `8891d28690bd0ba311810f8da8dfd28b5d378e2a`
- Isolated Supabase project: `xrrnnvjkcqhrzmgfnmma` (INACTIVE, $0/month;
  deletion remains blocked by account/dashboard permissions)
- Clean migration replay: PASS
- Organisation pgTAP: 50/50
- Pre/Post pgTAP: 14/14
- Performance pgTAP: 50/50
- Node: 180/180
- Garmin Run No Evil: Quick Log 31/31; Activity Logger 18/18
- Security advisors: 16 reviewed intentional authenticated SECURITY DEFINER RPC warnings; authorization denial and isolation are covered by pgTAP
- Performance advisors: zero warnings after removal of two duplicate Garmin identity indexes; informational fresh-database notices only
- Release result: merged, deployed and functionally verified.

## Remaining release operations

- Enable Supabase leaked-password protection for production Auth.
- Delete inactive acceptance projects `xrrnnvjkcqhrzmgfnmma` and
  `lladvwevmkyfylgvyaqh` when account/dashboard permissions allow.
- Complete installed-iOS PWA update acceptance.
- Keep Garmin PR #5 and PR #6 out of `main` until their remaining physical-watch
  acceptance gates pass.
