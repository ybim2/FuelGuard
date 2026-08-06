# Private Beta Upload Checklist

1. Open the Garmin Connect IQ Developer Dashboard.
2. Open the existing Fuel Guard Activity Logger Beta App listing.
3. Upload `build/garmin-beta/fuel-guard-activity-logger-beta.iq` as a new version of that existing beta listing.
4. Keep Apps for beta testing only enabled.
5. Keep the Activity Logger listing private.
6. Open the existing separate Fuel Guard Quick Log Beta App listing.
7. Upload `build/garmin-beta/fuel-guard-quick-log-beta.iq` as a new version of that existing beta listing.
8. Keep Apps for beta testing only enabled.
9. Keep the Quick Log listing private.
10. Download both beta apps from the developer account to the paired Forerunner 255.
11. Configure each app through Garmin Connect or Connect IQ settings:
    - API endpoint: `https://fuel-guard-git-feat-garmin-activ-66c653-theos-projects-9c89a4a9.vercel.app/api/garmin-log`
    - Garmin beta bearer token
    - Optional Vercel automation bypass secret
12. Add Fuel Guard Activity Logger to the Run data screens.
13. Open Fuel Guard Quick Log from the app list or glance.
14. Disable Auto Lap on the Run profile used for testing.
15. Smoke test Quick Log: log one Fuel event and confirm exactly one Fuel Guard row.
16. Smoke test Activity Logger: press LAP during a Run and confirm exactly one Fuel Guard row.
17. Smoke test offline retry: record one event offline, reconnect, and confirm exactly one Fuel Guard row.
18. Do not merge PR #1 until all three smoke tests pass.

Do not submit either app for public Store publication during this private beta.
Do not create new listings for this runtime-fix update.
