# Connect IQ public-beta submission record

## Release candidate

- **Version:** 0.5.0
- **Prepared:** 9 August 2026
- **Source branch:** `codex/garmin-public-0.5.0-integration`
- **Base commit:** `700cdc5d54455ef2a9508ac5d6a6925b2bc9c17f`
- **Exact committed source SHA:** PENDING — integration acceptance is intentionally uncommitted
- **Quick Log production manifest UUID:** `2F3B7C5E9F2D4A6B8C1D0E7F0F255002`
- **Activity Logger production manifest UUID:** `9C8A41410F0A4D46A7F7D1C68F0F2551`
- **Quick Log package:** `fuel-guard-quick-log-public-0.5.0.iq`
- **Quick Log SHA-256:** `a9b4685b3ee75bf0b46e1bd8ffcb41a937df491119fdc4bdbeb661e327dceb07`
- **Activity Logger package:** `fuel-guard-activity-logger-public-0.5.0.iq`
- **Activity Logger SHA-256:** `3b314a0b97bee047b9c427b15f5b54123ebcb734138932ee9c9d9d0b25ae8842`
- **Manifest targets:** 31 per app
- **Generated Garmin device binaries:** 46 per app
- **Simulator result:** 1,612 passed; 0 failed; 0 errors
- **Node result:** 357 passed; 0 failed
- **Syntax/XML/diff checks:** passed
- **Credential scan:** passed; only the intended public Fuel Guard endpoint was found
- **Workspace package directory:** `build/garmin-public/`
- **Persistent package directory:** `/Users/theo/Documents/Codex/FuelGuard/releases/garmin-public-integrated/0.5.0/`
- **Forerunner 255 exact package member:** `006-B3992-00/*.prg`
- **Forerunner 255 Quick Log PRG SHA-256:** `651477f21adde4d385a3371c6341465b3c6ca7bcc41b706aa9c44666f0f1c447`
- **Forerunner 255 Activity Logger PRG SHA-256:** `651f5bff08d1b65baf1dd5ddabe6d78b3fd92b3b3ac9d781c2922ba8963ec17b`

## Preserved-candidate comparison

- **Preserved Quick Log SHA-256:** `ffdc9000bedd0d763dea6bfd00b53c883080971f52196b5f7d9c9d3ef8f39c3f`
- **Preserved Activity Logger SHA-256:** `2a4809cf63b74b084fdd769382b1a0a50f3e88f2eccbe17497e111a2d9f686c1`
- **Identity/version result:** both rebuilt packages retain the production application IDs and version `0.5.0`.
- **Device-matrix result:** both rebuilt packages retain all 46 generated device binaries from the same 31 product IDs.
- **Hash result:** hashes differ because the rebuilt packages contain newer canonical Garmin Training Mode behavior, the four-action Quick Log UI and improved pairing status text; the original source state was older and uncommitted. Two consecutive builds from the unchanged integrated Garmin source also produced different signed package hashes, confirming that the Connect IQ exporter embeds non-deterministic signing/build metadata. The hashes above identify the final persistent copies.
- **Supersession:** after source integration is committed and the physical Forerunner 255 gate passes against the rebuilt hashes, these rebuilt packages supersede the preserved artifacts.

## Submission gate

- **Forerunner 255 physical acceptance:** PENDING
- **Store screenshots:** PENDING
- **Public developer support contact:** PENDING CONFIRMATION
- **Quick Log Connect IQ listing ID:** assigned by Garmin after listing creation
- **Activity Logger Connect IQ listing ID:** assigned by Garmin after listing creation
- **Submission date:** NOT SUBMITTED
- **Quick Log status:** NOT SUBMITTED — physical acceptance gate open
- **Activity Logger status:** NOT SUBMITTED — physical acceptance gate open

Do not upload either package or alter the existing beta listings until `PHYSICAL_ACCEPTANCE.md` has no failed or pending release gate and the package hashes still match this record.
