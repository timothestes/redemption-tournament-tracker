import { describe, it, expect } from "vitest";
import { groupCommentsByCard, sinceCutoffMs, toDateInputValue } from "../setCommentsView";

const c = (over: any) => ({
  id: "m1", cardId: "c1", cardTitle: "Goliath", proposalId: null, field: null,
  suggestedValue: null, parentId: null, body: "hi", resolved: false,
  createdBy: "u1", createdAt: "2026-09-01T12:00:00Z", authorName: "Tim", ...over,
});

describe("groupCommentsByCard", () => {
  it("groups by card, newest group first, carries cardTitle, counts rendered comments", () => {
    const a1 = c({ id: "a1", cardId: "c1", cardTitle: "Goliath", createdAt: "2026-09-01T12:00:00Z" });
    const b1 = c({ id: "b1", cardId: "c2", cardTitle: "Nebbie", createdAt: "2026-09-03T12:00:00Z" });
    const groups = groupCommentsByCard([a1, b1]);
    expect(groups.map((g) => g.cardId)).toEqual(["c2", "c1"]);
    expect(groups[0].cardTitle).toBe("Nebbie");
    expect(groups[0].count).toBe(1);
    expect(groups[1].count).toBe(1);
  });

  it("puts a reply under its parent's thread, sorted ascending", () => {
    const parent = c({ id: "m1", createdAt: "2026-09-01T12:00:00Z" });
    const r1 = c({ id: "r1", parentId: "m1", createdAt: "2026-09-02T12:00:00Z" });
    const r2 = c({ id: "r2", parentId: "m1", createdAt: "2026-09-01T18:00:00Z" });
    const groups = groupCommentsByCard([parent, r1, r2]);
    expect(groups).toHaveLength(1);
    expect(groups[0].threads).toHaveLength(1);
    expect(groups[0].threads[0].replies.map((r) => r.id)).toEqual(["r2", "r1"]);
  });

  it("drops a thread whose parent and replies are all older than since", () => {
    const parent = c({ id: "m1", createdAt: "2026-09-01T12:00:00Z" });
    const groups = groupCommentsByCard([parent], { since: "2026-09-05" });
    expect(groups).toHaveLength(0);
  });

  it("keeps an old parent with a new reply as contextOnly, listing only the new reply", () => {
    const parent = c({ id: "m1", createdAt: "2026-09-01T12:00:00Z" });
    const oldReply = c({ id: "r1", parentId: "m1", createdAt: "2026-09-02T12:00:00Z" });
    const newReply = c({ id: "r2", parentId: "m1", createdAt: "2026-09-06T12:00:00Z" });
    const groups = groupCommentsByCard([parent, oldReply, newReply], { since: "2026-09-05" });
    expect(groups).toHaveLength(1);
    const thread = groups[0].threads[0];
    expect(thread.contextOnly).toBe(true);
    expect(thread.replies.map((r) => r.id)).toEqual(["r2"]);
  });

  it("unresolvedOnly drops a resolved standalone comment, but keeps a resolved parent with an unresolved reply as contextOnly", () => {
    const resolvedStandalone = c({ id: "s1", resolved: true });
    const resolvedParent = c({ id: "m1", cardId: "c2", resolved: true, createdAt: "2026-09-01T12:00:00Z" });
    const unresolvedReply = c({ id: "r1", cardId: "c2", parentId: "m1", resolved: false, createdAt: "2026-09-02T12:00:00Z" });
    const groups = groupCommentsByCard([resolvedStandalone, resolvedParent, unresolvedReply], { unresolvedOnly: true });
    expect(groups).toHaveLength(1);
    expect(groups[0].cardId).toBe("c2");
    const thread = groups[0].threads[0];
    expect(thread.contextOnly).toBe(true);
    expect(thread.replies.map((r) => r.id)).toEqual(["r1"]);
  });

  it("promotes a reply whose parent is absent from the array to a top-level thread", () => {
    const orphanReply = c({ id: "r1", parentId: "does-not-exist", createdAt: "2026-09-01T12:00:00Z" });
    const groups = groupCommentsByCard([orphanReply]);
    expect(groups).toHaveLength(1);
    expect(groups[0].threads).toHaveLength(1);
    expect(groups[0].threads[0].comment.id).toBe("r1");
    expect(groups[0].threads[0].replies).toEqual([]);
  });
});

describe("sinceCutoffMs", () => {
  it("equals Date.parse of the bare local date (no Z = local)", () => {
    expect(sinceCutoffMs("2026-09-05")).toBe(Date.parse("2026-09-05T00:00:00"));
  });
  it("returns null for empty or nonsense input", () => {
    expect(sinceCutoffMs("")).toBeNull();
    expect(sinceCutoffMs(null)).toBeNull();
    expect(sinceCutoffMs(undefined)).toBeNull();
    expect(sinceCutoffMs("nonsense")).toBeNull();
  });
});

describe("toDateInputValue", () => {
  it("round-trips through sinceCutoffMs to local midnight of the same day", () => {
    const t = Date.parse("2026-09-05T15:30:00");
    expect(sinceCutoffMs(toDateInputValue(t))).toBe(sinceCutoffMs("2026-09-05"));
  });
});
