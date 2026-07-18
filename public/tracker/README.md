# Tracker 2.6 export template

The "Export to Excel" button fills the community **Redemption CCG Tournament
Score Tracker 2.6** spreadsheet. The macro-enabled template must be committed
here as:

```
public/tracker/Redemption-Tracker-2.6.v1.xlsm
```

Until it exists, the export button shows a "template not installed" error.

> **Current template:** converted 2026-07-18 from the pristine Tracker 2.6
> `.xls` in Microsoft Excel. Verified by
> `lib/tournament/__tests__/trackerTemplate.integration.test.ts`, which runs
> the full patch pipeline against this file (and skips if it's absent).

## One-time conversion checklist (requires real Microsoft Excel)

1. Open the pristine `Redemption-CCG-Tournament-Tracker-2.6.xls` in Excel and
   enable macros. Do **not** use LibreOffice or Numbers — only Excel preserves
   the VBA project and the form buttons.
2. **File → Save As → Excel Macro-Enabled Workbook (`.xlsm`)** without changing
   anything else (don't click buttons, don't edit cells, don't hide/show
   rounds).
3. Reopen the `.xlsm`, confirm the buttons render and that clicking a harmless
   one (e.g. the show/hide rounds toggle) runs a macro, then close **without
   saving**.
4. Commit the file at the path above.

If the template ever needs re-converting, bump the version suffix
(`.v2.xlsm`) and update `TRACKER_TEMPLATE_PATH` in
`utils/tournament/exportTracker.ts` so browser caches can't serve the old
file.

Design details: `docs/superpowers/specs/2026-07-18-tournament-xls-export-design.md`.
