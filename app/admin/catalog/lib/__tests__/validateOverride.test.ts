// app/admin/catalog/lib/__tests__/validateOverride.test.ts
import { describe, it, expect } from "vitest";
import { validateOverrideFields } from "../validateOverride";
import { CARDS } from "@/lib/cards/lookup";
import { EDITABLE_FIELDS } from "../editorShared";
// Drift guard (spec §5.2/F12): the scripts-side field list must match exactly.
import { EDITABLE_FIELDS as SCRIPT_FIELDS, IDENTITY_FIELDS as SCRIPT_IDENTITY } from "@/scripts/lib/applyCardOverrides";

describe("field-list drift guard", () => {
  it("app and scripts agree on editable + identity fields", () => {
    expect([...EDITABLE_FIELDS]).toEqual(SCRIPT_FIELDS);
    expect(SCRIPT_IDENTITY).toEqual(["name", "set", "imgFile"]);
  });
});

describe("validateOverrideFields", () => {
  it("accepts known fields, trims, and strips control characters", () => {
    const r = validateOverrideFields({ specialAbility: "  Protect.\tAll.\n " });
    expect(r.ok).toBe(true);
    if (r.ok === true) expect(r.fields.specialAbility).toBe("Protect.All.");
  });

  it("rejects identity fields, unknown fields, and non-strings", () => {
    expect(validateOverrideFields({ name: "X" }).ok).toBe(false);
    expect(validateOverrideFields({ bogus: "X" }).ok).toBe(false);
    expect(validateOverrideFields({ strength: 5 }).ok).toBe(false);
  });

  it("enum-checks legality and alignment against values present in CARDS (F10)", () => {
    const legality = CARDS.find((c) => c.legality === "Rotation")!.legality;
    expect(validateOverrideFields({ legality }).ok).toBe(true);
    expect(validateOverrideFields({ legality: "Rotaton" }).ok).toBe(false);
    expect(validateOverrideFields({ alignment: "NeitherGoodNorEvil" }).ok).toBe(false);
  });

  it("accepts a value equal to a live value — no no-op rejection (F9)", () => {
    const card = CARDS[0];
    const r = validateOverrideFields({ type: card.type });
    expect(r.ok).toBe(true);
  });

  it("caps total size at 16KB", () => {
    expect(validateOverrideFields({ specialAbility: "x".repeat(17000) }).ok).toBe(false);
  });

  it("allows explicit empty strings (clearing a field is a real override)", () => {
    const r = validateOverrideFields({ strength: "" });
    expect(r.ok).toBe(true);
    if (r.ok === true) expect(r.fields.strength).toBe("");
  });
});
