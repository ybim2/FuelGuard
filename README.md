# Fuel Guard

The canonical frontend is the mobile-first Fuel Guard PWA with the three main tabs: Rhythm, History, and Settings.

Read `AGENTS.md` and `FRONTEND_SOURCE_OF_TRUTH.md` before making frontend changes.

The app is a static PWA served from the repository root. There is no package install or build step.

## Previous notes

Fuel Guard MVP v20 Direct Patch

Applied to the uploaded files only.

Updates:
- Updated visible product language to "Prevent under-fuelling before it happens."
- Put Checklist above Dashboard in the navigation.
- Removed the Purpose menu and Start With Why screen.
- Removed the standalone Confirm Pantry tab.
- Fuel Operations now contains Fuel Confirmation and Nutrition Diary.
- Moved the sequential confirmation workflow into Fuel Confirmation.
- Fuel Forecast now displays the confirmed forecast output and Next Action list.
- Removed the Reporting menu and Download Report tab.
- Renamed Daily Burn Rate to Daily Consumption Rate in the UI.
- Locked run-out predictions until every fuel category is confirmed.
