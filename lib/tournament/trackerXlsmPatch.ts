// lib/tournament/trackerXlsmPatch.ts
//
// Pure OOXML (string in/string out) patch helpers for filling the Tracker 2.6
// .xlsm template. Everything here is deliberately surgical: we only rewrite
// the specific cells/attributes we must, so the template's VBA project, form
// buttons, styles, and formulas survive byte-for-byte in the zip.
//
// Cell values are written as inline strings (t="inlineStr") or plain numbers.
// Inline strings alongside an existing sharedStrings table are valid ECMA-376;
// Excel normalizes them on the next save. A patched/inserted <c> keeps (or
// copies) the template's s= style index — style 0 would re-lock an entry cell
// under sheet protection.

import type { TrackerCellWrite } from "./trackerExport";
import { colLetter } from "./trackerExport";

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** "AY202" → { row: 202, col: 51 }. */
export function parseRef(ref: string): { row: number; col: number } {
  const m = /^([A-Z]+)(\d+)$/.exec(ref);
  if (!m) throw new Error(`Bad cell ref: ${ref}`);
  let col = 0;
  for (const ch of m[1]) col = col * 26 + (ch.charCodeAt(0) - 64);
  return { row: Number(m[2]), col };
}

/** Serialize one cell element with a preserved style index. */
function cellXml(ref: string, value: string | number, style: string | null): string {
  const s = style ? ` s="${style}"` : "";
  if (typeof value === "number") {
    return `<c r="${ref}"${s}><v>${value}</v></c>`;
  }
  const preserve = /^\s|\s$/.test(value) ? ' xml:space="preserve"' : "";
  return `<c r="${ref}"${s} t="inlineStr"><is><t${preserve}>${escapeXml(value)}</t></is></c>`;
}

/** Find a donor style index for `col` from any other row's cell in that column. */
function donorStyle(xml: string, col: number): string | null {
  const re = new RegExp(`<c r="${colLetter(col)}\\d+"[^>]*\\bs="(\\d+)"`, "g");
  const m = re.exec(xml);
  return m ? m[1] : null;
}

/**
 * Patch cell values into a worksheet XML string. Existing <c> elements are
 * replaced in place (keeping their s=); missing cells are inserted in column
 * order with a style copied from the same column in another row.
 */
export function patchSheetCells(xml: string, writes: TrackerCellWrite[]): string {
  const byRow = new Map<number, { ref: string; col: number; value: string | number }[]>();
  for (const w of writes) {
    const { row, col } = parseRef(w.ref);
    const list = byRow.get(row) ?? [];
    list.push({ ref: w.ref, col, value: w.value });
    byRow.set(row, list);
  }

  for (const [row, cellsForRow] of byRow) {
    const openRe = new RegExp(`<row r="${row}"[^>]*>`);
    const openMatch = openRe.exec(xml);
    if (!openMatch) {
      throw new Error(`Template sheet has no <row r="${row}"> — unexpected template shape`);
    }
    let rowOpen = openMatch[0];
    let rowStart = openMatch.index;
    let contentStart: number;
    let contentEnd: number;
    if (rowOpen.endsWith("/>")) {
      // Self-closing row: convert to an open/close pair.
      const opened = rowOpen.slice(0, -2) + ">";
      xml = xml.slice(0, rowStart) + opened + "</row>" + xml.slice(rowStart + rowOpen.length);
      rowOpen = opened;
      contentStart = rowStart + opened.length;
      contentEnd = contentStart;
    } else {
      contentStart = rowStart + rowOpen.length;
      contentEnd = xml.indexOf("</row>", contentStart);
      if (contentEnd < 0) throw new Error(`Unterminated <row r="${row}">`);
    }
    let content = xml.slice(contentStart, contentEnd);

    for (const cell of cellsForRow.sort((a, b) => a.col - b.col)) {
      const cellRe = new RegExp(
        `<c r="${escapeRegExp(cell.ref)}"[^>]*?(?:/>|>[\\s\\S]*?</c>)`,
      );
      const existing = cellRe.exec(content);
      if (existing) {
        const styleMatch = /\bs="(\d+)"/.exec(existing[0]);
        content =
          content.slice(0, existing.index) +
          cellXml(cell.ref, cell.value, styleMatch ? styleMatch[1] : null) +
          content.slice(existing.index + existing[0].length);
      } else {
        // Insert in column order before the first cell with a higher column.
        const style = donorStyle(xml, cell.col);
        const newCell = cellXml(cell.ref, cell.value, style);
        let insertAt = content.length;
        const iter = /<c r="([A-Z]+)(\d+)"/g;
        let m: RegExpExecArray | null;
        while ((m = iter.exec(content))) {
          if (parseRef(`${m[1]}${m[2]}`).col > cell.col) {
            insertAt = m.index;
            break;
          }
        }
        content = content.slice(0, insertAt) + newCell + content.slice(insertAt);
      }
    }
    xml = xml.slice(0, contentStart) + content + xml.slice(contentEnd);
  }
  return xml;
}

interface ColEntry {
  min: number;
  max: number;
  /** Raw attribute string minus min/max/hidden. */
  rest: string;
  hidden: boolean;
}

function serializeCol(e: ColEntry): string {
  const hidden = e.hidden ? ' hidden="1"' : "";
  return `<col min="${e.min}" max="${e.max}"${e.rest}${hidden}/>`;
}

