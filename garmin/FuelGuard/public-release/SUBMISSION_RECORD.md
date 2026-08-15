# Connect IQ public-beta submission record

## Quick Log fuel-status glance 0.5.6 — review candidate

- **Quick Log version:** 0.5.6
- **Activity Logger version:** unchanged at 0.5.5
- **Quick Log production AppID:** `2F3B7C5E9F2D4A6B8C1D0E7F0F255002`
- **Scope:** show elapsed time since the paired athlete's latest canonical Fuel event using a validated local snapshot; the glance itself remains network-free.
- **Authority:** foreground status sync reads the latest Fuel event for the device-token owner; Garmin Fuel updates the cache only after server acknowledgement. Sleepy/check-in rows are excluded.
- **Stale handling:** snapshots older than six hours show `Open Fuel Guard` / `to sync` rather than presenting stale data as current.
- **Compatibility:** all 31 declared products compile with the shared source. Garmin ignores watch-app glance annotations on `fr245`, `fr245m`, `fr945` and `fr945lte`; those products retain normal Quick Log functionality.
- **Publication status:** NOT UPLOADED — requires Preview/source approval and the user's Store-delivered physical FR255 spot-check.

## Canonical Fuel Guard mark 0.5.5 — physical hardware spot-check pending

- **Version:** 0.5.5
- **Scope:** branding assets only; the accepted 0.5.4 shared START/ENTER connect path and all logging, Training Mode, queue and Activity Logger behaviour are unchanged.
- **Identity:** both launcher icons and both Store icons are deterministic derivatives of `brand/fuel-guard-mark.png`.
- **Compatibility requirement:** both apps retain the 31-product manifest matrix; the user's FR255 remains an additional hardware spot check.
- **Package status:** hashes are recorded after the brand-standardisation source is accepted and packaged.

## Shared connect-input compatibility fix 0.5.4 — physical hardware spot-check pending

- **Version:** 0.5.4
- **Quick Log production AppID:** `2F3B7C5E9F2D4A6B8C1D0E7F0F255002`
- **Activity Logger production AppID:** `9C8A41410F0A4D46A7F7D1C68F0F2551`
- **Finding:** all 31 installed device definitions map the physical Enter/Start action to Garmin `onSelect`, with touch products additionally mapping tap to `onSelect`; Activity Logger nevertheless lacked the raw `KEY_START`/`KEY_ENTER` fallback already required by the physically reproduced Quick Log path.
- **Fix:** both public delegates now use one shared START/ENTER action-key mapping and invoke their existing authentication flow; no product-specific branches were added.
- **Compatibility requirement:** source/build/package acceptance covers all 31 manifest products; the user's FR255 is an additional hardware spot check.
- **Quick Log package:** `/Users/theo/Documents/Codex/FuelGuard/releases/garmin-public/0.5.4/fuel-guard-quick-log-public-0.5.4.iq`
- **Quick Log SHA-256:** `0595304853b0dd8b7815c7d1e77b30180cca70e75aa0e26d9892825e09f05f5f`
- **Activity Logger package:** `/Users/theo/Documents/Codex/FuelGuard/releases/garmin-public/0.5.4/fuel-guard-activity-logger-public-0.5.4.iq`
- **Activity Logger SHA-256:** `fa3ec723f8b4664e8d6e771eb38a23528829712b724cc5f66920b35424b07696`
- **Package result:** both signed packages contain 46 device binaries generated from the same 31 manifest product IDs; the package credential scan passed.

## Quick Log START-input fix 0.5.3 — physical hardware spot-check pending

- **Version:** 0.5.3
- **Quick Log production AppID:** `2F3B7C5E9F2D4A6B8C1D0E7F0F255002`
- **Activity Logger production AppID:** `9C8A41410F0A4D46A7F7D1C68F0F2551`
- **Root cause:** the disconnected screen advertised `Press START`, but the input delegate handled only the device-independent `onSelect()` behavior and had no raw `KEY_START` fallback.
- **Fix:** raw `KEY_START` and `KEY_ENTER` events invoke the same existing Quick Log action and OAuth path; `onSelect()` remains unchanged for devices that map the action button to selection.
- **Compatibility requirement:** source/build/package acceptance covers all 31 manifest products; the user's FR255 is an additional hardware spot check.
- **Package status:** build and hash are recorded after the fix is merged and rebuilt from canonical `main`.

