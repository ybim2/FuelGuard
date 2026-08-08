# Fuel Guard Release Status

Last updated: 2026-08-08. This file tracks accepted source work and its next
delivery action. `VERIFIED` means the named commit has passed its recorded
acceptance gate; it does not imply a production deploy unless the entry says so.

## Active product work

| Feature | Branch | Commit | State | Blocker | Next action |
| --- | --- | --- | --- | --- | --- |
| Athlete log-history safety hotfix | `main` | `8891d28690bd0ba311810f8da8dfd28b5d378e2a` | VERIFIED | None | Preserve its reconciliation and service-worker safety in every release. |
| Fuel Guard Performance | `release/performance-platform-integration` (source: `codex/fuel-guard-performance`) | integration `62ac4af`; accepted source `fab21d7d462665bfa3b002d8f2beffe327f5d06e` | VERIFIED | Production migration/deploy still pending | Ship through the consolidated integration PR after final diff review. |
| Pre/Post Training Fuel | `release/performance-platform-integration` (canonical source lineage: `codex/fuel-guard-performance`) | integration `6553279`; source checkpoint `c931d593` | VERIFIED | Production migration/deploy still pending | Ship in the same consolidated PR; keep the shared calculation in `lib/garmin-health.js`. |
| Garmin completed-activity deduplication | `release/performance-platform-integration` (source: `codex/garmin-completed-activity-audit`) | integration `22f4ab2`; accepted source `5d9bba75db7817909c310ed91f8eabd27b85e33c` | VERIFIED | Production migration/deploy still pending | Ship the unique dedupe commit in the consolidated PR. |
| Main-screen account identity and product switcher | `release/performance-platform-integration` | release branch UX/status commit | VERIFIED | Production deploy still pending | Ship through the consolidated integration PR and smoke-test the live PWA. |
| Multi-user / second-athlete onboarding | `codex/multi-user-beta-onboarding` | `850790c` (no unique onboarding implementation) | BLOCKED | Separate-account local-cache isolation and cross-user attack acceptance are not implemented | Create the next clean feature branch after this release; test Theo → Hal → Theo with no state leakage. |
| Garmin Activity API cloud ingestion | None | None | BLOCKED | NOT IMPLEMENTED and explicitly outside this release | Design and accept as a later, separate integration; do not describe Connect IQ history upload as Activity API ingestion. |

## Garmin watch pull requests

| Feature | Branch / PR | Commit | State | Blocker | Next action |
| --- | --- | --- | --- | --- | --- |
| Garmin health UX 0.4.2 | `codex/garmin-health-ux-0.4.2` / PR #4 | `a29f8f8` | SUPERSEDED | Its useful work is represented by the later #5/#6 branches | Close PR #4 as superseded; preserve the branch. |
| Garmin health status and glance UX | `codex/garmin-beta-trust-fixes` / PR #5 | `67bc6d4` | BLOCKED | Unique health queue/upload/rejection UX remains, and physical FR255 acceptance is outstanding | Keep open until that unique scope is either accepted or deliberately split from the glance fix. |
| FR255 Quick Log glance | `codex/fix-fr255-quick-log-glance` / PR #6 | `1be8d5f` | BLOCKED | Physical FR255 install, rollover, persistence and return-to-glance checks remain | Keep as the canonical glance PR and complete the real-watch gate before merge. |

## Consolidated release acceptance

- Integration branch: `release/performance-platform-integration`
- Production base: `8891d28690bd0ba311810f8da8dfd28b5d378e2a`
- Isolated Supabase project: `xrrnnvjkcqhrzmgfnmma` (temporary; delete after acceptance)
- Clean migration replay: PASS
- Organisation pgTAP: 50/50
- Pre/Post pgTAP: 14/14
- Performance pgTAP: 50/50
- Node: 180/180
- Garmin Run No Evil: Quick Log 31/31; Activity Logger 18/18
- Security advisors: 16 reviewed intentional authenticated SECURITY DEFINER RPC warnings; authorization denial and isolation are covered by pgTAP
- Performance advisors: zero warnings after removal of two duplicate Garmin identity indexes; informational fresh-database notices only
- Next action: commit and push the integration branch, open and inspect the release PR, then merge/deploy only while all gates remain green.
