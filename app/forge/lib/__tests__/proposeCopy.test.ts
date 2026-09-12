import { describe, it, expect } from "vitest";
import {
  PROPOSE_INTRO, PROPOSE_NEW_CARD, proposeConsequence, proposeDiffCaption, proposeEmptyNote,
} from "../proposeCopy";

describe("proposeCopy", () => {
  // The whole point of the rewrite: submitting does NOT mint a version. Only
  // accepting does (migration 075 — forge_create_proposal inserts a proposal row
  // and nothing else). Copy that says otherwise teaches the wrong model.
  it("attributes the version to accepting, never to submitting", () => {
    for (const status of ["draft", "playtesting"]) {
      const s = proposeConsequence(status);
      expect(s).toMatch(/^Accepting /);
      expect(s).not.toMatch(/submit/i);
    }
  });

  it("never predicts a version number, which is only known inside the accept transaction", () => {
    expect(proposeConsequence("draft")).not.toMatch(/v\d/);
    expect(proposeConsequence("playtesting")).not.toMatch(/v\d/);
  });

  it("says a draft card stays put and a playtest card ships", () => {
    expect(proposeConsequence("draft")).toContain("stays in Draft");
    expect(proposeConsequence("draft")).toContain("nothing reaches playtesters");
    expect(proposeConsequence("playtesting")).toContain("releases a new version to playtesters");
  });

  it("tells the reader up front that edits are already saved and already shared", () => {
    expect(PROPOSE_INTRO).toContain("save automatically");
    expect(PROPOSE_INTRO).toContain("already visible to other elders");
    expect(PROPOSE_INTRO).toContain("doesn’t make a change");
  });

  // "as last saved" was in the first draft of this copy and is false: submitting
  // flushes the editor, so the submission includes edits newer than the preview.
  it("makes no freshness promise about the diff it captions", () => {
    expect(proposeDiffCaption(3)).toBe("The current draft differs from v3 in these ways:");
    expect(proposeDiffCaption(3)).not.toMatch(/last saved/);
  });

  // Artwork is in working_art_key/working_finished_key, outside the snapshot
  // diffCards reads — so an empty field diff must not accuse the user of not editing.
  it("states the empty diff as a fact and admits artwork is not covered", () => {
    const note = proposeEmptyNote(3);
    expect(note).toContain("No field changes since v3");
    expect(note).toContain("Artwork changes aren’t listed here");
    expect(note).not.toMatch(/edit the card first/i);
  });

  it("greets a never-versioned card without a field list", () => {
    expect(PROPOSE_NEW_CARD).toContain("first submission");
  });
});
