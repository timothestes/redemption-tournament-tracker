import { CARDS } from "@/lib/cards/lookup";
import { EDITABLE_FIELDS, IDENTITY_FIELDS, type EditableField } from "./editorShared";

const CONTROL_CHARS = /[\x00-\x1F\x7F]/g; // TSV-inexpressible; untested downstream
const MAX_FIELDS_BYTES = 16 * 1024;

// Enum sets built lazily from the catalog itself: the legal values are exactly
// the values the data already uses (upstream is the authority, not a hardcoded list).
let enumSets: { legality: Set<string>; alignment: Set<string> } | null = null;
function getEnumSets() {
  if (!enumSets) {
    enumSets = { legality: new Set<string>(), alignment: new Set<string>() };
    for (const c of CARDS) {
      enumSets.legality.add(c.legality);
      enumSets.alignment.add(c.alignment);
    }
  }
  return enumSets;
}

export function validateOverrideFields(
  input: Record<string, unknown>,
): { ok: true; fields: Record<string, string> } | { ok: false; error: string } {
  const fields: Record<string, string> = {};
  for (const [key, raw] of Object.entries(input)) {
    if ((IDENTITY_FIELDS as readonly string[]).includes(key)) {
      return { ok: false, error: `"${key}" is an identity field and cannot be overridden` };
    }
    if (!(EDITABLE_FIELDS as readonly string[]).includes(key)) {
      return { ok: false, error: `Unknown field "${key}"` };
    }
    if (typeof raw !== "string") {
      return { ok: false, error: `Field "${key}" must be a string` };
    }
    const value = raw.replace(CONTROL_CHARS, "").trim();
    if (key === "legality" && value !== "" && !getEnumSets().legality.has(value)) {
      return { ok: false, error: `"${value}" is not a legality value used anywhere in the catalog` };
    }
    if (key === "alignment" && value !== "" && !getEnumSets().alignment.has(value)) {
      return { ok: false, error: `"${value}" is not an alignment value used anywhere in the catalog` };
    }
    fields[key as EditableField] = value;
  }
  if (JSON.stringify(fields).length > MAX_FIELDS_BYTES) {
    return { ok: false, error: "Override too large" };
  }
  return { ok: true, fields };
}
