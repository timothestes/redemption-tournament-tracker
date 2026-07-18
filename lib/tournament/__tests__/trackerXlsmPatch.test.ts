import { describe, it, expect } from 'vitest';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import {
  forceRecalcOnLoad,
  parseRef,
  patchColVisibility,
  patchSheetCells,
  resolveSheetPath,
  stripCalcChainRefs,
} from '../trackerXlsmPatch';

// A synthetic worksheet mimicking the Excel-converted template: styled blank
// cells (the common case), a sharedStrings-typed cell, a formula cell, and a
// self-closing row.
const SHEET = [
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
  '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">',
  '<cols><col min="1" max="1" width="18" customWidth="1"/><col min="3" max="3" width="9" hidden="1"/><col min="6" max="20" width="11" customWidth="1"/></cols>',
  '<sheetData>',
  '<row r="1"><c r="A1" t="s"><v>0</v></c></row>',
  '<row r="3"><c r="A3" s="5"/><c r="B3" s="12"/><c r="F3" s="7"/><c r="G3" s="9"><f>IF(F3="bye",ABS(I3),0)</f><v>0</v></c><c r="I3" s="7"/><c r="J3" s="7"/></row>',
  '<row r="4"><c r="B4" s="12"/><c r="I4" s="7"/><c r="J4" s="7"/></row>',
  '<row r="5"/>',
  '</sheetData>',
  '</worksheet>',
].join('');

describe('parseRef', () => {
  it('parses multi-letter refs', () => {
    expect(parseRef('B3')).toEqual({ row: 3, col: 2 });
    expect(parseRef('AY202')).toEqual({ row: 202, col: 51 });
  });
});

describe('patchSheetCells', () => {
  it('replaces existing styled blanks in place, keeping s=', () => {
    const out = patchSheetCells(SHEET, [
      { ref: 'B3', value: 'Ann Example' },
      { ref: 'I3', value: 5 },
      { ref: 'J3', value: 0 },
    ]);
    expect(out).toContain('<c r="B3" s="12" t="inlineStr"><is><t>Ann Example</t></is></c>');
    expect(out).toContain('<c r="I3" s="7"><v>5</v></c>');
    expect(out).toContain('<c r="J3" s="7"><v>0</v></c>');
    // Formula cell untouched.
    expect(out).toContain('<f>IF(F3="bye",ABS(I3),0)</f>');
  });

  it('writes negative numbers (bye sentinel) and escapes XML in strings', () => {
    const out = patchSheetCells(SHEET, [
      { ref: 'I3', value: -3 },
      { ref: 'B3', value: 'A & B <Test>' },
    ]);
    expect(out).toContain('<c r="I3" s="7"><v>-3</v></c>');
    expect(out).toContain('<is><t>A &amp; B &lt;Test&gt;</t></is>');
  });

  it('inserts a missing cell in column order with a donor style', () => {
    // Row 4 has no F4; donor style for column F comes from F3 (s="7").
    const out = patchSheetCells(SHEET, [{ ref: 'F4', value: 'Bob' }]);
    const row4 = /<row r="4">([\s\S]*?)<\/row>/.exec(out)![1];
    expect(row4).toContain('<c r="F4" s="7" t="inlineStr"><is><t>Bob</t></is></c>');
    // Column order: B4 before F4 before I4.
    expect(row4.indexOf('r="B4"')).toBeLessThan(row4.indexOf('r="F4"'));
    expect(row4.indexOf('r="F4"')).toBeLessThan(row4.indexOf('r="I4"'));
  });

  it('converts a self-closing row and appends cells', () => {
    const out = patchSheetCells(SHEET, [{ ref: 'B5', value: 'Eve' }]);
    expect(out).toContain('<row r="5"><c r="B5" s="12" t="inlineStr"><is><t>Eve</t></is></c></row>');
  });

  it('preserves leading/trailing whitespace with xml:space', () => {
    const out = patchSheetCells(SHEET, [{ ref: 'B3', value: 'Ann ' }]);
    expect(out).toContain('<t xml:space="preserve">Ann </t>');
  });

  it('throws on a row the template does not have', () => {
    expect(() => patchSheetCells(SHEET, [{ ref: 'B300', value: 'x' }])).toThrow(/row/);
  });
});

