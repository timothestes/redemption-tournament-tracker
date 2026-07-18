// Integration test: runs the full export patch pipeline against the REAL
// committed Tracker 2.6 template (public/tracker/). Skips when the asset
// isn't present so the suite stays green on checkouts without it.
//
// Set TRACKER_SMOKE_OUT=/path/to/file.xlsm to also write the patched sample
// workbook for a manual Excel smoke test.

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { buildTrackerWriteMap, roundStartCol, TRACKER_SHEET_NAME } from '../trackerExport';
import {
  forceRecalcOnLoad,
  patchColVisibility,
  patchSheetCells,
  resolveSheetPath,
  stripCalcChainRefs,
} from '../trackerXlsmPatch';
import type { Match, MatchOutcome, Participant, TournamentState } from '../types';

const TEMPLATE = join(__dirname, '../../../public/tracker/Redemption-Tracker-2.6.v1.xlsm');

function p(id: string, name: string): Participant {
  return { id, name, joinedAt: '2026-01-01T00:00:00Z', droppedOut: false };
}

function played(
  round: number, order: number, p1: string, p2: string,
  s1: number, s2: number, cap: number,
): Match {
  let p1Outcome: MatchOutcome;
  let p2Outcome: MatchOutcome;
  if (s1 === s2) {
    p1Outcome = 'tie'; p2Outcome = 'tie';
  } else if (s1 > s2) {
    p1Outcome = s1 >= cap ? 'full_win' : 'partial_win';
    p2Outcome = s1 >= cap ? 'full_loss' : 'partial_loss';
  } else {
    p1Outcome = s2 >= cap ? 'full_loss' : 'partial_loss';
    p2Outcome = s2 >= cap ? 'full_win' : 'partial_win';
  }
  return {
    id: `m${round}-${order}`, round, player1Id: p1, player2Id: p2,
    matchOrder: order, result: { p1Souls: s1, p2Souls: s2, p1Outcome, p2Outcome },
  };
}

/** Mid-tournament fixture: 5 players, round 3 of 3 in progress, byes with a repeat. */
function fixtureState(): TournamentState {
  return {
    id: 't-integration', nRounds: 3, currentRound: 3, soulCap: 5,
    hasStarted: true, hasEnded: false,
    participants: [
      p('a', 'Ann Adams'), p('b', 'Bob "Blaze" Brown'), p('c', 'Cal & Co'),
      p('d', 'Deb Day'), p('e', 'Eve Ash'),
    ],
    matches: [
      played(1, 1, 'a', 'b', 5, 2, 5),
      played(1, 2, 'c', 'd', 3, 3, 5),
      played(2, 1, 'a', 'c', 5, 0, 5),
      played(2, 2, 'd', 'e', 4, 1, 5),
      // Round 3 in progress: pairings set, no scores yet.
      { id: 'm3-1', round: 3, player1Id: 'a', player2Id: 'd', matchOrder: 1 },
      { id: 'm3-2', round: 3, player1Id: 'c', player2Id: 'b', matchOrder: 2 },
    ],
    byes: [
      { participantId: 'e', round: 1 },
      { participantId: 'b', round: 2 },
      { participantId: 'e', round: 3 }, // Eve's second bye → sentinel decays to -2
    ],
    startedRounds: [1, 2, 3],
  };
}

