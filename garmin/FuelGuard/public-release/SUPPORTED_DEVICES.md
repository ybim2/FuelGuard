# Garmin public-beta supported devices

Candidate version: **0.5.1**
Primary physical reference: **Forerunner 255**

The production manifests for Quick Log and Activity Logger contain the same 31 Connect IQ product IDs below. Their locally installed device definitions support both Watch Apps and Data Fields, both apps compiled for every target, and the automated simulator tests passed for every target.

| Family | Connect IQ product IDs included |
| --- | --- |
| Forerunner 165 | `fr165`, `fr165m` |
| Forerunner 245 | `fr245`, `fr245m` |
| Forerunner 255 | `fr255`, `fr255m`, `fr255s`, `fr255sm` |
| Forerunner 265 | `fr265`, `fr265s` |
| Forerunner 945 | `fr945`, `fr945lte` |
| Forerunner 955 | `fr955` (device definition includes Solar) |
| Forerunner 965 | `fr965` |
| fēnix 7 | `fenix7s`, `fenix7`, `fenix7x`, `fenix7spro`, `fenix7pro`, `fenix7xpro`, `fenix7pronowifi`, `fenix7xpronowifi` |
| fēnix 8 | `fenix843mm`, `fenix847mm`, `fenix8solar47mm`, `fenix8solar51mm`, `fenix8pro47mm` |
| epix Gen 2 | `epix2`, `epix2pro42mm`, `epix2pro47mm`, `epix2pro51mm` |

Garmin device definitions can map one product ID to multiple hardware part numbers. The 31 manifest targets generated **46 device binaries per app** in the exported `.iq` packages.

## Automated acceptance result

- Quick Log: 31 product targets × 35 assertions = **1,085 passed**
- Activity Logger: 31 product targets × 19 assertions = **589 passed**
- Total: **1,674 passed; 0 failed; 0 errors**
- Result record: `build/garmin-public-matrix/RESULTS.tsv`

One initial Activity Logger simulator transport timeout occurred on `fr965`; it produced no test failure and the exact target passed 19/19 on the immediate retry. The matrix harness retries one incomplete simulator transport run. The `epix2pro47mm` Activity Logger test log also passed 19/19 but its row was absent from the first summary file, so that exact target was rerun and recorded 19/19.

## Release qualification rule

Compilation and simulator tests qualify the advertised device range for public-beta submission, but they do not replace the mandatory Forerunner 255 physical acceptance. Remove a target from both production manifests if later device-specific functional or layout evidence shows that it is unsafe. Do not add a product ID based only on family name.