/**
 * Set hidden flags on specific 1-based columns, preserving every other
 * attribute (width/style/customWidth...). Existing <col> ranges spanning a
 * target column are split so untouched columns keep their exact state.
 */
export function patchColVisibility(
  xml: string,
  hiddenByCol: Map<number, boolean>,
): string {
  const colsMatch = /<cols>([\s\S]*?)<\/cols>/.exec(xml);
  const entries: ColEntry[] = [];
  if (colsMatch) {
    const colRe = /<col\b([^>]*?)\/>/g;
    let m: RegExpExecArray | null;
    while ((m = colRe.exec(colsMatch[1]))) {
      const attrs = m[1];
      const min = Number(/\bmin="(\d+)"/.exec(attrs)?.[1] ?? "0");
      const max = Number(/\bmax="(\d+)"/.exec(attrs)?.[1] ?? "0");
      const hidden = /\bhidden="(1|true)"/.test(attrs);
      const rest = attrs
        .replace(/\s*\bmin="\d+"/, "")
        .replace(/\s*\bmax="\d+"/, "")
        .replace(/\s*\bhidden="(?:1|true)"/, "")
        .replace(/\s+$/, "");
      if (min > 0 && max >= min) entries.push({ min, max, rest, hidden });
    }
  }

  const out: ColEntry[] = [];
  for (const e of entries) {
    // Split the range wherever a targeted column needs its own entry.
    let cursor = e.min;
    for (let c = e.min; c <= e.max; c++) {
      if (!hiddenByCol.has(c)) continue;
      if (c > cursor) out.push({ ...e, min: cursor, max: c - 1 });
      out.push({ ...e, min: c, max: c, hidden: hiddenByCol.get(c)! });
      cursor = c + 1;
    }
    if (cursor <= e.max) out.push({ ...e, min: cursor, max: e.max });
  }
  // Columns to hide that no template entry covers need fresh entries.
  const covered = (c: number) => entries.some((e) => e.min <= c && c <= e.max);
  for (const [c, hidden] of hiddenByCol) {
    if (!covered(c) && hidden) out.push({ min: c, max: c, rest: "", hidden });
  }
  out.sort((a, b) => a.min - b.min);

  const serialized = `<cols>${out.map(serializeCol).join("")}</cols>`;
  if (colsMatch) {
    return xml.slice(0, colsMatch.index) + serialized + xml.slice(colsMatch.index + colsMatch[0].length);
  }
  // No <cols> in the template sheet: insert before <sheetData>.
  return xml.replace(/<sheetData[\s>]/, (m0) => `${serialized}${m0}`);
}

/**
 * Force a full recalculation on load. Load-bearing: the tracker's sort macros
 * read cached total values, and a value-patched file has stale caches.
 */
export function forceRecalcOnLoad(workbookXml: string): string {
  const calcPr = /<calcPr\b[^>]*\/>/.exec(workbookXml);
  if (calcPr) {
    let attrs = calcPr[0].slice("<calcPr".length, -2);
    attrs = attrs.replace(/\s*\bfullCalcOnLoad="[^"]*"/, "");
    return (
      workbookXml.slice(0, calcPr.index) +
      `<calcPr${attrs} fullCalcOnLoad="1"/>` +
      workbookXml.slice(calcPr.index + calcPr[0].length)
    );
  }
  // Schema order: calcPr follows sheets/definedNames.
  const anchor = /<\/definedNames>/.exec(workbookXml) ?? /<\/sheets>/.exec(workbookXml);
  if (!anchor) throw new Error("workbook.xml has no <sheets> element");
  const at = anchor.index + anchor[0].length;
  return (
    workbookXml.slice(0, at) + `<calcPr fullCalcOnLoad="1"/>` + workbookXml.slice(at)
  );
}

/** Remove the calcChain part references (the part itself is deleted from the zip). */
export function stripCalcChainRefs(
  contentTypesXml: string,
  workbookRelsXml: string,
): { contentTypes: string; workbookRels: string } {
  return {
    contentTypes: contentTypesXml.replace(
      /<Override[^>]*PartName="\/xl\/calcChain\.xml"[^>]*\/>/,
      "",
    ),
    workbookRels: workbookRelsXml.replace(
      /<Relationship[^>]*Target="[^"]*calcChain\.xml"[^>]*\/>/,
      "",
    ),
  };
}

/**
 * Resolve a sheet's zip path ("xl/worksheets/sheetN.xml") from its display
 * name via workbook.xml → workbook.xml.rels. Never assume sheet order.
 */
export function resolveSheetPath(
  workbookXml: string,
  workbookRelsXml: string,
  sheetName: string,
): string | null {
  const name = escapeRegExp(escapeXml(sheetName));
  const sheetRe = new RegExp(`<sheet\\b[^>]*name="${name}"[^>]*>`);
  const sheet = sheetRe.exec(workbookXml);
  if (!sheet) return null;
  const rid = /\br:id="([^"]+)"/.exec(sheet[0])?.[1];
  if (!rid) return null;
  const relRe = new RegExp(`<Relationship\\b[^>]*Id="${escapeRegExp(rid)}"[^>]*/>`);
  const rel = relRe.exec(workbookRelsXml);
  if (!rel) return null;
  const target = /\bTarget="([^"]+)"/.exec(rel[0])?.[1];
  if (!target) return null;
  if (target.startsWith("/")) return target.slice(1);
  return `xl/${target}`;
}