## Production completion 0.5.2 source candidate — physical acceptance pending

- **Version:** 0.5.2
- **Canonical base:** `512beeb80c42994c6bc141c6f68ca78e85e06d31`
- **Quick Log production AppID:** `2F3B7C5E9F2D4A6B8C1D0E7F0F255002`
- **Activity Logger production AppID:** `9C8A41410F0A4D46A7F7D1C68F0F2551`
- **Manifest targets:** 31 per app; 46 generated device binaries expected per exported package
- **Simulator validation:** Quick Log 1,364/1,364; Activity Logger 589/589; combined 1,953/1,953
- **Node validation:** 391/391
- **Garmin command/RLS pgTAP:** 26/26 in isolated acceptance; fixtures rolled back with zero retained records
- **State authority:** watch active/completed state changes only after an authoritative backend response; queued and failed transitions remain explicit and retryable
- **Athlete foreground sync:** canonical Garmin starts/stops are adopted while the visible signed-in app is open, with identity and stale-response protection
- **Production dependency:** `20260810091806_garmin_training_mode_commands`, then `20260810100500_garmin_training_mode_command_hardening`; audited but not applied
- **Package identity:** exact signed package paths and SHA-256 hashes are recorded in the completion report after packages are built from the final tested commit
- **Physical status:** PENDING Store-delivered Forerunner 255 acceptance; do not upload or publish without explicit authorisation

## Failed 0.5.1 physical candidate — not releasable

- **Version:** 0.5.1
- **Prepared:** 10 August 2026
- **Source branch:** `codex/garmin-public-logging-restore`
- **Base commit:** `2873d95459e5542a22b8d93ce2f58bf78ba34018`
- **Exact committed source SHA:** PENDING — release acceptance is intentionally uncommitted
- **Quick Log production manifest UUID:** `2F3B7C5E9F2D4A6B8C1D0E7F0F255002`
- **Activity Logger production manifest UUID:** `9C8A41410F0A4D46A7F7D1C68F0F2551`
- **Quick Log package:** `fuel-guard-quick-log-public-0.5.1.iq`
- **Quick Log SHA-256:** `d9b6561551e5a2ab62b28bc8d3ab159322d995284d07f7ec0da76cf9a273484a`
- **Activity Logger package:** `fuel-guard-activity-logger-public-0.5.1.iq`
- **Activity Logger SHA-256:** `4c513c491fcfa9159641a4eaed94d91e539da0eeb3b1f9030804fd6a42232815`
- **Manifest targets:** 31 per app
- **Generated Garmin device binaries:** 46 per app
- **Simulator result:** 1,674 passed; 0 failed; 0 errors
- **Node result:** 358 passed; 0 failed
- **Syntax/XML/diff checks:** passed
- **Credential scan:** passed; only the intended public Fuel Guard endpoint was found
- **Workspace package directory:** `build/garmin-public/`
- **Persistent package directory:** `/Users/theo/Documents/Codex/FuelGuard/releases/garmin-public-logging-restore/0.5.1/`
- **Forerunner 255 exact package member:** `006-B3992-00/*.prg`
- **Forerunner 255 Quick Log PRG SHA-256:** `7b6bd2cdaddedfbca3a867428fa5e20605843394055112464fef0cda627e3c47`
- **Forerunner 255 Activity Logger PRG SHA-256:** `5fb1fc8e4eaa285ed5e9aa15db8021886deefb820200220bac6acb7214fddaa8`

## Previous-candidate comparison

- **Accepted 0.5.0 Quick Log SHA-256:** `a9b4685b3ee75bf0b46e1bd8ffcb41a937df491119fdc4bdbeb661e327dceb07`
- **Accepted 0.5.0 Activity Logger SHA-256:** `3b314a0b97bee047b9c427b15f5b54123ebcb734138932ee9c9d9d0b25ae8842`
- **Identity/version result:** both rebuilt packages retain the production application IDs and version `0.5.1`.
- **Device-matrix result:** both rebuilt packages retain all 46 generated device binaries from the same 31 product IDs.
- **Functional result:** 0.5.1 retains the accepted Glance, four-action Quick Log UI, Training Mode routing, Activity Logger LAP behavior and queue/idempotency implementation, while restoring authentication callback delivery through the Garmin authentication lifecycle.
- **Hash result:** signed Connect IQ exports contain non-deterministic signing/build metadata. The final 0.5.1 hashes below identify the exact persistent physical-test candidates.
- **Supersession:** after source integration is committed and the physical Forerunner 255 gate passes against the rebuilt hashes, these rebuilt packages supersede the accepted 0.5.0 artifacts.

