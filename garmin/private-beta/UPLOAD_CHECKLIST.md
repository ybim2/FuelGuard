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
10. Do not create new listings.
11. Sync/update both apps on the paired Forerunner 255.
12. No Garmin token, Vercel bypass secret or endpoint entry is required.
13. Open Fuel Guard Quick Log.
14. Select Connect Fuel Guard.
15. Approve on the phone while signed into Fuel Guard.
16. Verify any pending Quick Log events sync.
17. Open Activity Logger field settings from the Run activity configuration.
18. Select Connect Fuel Guard.
19. Approve on the phone while signed into Fuel Guard.
20. Disable Auto Lap on the Run profile used for testing.
21. Smoke test Quick Log: log one Fuel event and confirm exactly one Fuel Guard row.
22. Smoke test Activity Logger: press LAP during a Run and confirm exactly one Fuel Guard row.
23. Smoke test offline retry: record one event offline, reconnect, and confirm exactly one Fuel Guard row.
24. Do not merge PR #1 until all automated and real-watch smoke tests pass.

Do not submit either app for public Store publication during this private beta.
