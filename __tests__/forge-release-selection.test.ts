import { describe, it, expect } from "vitest";
import {
  groupRoster, defaultSelection, isCloseEligible, sameSelection,
  type RosterCard,
} from "@/app/forge/lib/releaseSelection";

const card = (id: string, status: string, approved = false): RosterCard => ({
  id, title: `Card ${id}`, status, approvedVersionId: approved ? `v-${id}` : null,
});

describe("groupRoster", () => {
  it("groups approved / unapproved / promoted and excludes archived", () => {
    const roster = groupRoster([
      card("a", "approved", true),
      card("b", "draft"),
      card("c", "playtesting"),
      card("d", "promoted"),
      card("e", "archived"),
    ]);
    expect(roster.map((r) => [r.cardId, r.group])).toEqual([
      ["a", "approved"], ["b", "unapproved"], ["c", "unapproved"], ["d", "promoted"],
    ]);
  });

  it("treats approved-without-version as unapproved (not selectable)", () => {
    const roster = groupRoster([card("a", "approved", false)]);
    expect(roster[0].group).toBe("unapproved");
  });

  it("falls back to Untitled for a null title", () => {
    const roster = groupRoster([{ id: "a", title: null, status: "draft", approvedVersionId: null }]);
    expect(roster[0].title).toBe("Untitled");
  });
});

describe("defaultSelection", () => {
  it("selects exactly the approved group", () => {
    const roster = groupRoster([card("a", "approved", true), card("b", "draft"), card("d", "promoted")]);
    expect(defaultSelection(roster)).toEqual(["a"]);
  });
});

describe("isCloseEligible", () => {
  const roster = groupRoster([
    card("a", "approved", true), card("b", "approved", true), card("d", "promoted"),
  ]);
  it("true when every non-promoted card is selected", () => {
    expect(isCloseEligible(roster, ["a", "b"])).toBe(true);
  });
  it("false on a partial selection", () => {
    expect(isCloseEligible(roster, ["a"])).toBe(false);
  });
  it("false whenever an unapproved card exists (it can never be selected)", () => {
    const withDraft = groupRoster([card("a", "approved", true), card("b", "draft")]);
    expect(isCloseEligible(withDraft, ["a"])).toBe(false);
  });
});

describe("sameSelection", () => {
  it("is order-insensitive and exact", () => {
    expect(sameSelection(["a", "b"], ["b", "a"])).toBe(true);
    expect(sameSelection(["a"], ["a", "b"])).toBe(false);
  });
});
