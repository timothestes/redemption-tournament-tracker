import type { Card } from "../../decklist/card-search/utils";

export interface CollectionCsvRow {
  card: Card;
  quantity: number;
}

export interface CsvImportResult {
  rows: CollectionCsvRow[];
  errors: string[];
  warnings: string[];
}

/** Normalize apostrophe variants so smart quotes match standard ones. */
function normalizeCardName(name: string): string {
  return name.replace(/[‘’‛′]/g, "'");
}

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/** RFC-4180 style parser: handles quoted fields, escaped quotes, commas and newlines in fields. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((f) => f.trim() !== "")) rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  row.push(field);
  if (row.some((f) => f.trim() !== "")) rows.push(row);
  return rows;
}

const QUANTITY_HEADERS = ["quantity", "qty", "count", "amount", "owned"];
const NAME_HEADERS = ["name", "card", "card name", "card_name", "cardname"];
const SET_HEADERS = ["set", "set code", "set_code", "card_set", "edition"];
const IMG_HEADERS = ["imgfile", "img file", "img_file", "image", "card_img_file"];

function findColumn(headers: string[], candidates: string[]): number {
  return headers.findIndex((h) => candidates.includes(h));
}

/**
 * Parse a collection CSV. Expects a header row; columns are matched by name
 * (Quantity/Name required, Set/ImgFile optional). Card resolution order:
 * name+set+imgFile → name+set → name+officialSet → name only (warns when
 * several printings match).
 */
export function parseCollectionCsv(text: string, allCards: Card[]): CsvImportResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const rows: CollectionCsvRow[] = [];

  const parsed = parseCsv(text.trim());
  if (parsed.length === 0) {
    return { rows, errors: ["File is empty"], warnings };
  }

  const headers = parsed[0].map((h) => h.trim().toLowerCase());
  const qtyCol = findColumn(headers, QUANTITY_HEADERS);
  const nameCol = findColumn(headers, NAME_HEADERS);
  const setCol = findColumn(headers, SET_HEADERS);
  const imgCol = findColumn(headers, IMG_HEADERS);

  if (qtyCol === -1 || nameCol === -1) {
    return {
      rows,
      errors: [
        'Could not find required columns. The CSV needs a header row with at least "Quantity" and "Name" columns.',
      ],
      warnings,
    };
  }

  // Index the catalog once so large imports stay fast
  const byFullKey = new Map<string, Card>();
  const bySetKey = new Map<string, Card>();
  const byOfficialSetKey = new Map<string, Card>();
  const byName = new Map<string, Card[]>();
  for (const card of allCards) {
    const name = normalizeCardName(card.name).toLowerCase();
    byFullKey.set(`${name}|${card.set}|${card.imgFile}`, card);
    if (!bySetKey.has(`${name}|${card.set}`)) bySetKey.set(`${name}|${card.set}`, card);
    if (!byOfficialSetKey.has(`${name}|${card.officialSet}`)) {
      byOfficialSetKey.set(`${name}|${card.officialSet}`, card);
    }
    const list = byName.get(name);
    if (list) list.push(card);
    else byName.set(name, [card]);
  }

  for (let i = 1; i < parsed.length; i++) {
    const lineNo = i + 1;
    const cols = parsed[i];
    const rawName = (cols[nameCol] || "").trim();
    const rawQty = (cols[qtyCol] || "").trim();
    if (!rawName) {
      errors.push(`Line ${lineNo}: Missing card name`);
      continue;
    }
    const quantity = parseInt(rawQty, 10);
    if (isNaN(quantity) || quantity < 1) {
      errors.push(`Line ${lineNo}: Invalid quantity "${rawQty}" for "${rawName}"`);
      continue;
    }

    const name = normalizeCardName(rawName).toLowerCase();
    const set = setCol !== -1 ? (cols[setCol] || "").trim() : "";
    const imgFile = imgCol !== -1 ? (cols[imgCol] || "").trim().replace(/\.(jpe?g|png)$/i, "") : "";

    let card: Card | undefined;
    if (set && imgFile) card = byFullKey.get(`${name}|${set}|${imgFile}`);
    if (!card && set) card = bySetKey.get(`${name}|${set}`) || byOfficialSetKey.get(`${name}|${set}`);
    if (!card) {
      const candidates = byName.get(name);
      if (!candidates || candidates.length === 0) {
        errors.push(`Line ${lineNo}: Card not found: "${rawName}"${set ? ` (${set})` : ""}`);
        continue;
      }
      card = candidates[0];
      if (candidates.length > 1) {
        warnings.push(
          `Line ${lineNo}: Multiple printings of "${rawName}" found, using ${card.set}`
        );
      } else if (set) {
        warnings.push(
          `Line ${lineNo}: Set "${set}" not found for "${rawName}", using ${card.set}`
        );
      }
    }

    rows.push({ card, quantity });
  }

  return { rows, errors, warnings };
}

/** Generate a collection CSV: Quantity,Name,Set,ImgFile — sorted by name then set. */
export function generateCollectionCsv(
  entries: { card: Card; quantity: number }[]
): string {
  const sorted = [...entries].sort(
    (a, b) =>
      a.card.name.localeCompare(b.card.name) || a.card.set.localeCompare(b.card.set)
  );
  const lines = ["Quantity,Name,Set,ImgFile"];
  for (const { card, quantity } of sorted) {
    lines.push(
      [String(quantity), csvEscape(card.name), csvEscape(card.set), csvEscape(card.imgFile)].join(",")
    );
  }
  return lines.join("\n");
}

export function downloadCollectionCsv(entries: { card: Card; quantity: number }[]) {
  const csv = generateCollectionCsv(entries);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "redemption-collection.csv";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