describe('patchColVisibility', () => {
  it('splits spanning ranges and preserves attributes', () => {
    // Hide round 1 (cols 6-10), show round 2 (cols 11-15) inside the 6-20 range.
    const hidden = new Map<number, boolean>();
    for (let c = 6; c <= 10; c++) hidden.set(c, true);
    for (let c = 11; c <= 15; c++) hidden.set(c, false);
    const out = patchColVisibility(SHEET, hidden);
    // Untouched entries survive verbatim semantics.
    expect(out).toContain('<col min="1" max="1" width="18" customWidth="1"/>');
    expect(out).toContain('<col min="3" max="3" width="9" hidden="1"/>');
    // Round 1 columns hidden, width preserved.
    expect(out).toContain('<col min="6" max="6" width="11" customWidth="1" hidden="1"/>');
    expect(out).toContain('<col min="10" max="10" width="11" customWidth="1" hidden="1"/>');
    // Round 2 columns visible (no hidden attr).
    expect(out).toContain('<col min="11" max="11" width="11" customWidth="1"/>');
    // Remainder of the original range intact (kept as one range).
    expect(out).toContain('<col min="16" max="20" width="11" customWidth="1"/>');
  });

  it('adds entries for hidden columns not covered by the template', () => {
    const out = patchColVisibility(SHEET, new Map([[40, true]]));
    expect(out).toContain('<col min="40" max="40" hidden="1"/>');
  });
});

describe('forceRecalcOnLoad', () => {
  it('adds fullCalcOnLoad to an existing calcPr', () => {
    const wb = '<workbook><sheets><sheet name="A" sheetId="1" r:id="rId1"/></sheets><calcPr calcId="152511"/></workbook>';
    expect(forceRecalcOnLoad(wb)).toContain('<calcPr calcId="152511" fullCalcOnLoad="1"/>');
  });

  it('replaces an existing fullCalcOnLoad value', () => {
    const wb = '<workbook><sheets/><calcPr calcId="1" fullCalcOnLoad="0"/></workbook>';
    const out = forceRecalcOnLoad(wb);
    expect(out).toContain('fullCalcOnLoad="1"');
    expect(out).not.toContain('fullCalcOnLoad="0"');
  });

  it('inserts calcPr after sheets when missing', () => {
    const wb = '<workbook><sheets><sheet name="A" sheetId="1" r:id="rId1"/></sheets></workbook>';
    expect(forceRecalcOnLoad(wb)).toContain('</sheets><calcPr fullCalcOnLoad="1"/>');
  });
});

describe('stripCalcChainRefs', () => {
  it('removes the override and the relationship', () => {
    const ct = '<Types><Override PartName="/xl/workbook.xml" ContentType="a"/><Override PartName="/xl/calcChain.xml" ContentType="b"/></Types>';
    const rels = '<Relationships><Relationship Id="rId1" Type="t" Target="worksheets/sheet1.xml"/><Relationship Id="rId9" Type="t" Target="calcChain.xml"/></Relationships>';
    const out = stripCalcChainRefs(ct, rels);
    expect(out.contentTypes).not.toContain('calcChain');
    expect(out.workbookRels).not.toContain('calcChain');
    expect(out.contentTypes).toContain('/xl/workbook.xml');
    expect(out.workbookRels).toContain('sheet1.xml');
  });
});

