import { describe, it, expect } from "vitest";
import { deriveSupersededBy, buildHistory, buildCommentEras, EVENT_LABEL } from "../historyView";

const prop = (over: any) => ({
  id: "p1", cardId: "c1", baseVersionId: null, resultingVersionId: null, summary: "s",
  status: "open", proposedSnapshot: {}, createdBy: "u1", createdAt: "2026-07-01T00:00:00Z",
  closedAt: null, closedBy: null, ...over,
});
const ver = (over: any) => ({
  id: "v1", versionNumber: 1, status: "published", data: {}, note: null,
  createdBy: "u1", createdAt: "2026-07-01T00:00:00Z", authorName: "Tim", ...over,
});
const comment = (over: any) => ({
  id: "m1", cardId: "c1", proposalId: null, field: null, suggestedValue: null,
  parentId: null, body: "hi", resolved: false, createdBy: "u1",
  createdAt: "2026-07-01T12:00:00Z", authorName: "Tim", ...over,
});

describe("deriveSupersededBy", () => {
  const T = "2026-07-03T10:00:00Z";
  it("names the sibling accepted at the same instant", () => {
    const s = prop({ id: "p1", status: "superseded", closedAt: T });
    const winner = prop({ id: "p2", status: "accepted", closedAt: T, summary: "buff Goliath" });
    expect(deriveSupersededBy(s, [s, winner])).toBe("buff Goliath");
  });
  it("returns null (out of date) when no sibling was accepted then", () => {
    const s = prop({ id: "p1", status: "superseded", closedAt: T });
    const other = prop({ id: "p2", status: "accepted", closedAt: "2026-07-04T00:00:00Z" });
    expect(deriveSupersededBy(s, [s, other])).toBeNull();
  });
});

describe("buildHistory", () => {
  it("merges sources newest-first, diffs consecutive versions, attaches proposal reasons", () => {
    const v1 = ver({ id: "v1", versionNumber: 1, data: { name: "A" }, createdAt: "2026-07-01T00:00:00Z" });
    const v2 = ver({ id: "v2", versionNumber: 2, data: { name: "B" }, createdAt: "2026-07-03T00:00:00Z", note: "renamed" });
    const denied = prop({ id: "p1", status: "denied", closedAt: "2026-07-02T00:00:00Z" });
    const reason = comment({ id: "m1", proposalId: "p1", body: "too strong", createdAt: "2026-07-02T00:00:00Z" });
    const ev = { id: 1, action: "card_approved", actor: "u1", actorName: "Tim", at: "2026-07-04T00:00:00Z" };
    const h = buildHistory([v2, v1], [denied], [ev], [reason]);
    expect(h.map((e) => e.kind)).toEqual(["lifecycle", "version", "proposal", "version"]);
    const versionEntry = h[1] as any;
    expect(versionEntry.version.id).toBe("v2");
    expect(versionEntry.changes).toEqual([expect.objectContaining({ field: "name", before: "A", after: "B" })]);
    expect((h[2] as any).reasons).toEqual([expect.objectContaining({ id: "m1" })]);
  });
  it("omits open proposals (they render in the Open proposals section)", () => {
    expect(buildHistory([], [prop({ status: "open" })], [], [])).toEqual([]);
  });
  it("resolves the accepted proposal's resulting version number", () => {
    const v2 = ver({ id: "v2", versionNumber: 2, createdAt: "2026-07-03T00:00:00Z" });
    const accepted = prop({ id: "p1", status: "accepted", closedAt: "2026-07-03T00:00:00Z", resultingVersionId: "v2" });
    const h = buildHistory([v2], [accepted], [], []);
    const pe = h.find((e) => e.kind === "proposal") as any;
    expect(pe.resultingVersionNumber).toBe(2);
  });
});

describe("buildCommentEras", () => {
  it("inserts an era marker before the first comment written after each release", () => {
    const v1 = { versionNumber: 1, createdAt: "2026-07-01T00:00:00Z" };
    const v2 = { versionNumber: 2, createdAt: "2026-07-03T00:00:00Z" };
    const c1 = comment({ id: "m1", createdAt: "2026-07-02T00:00:00Z" });
    const c2 = comment({ id: "m2", createdAt: "2026-07-04T00:00:00Z" });
    expect(buildCommentEras([c1, c2], [v2, v1]).map((x) => x.kind === "era" ? `v${x.versionNumber}` : x.comment.id))
      .toEqual(["v1", "m1", "v2", "m2"]);
  });
  it("emits no markers when there are no versions", () => {
    const c1 = comment({ id: "m1" });
    expect(buildCommentEras([c1], [])).toEqual([{ kind: "comment", comment: c1 }]);
  });
});

describe("EVENT_LABEL", () => {
  it("covers all five audited actions", () => {
    for (const a of ["card_approved", "card_unapproved", "card_archived", "card_unarchived", "card_returned_to_ideas"]) {
      expect(EVENT_LABEL[a]).toBeTruthy();
    }
  });
});