describe.runIf(existsSync(TEMPLATE))('real Tracker 2.6 template', () => {
  it('patches the committed template end-to-end without touching other parts', () => {
    const files = unzipSync(new Uint8Array(readFileSync(TEMPLATE)));
    const originals = new Map(Object.entries(files).map(([k, v]) => [k, v.slice()]));

    const workbookXml = strFromU8(files['xl/workbook.xml']);
    const relsXml = strFromU8(files['xl/_rels/workbook.xml.rels']);
    const sheetPath = resolveSheetPath(workbookXml, relsXml, TRACKER_SHEET_NAME);
    expect(sheetPath).toBe('xl/worksheets/sheet1.xml');
    expect(files[sheetPath!]).toBeDefined();

    const state = fixtureState();
    const build = buildTrackerWriteMap(state);
    expect(build.ok).toBe(true);
    if (build.ok === false) return;

    // Patch cells against the real serialization (styled self-closing blanks).
    let sheetXml = strFromU8(files[sheetPath!]);
    sheetXml = patchSheetCells(sheetXml, build.map.cells);

    for (const w of build.map.cells) {
      const cell = new RegExp(`<c r="${w.ref}"[^>]*(?:/>|>[\\s\\S]*?</c>)`).exec(sheetXml);
      expect(cell, `cell ${w.ref} present`).toBeTruthy();
      // Every entry cell in the template carries a style; a lost s= would
      // re-lock the cell under sheet protection.
      expect(cell![0], `cell ${w.ref} keeps s=`).toMatch(/\bs="\d+"/);
      if (typeof w.value === 'number') {
        expect(cell![0]).toContain(`<v>${w.value}</v>`);
      } else {
        expect(cell![0]).toContain('t="inlineStr"');
      }
    }
    // The sheet's own formulas survive.
    expect(sheetXml).toContain('IF(A14=2,7,5)');
    expect(sheetXml).toContain('SUM(C:C)');
    expect(sheetXml).toMatch(/<c r="G3"[^>]*>[\s\S]*?<f[^>]*>[^<]*ABS\(I3\)/);

    // Column visibility: current round (3) visible, others hidden.
    const hiddenByCol = new Map<number, boolean>();
    for (const { round, hidden } of build.map.hiddenRounds) {
      const start = roundStartCol(round);
      for (let c = start; c < start + 5; c++) hiddenByCol.set(c, hidden);
    }
    sheetXml = patchColVisibility(sheetXml, hiddenByCol);
    expect(sheetXml).toMatch(/<col min="16" max="16"(?![^>]*hidden)[^>]*\/>/);
    expect(sheetXml).toMatch(/<col min="6" max="6"[^>]*hidden="1"[^>]*\/>/);
    expect(sheetXml).toMatch(/<col min="21" max="21"[^>]*hidden="1"[^>]*\/>/);

    files[sheetPath!] = strToU8(sheetXml);

    // Recalc-on-load: the real template already sets it — ensure idempotence.
    const patchedWb = forceRecalcOnLoad(workbookXml);
    expect(patchedWb.match(/<calcPr/g)).toHaveLength(1);
    expect(patchedWb).toContain('fullCalcOnLoad="1"');
    files['xl/workbook.xml'] = strToU8(patchedWb);

    expect(files['xl/calcChain.xml']).toBeDefined();
    delete files['xl/calcChain.xml'];
    const stripped = stripCalcChainRefs(strFromU8(files['[Content_Types].xml']), relsXml);
    expect(stripped.contentTypes).not.toContain('calcChain');
    expect(stripped.workbookRels).not.toContain('calcChain');
    files['[Content_Types].xml'] = strToU8(stripped.contentTypes);
    files['xl/_rels/workbook.xml.rels'] = strToU8(stripped.workbookRels);

    // Round-trip and verify only the intended parts changed.
    const out = unzipSync(zipSync(files));
    const touched = new Set([
      sheetPath!, 'xl/workbook.xml', '[Content_Types].xml', 'xl/_rels/workbook.xml.rels',
    ]);
    expect(out['xl/calcChain.xml']).toBeUndefined();
    for (const [name, orig] of originals) {
      if (name === 'xl/calcChain.xml') continue;
      expect(out[name], `part ${name} present`).toBeDefined();
      if (!touched.has(name)) {
        expect(Buffer.compare(Buffer.from(out[name]), Buffer.from(orig)), `part ${name} unchanged`).toBe(0);
      }
    }
    expect(Buffer.compare(
      Buffer.from(out['xl/vbaProject.bin']),
      Buffer.from(originals.get('xl/vbaProject.bin')!),
    )).toBe(0);

    if (process.env.TRACKER_SMOKE_OUT) {
      writeFileSync(process.env.TRACKER_SMOKE_OUT, zipSync(files));
    }
  });
});