describe('zip round-trip (mirrors exportTracker orchestration)', () => {
  it('patches only the targeted parts and keeps vbaProject.bin byte-identical', () => {
    const vba = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 1, 2, 3, 4, 5]);
    const workbook =
      '<workbook><sheets><sheet name="2-Player (1)" sheetId="1" r:id="rId1"/></sheets><calcPr calcId="9"/></workbook>';
    const rels =
      '<Relationships><Relationship Id="rId1" Type="t" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="t" Target="calcChain.xml"/></Relationships>';
    const contentTypes =
      '<Types><Override PartName="/xl/workbook.xml" ContentType="wb"/><Override PartName="/xl/calcChain.xml" ContentType="cc"/></Types>';
    const files: Record<string, Uint8Array> = {
      '[Content_Types].xml': strToU8(contentTypes),
      'xl/workbook.xml': strToU8(workbook),
      'xl/_rels/workbook.xml.rels': strToU8(rels),
      'xl/worksheets/sheet1.xml': strToU8(SHEET),
      'xl/calcChain.xml': strToU8('<calcChain/>'),
      'xl/vbaProject.bin': vba,
    };
    const zipped = zipSync(files);

    // Same steps as prepareTrackerExport, minus supabase/fetch.
    const unzipped = unzipSync(zipped);
    const wbXml = strFromU8(unzipped['xl/workbook.xml']);
    const relsXml = strFromU8(unzipped['xl/_rels/workbook.xml.rels']);
    const sheetPath = resolveSheetPath(wbXml, relsXml, '2-Player (1)')!;
    expect(sheetPath).toBe('xl/worksheets/sheet1.xml');
    let sheetXml = strFromU8(unzipped[sheetPath]);
    sheetXml = patchSheetCells(sheetXml, [
      { ref: 'B3', value: 'Ann' },
      { ref: 'I3', value: -3 },
    ]);
    sheetXml = patchColVisibility(sheetXml, new Map([[6, true]]));
    unzipped[sheetPath] = strToU8(sheetXml);
    unzipped['xl/workbook.xml'] = strToU8(forceRecalcOnLoad(wbXml));
    delete unzipped['xl/calcChain.xml'];
    const stripped = stripCalcChainRefs(strFromU8(unzipped['[Content_Types].xml']), relsXml);
    unzipped['[Content_Types].xml'] = strToU8(stripped.contentTypes);
    unzipped['xl/_rels/workbook.xml.rels'] = strToU8(stripped.workbookRels);

    const out = unzipSync(zipSync(unzipped));
    expect(Array.from(out['xl/vbaProject.bin'])).toEqual(Array.from(vba));
    expect(out['xl/calcChain.xml']).toBeUndefined();
    expect(strFromU8(out['[Content_Types].xml'])).not.toContain('calcChain');
    expect(strFromU8(out['xl/_rels/workbook.xml.rels'])).not.toContain('calcChain');
    expect(strFromU8(out['xl/workbook.xml'])).toContain('fullCalcOnLoad="1"');
    const outSheet = strFromU8(out['xl/worksheets/sheet1.xml']);
    expect(outSheet).toContain('<is><t>Ann</t></is>');
    expect(outSheet).toContain('<c r="I3" s="7"><v>-3</v></c>');
    expect(outSheet).toContain('<f>IF(F3="bye",ABS(I3),0)</f>');
  });
});

describe('resolveSheetPath', () => {
  const wb =
    '<workbook><sheets>' +
    '<sheet name="2-Player (1)" sheetId="1" r:id="rId3"/>' +
    '<sheet name="Notes" sheetId="2" r:id="rId4"/>' +
    '</sheets></workbook>';
  const rels =
    '<Relationships>' +
    '<Relationship Id="rId3" Type="t" Target="worksheets/sheet7.xml"/>' +
    '<Relationship Id="rId4" Type="t" Target="/xl/worksheets/sheet2.xml"/>' +
    '</Relationships>';

  it('resolves by name through rels, never by order', () => {
    expect(resolveSheetPath(wb, rels, '2-Player (1)')).toBe('xl/worksheets/sheet7.xml');
    expect(resolveSheetPath(wb, rels, 'Notes')).toBe('xl/worksheets/sheet2.xml');
  });

  it('returns null for unknown sheets', () => {
    expect(resolveSheetPath(wb, rels, 'Multi-Player (1)')).toBeNull();
  });
});
