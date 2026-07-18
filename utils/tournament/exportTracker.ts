// utils/tournament/exportTracker.ts
//
// Client-side orchestration for "Export to Excel": pulls the tournament state,
// builds the cell-write map (lib/tournament/trackerExport), patches the
// committed Tracker 2.6 .xlsm template (lib/tournament/trackerXlsmPatch) and
// hands back a save() that triggers the browser download.

import { unzipSync, zipSync, strToU8, strFromU8 } from "fflate";
import { createClient } from "../supabase/client";
import { buildStateFromSupabase } from "./stateAdapter";
import {
  buildTrackerWriteMap,
  roundStartCol,
  TRACKER_MAX_ROUNDS,
  TRACKER_SHEET_NAME,
} from "../../lib/tournament/trackerExport";
import {
  forceRecalcOnLoad,
  patchColVisibility,
  patchSheetCells,
  resolveSheetPath,
  stripCalcChainRefs,
} from "../../lib/tournament/trackerXlsmPatch";

/** Version-suffixed so a future re-conversion never fights browser caches. */
export const TRACKER_TEMPLATE_PATH = "/tracker/Redemption-Tracker-2.6.v1.xlsm";

export type TrackerExportPrepared =
  | { ok: false; error: string }
  | { ok: true; warnings: string[]; filename: string; save: () => void };

function sanitizeFilename(name: string): string {
  return name.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim() || "Tournament";
}

export async function prepareTrackerExport(
  tournamentId: string,
  tournamentName: string,
): Promise<TrackerExportPrepared> {
  const supabase = createClient();
  // Expired browser tokens make RLS reads silently return empty — fail loudly
  // instead of exporting a blank tracker.
  const { data: userData } = await supabase.auth.getUser();
  if (!userData?.user) {
    return { ok: false, error: "Your session has expired — refresh the page and sign in again." };
  }

  const state = await buildStateFromSupabase(supabase, tournamentId);
  if (!state || state.participants.length === 0) {
    return { ok: false, error: "Could not load the tournament data. Refresh and try again." };
  }

  const build = buildTrackerWriteMap(state);
  // tsconfig has strict:false, where `!build.ok` doesn't narrow the union.
  if (build.ok === false) return { ok: false, error: build.errors.join(" ") };

  const res = await fetch(TRACKER_TEMPLATE_PATH);
  if (!res.ok) {
    return {
      ok: false,
      error:
        "The Tracker 2.6 template isn't installed on this deployment yet (see public/tracker/README.md).",
    };
  }
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(new Uint8Array(await res.arrayBuffer()));
  } catch {
    return { ok: false, error: "The Tracker template file is corrupt — it needs to be re-converted." };
  }

  const workbookPath = "xl/workbook.xml";
  const relsPath = "xl/_rels/workbook.xml.rels";
  if (!files[workbookPath] || !files[relsPath]) {
    return { ok: false, error: "The Tracker template is missing its workbook parts." };
  }
  const workbookXml = strFromU8(files[workbookPath]);
  const relsXml = strFromU8(files[relsPath]);
  const sheetPath = resolveSheetPath(workbookXml, relsXml, TRACKER_SHEET_NAME);
  if (!sheetPath || !files[sheetPath]) {
    return { ok: false, error: `The Tracker template has no "${TRACKER_SHEET_NAME}" sheet.` };
  }

  try {
    let sheetXml = strFromU8(files[sheetPath]);
    sheetXml = patchSheetCells(sheetXml, build.map.cells);
    const hiddenByCol = new Map<number, boolean>();
    for (const { round, hidden } of build.map.hiddenRounds) {
      if (round > TRACKER_MAX_ROUNDS) continue;
      const start = roundStartCol(round);
      for (let c = start; c < start + 5; c++) hiddenByCol.set(c, hidden);
    }
    sheetXml = patchColVisibility(sheetXml, hiddenByCol);
    files[sheetPath] = strToU8(sheetXml);

    files[workbookPath] = strToU8(forceRecalcOnLoad(workbookXml));
    if (files["xl/calcChain.xml"]) {
      delete files["xl/calcChain.xml"];
      const stripped = stripCalcChainRefs(strFromU8(files["[Content_Types].xml"]), relsXml);
      files["[Content_Types].xml"] = strToU8(stripped.contentTypes);
      files[relsPath] = strToU8(stripped.workbookRels);
    }
  } catch (e) {
    return {
      ok: false,
      error: `The template didn't match the expected Tracker 2.6 layout (${e instanceof Error ? e.message : "patch failed"}).`,
    };
  }

  const zipped = zipSync(files);
  const filename = `${sanitizeFilename(tournamentName)} - Tracker 2.6.xlsm`;
  const save = () => {
    const blob = new Blob([zipped as BlobPart], {
      type: "application/vnd.ms-excel.sheet.macroEnabled.12",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };
  return { ok: true, warnings: build.map.warnings, filename, save };
}