## Submission gate

- **Forerunner 255 physical acceptance:** FAILED — Quick Log OAuth and device registration passed, then connected runtime displayed `IQ!`
- **Store screenshots:** PENDING
- **Public developer support contact:** PENDING CONFIRMATION
- **Quick Log Connect IQ listing ID:** assigned by Garmin after listing creation
- **Activity Logger Connect IQ listing ID:** assigned by Garmin after listing creation
- **Submission date:** NOT SUBMITTED
- **Quick Log status:** FAILED PHYSICAL ACCEPTANCE — this exact package is not releasable and must not be uploaded
- **Activity Logger status:** NOT SUBMITTED — physical acceptance gate open

## Failed replacement 0.5.1 Store-test candidate — not releasable

- **Known-good beta reference:** `1be8d5fcef55f380bd5fa9a8b6ced166e6bf1c89`
- **Recovery state:** uncommitted source packaged as fresh signed replacement `.iq` files; not uploaded
- **Source patch ID before packaging:** `f3cccdbfbac048e91b77a2537978d12d5c6640ae`
- **Replacement directory:** `/Users/theo/Documents/Codex/FuelGuard/releases/garmin-public-logging-restore/replacement/0.5.1/`
- **Replacement Quick Log package:** `fuel-guard-quick-log-public-0.5.1.iq`
- **Replacement Quick Log SHA-256:** `33c6beb99a9518ceb4e5ec501de1620dce1de4e490fb2603bda24ae871f36c23`
- **Replacement Activity Logger package:** `fuel-guard-activity-logger-public-0.5.1.iq`
- **Replacement Activity Logger SHA-256:** `fcbec1fa77e9aa5a88b4bd86cb5f97efcab5819a86b122c90c367e9757a7e943`
- **Production AppIDs:** Quick Log `2F3B7C5E9F2D4A6B8C1D0E7F0F255002`; Activity Logger `9C8A41410F0A4D46A7F7D1C68F0F2551`
- **Version and device result:** `0.5.1`; 31 manifest product IDs and 46 generated binaries per app
- **OAuth callback:** preserved; physical OAuth and device registration passed
- **Connected startup:** request startup is contained, but the asynchronous Training status callback was incorrectly declared with three arguments while the request omitted `:context`
- **Glance:** known-good defensive state-render fallback restored; `onStart()` remains network-free
- **Simulator validation:** 1,705 passed; 0 failed; 0 errors across 31 products
- **Node validation:** 359 passed; 0 failed
- **Syntax/manifest/credential/diff validation:** passed
- **Physical retest:** FAILED — OAuth, device registration and connected UI passed, then this Quick Log package displayed delayed `IQ!` without input
- **Release status:** FAILED PHYSICAL ACCEPTANCE — this Quick Log package must not be uploaded

## Corrected asynchronous-callback source — no package built

- **Diagnosis:** Garmin SDK 9.2.0 documents that a `makeWebRequest()` callback accepts a third `context` argument only when the request options populate `:context`.
- **Training fix:** the status request now supplies explicit `STATUS_REQUEST_CONTEXT`, matching the established `FuelGuardApi` and `FuelGuardHealthApi` three-argument callback pattern.
- **Async audit:** authorization exchange, log upload, health upload, Training status and device revocation now all pair three-argument callbacks with explicit request context.
- **Update-loop result:** the held response regression proves the callback clears `_refreshInFlight`, updates state once and remains inside the existing 60-second refresh throttle after `WatchUi.requestUpdate()`.
- **Compatibility result:** all 31 Quick Log product configurations passed the same connected delayed-response scenario, 37/37 per product.
- **Simulator validation:** Quick Log 1,147/1,147; Activity Logger 589/589; combined 1,736/1,736.
- **Node validation:** 361/361.
- **Syntax/manifest/credential/diff validation:** passed.
- **Package status:** NOT BUILT — no `.iq` has been produced from this corrected source.

Do not upload either failed Quick Log package or alter the existing beta listings. A future package may be built only after the corrected source is explicitly authorised for packaging and must then complete Store-delivered physical acceptance.
