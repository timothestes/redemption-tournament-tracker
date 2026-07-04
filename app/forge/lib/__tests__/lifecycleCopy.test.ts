// app/forge/lib/__tests__/lifecycleCopy.test.ts
import { describe, it, expect } from "vitest";
import {
  STATUS_LABEL, ACTION_LABEL, releaseLabel, isEligible, BULK_DONE_VERB,
} from "../lifecycleCopy";

describe("lifecycleCopy", () => {
  it("maps every status to its display label", () => {
    expect(STATUS_LABEL).toEqual({
      private_idea: "Idea",
      draft: "Draft",
      playtesting: "In playtest",
      approved: "Final",
      archived: "Shelved",
    });
  });

  it("labels the publish action by where the card is", () => {
    expect(releaseLabel("draft")).toBe("Release to playtest");
    expect(releaseLabel("playtesting")).toBe("Release update");
  });

  it("release admits draft and playtesting only", () => {
    expect(isEligible("release", "draft")).toBe(true);
    expect(isEligible("release", "playtesting")).toBe(true);
    expect(isEligible("release", "approved")).toBe(false);
    expect(isEligible("release", "archived")).toBe(false);
    expect(isEligible("release", "private_idea")).toBe(false);
  });

  it("markFinal admits playtesting only; reopen admits approved only", () => {
    expect(isEligible("markFinal", "playtesting")).toBe(true);
    expect(isEligible("markFinal", "approved")).toBe(false);
    expect(isEligible("reopen", "approved")).toBe(true);
    expect(isEligible("reopen", "playtesting")).toBe(false);
  });

  it("shelve/restore mirror archive/unarchive guards", () => {
    expect(isEligible("shelve", "draft")).toBe(true);
    expect(isEligible("shelve", "archived")).toBe(false);
    expect(isEligible("restore", "archived")).toBe(true);
    expect(isEligible("restore", "draft")).toBe(false);
  });

  it("delete admits every status", () => {
    for (const s of ["private_idea", "draft", "playtesting", "approved", "archived"]) {
      expect(isEligible("delete", s)).toBe(true);
    }
  });

  it("has a past-tense verb for every action", () => {
    for (const a of Object.keys(ACTION_LABEL)) {
      expect(BULK_DONE_VERB[a as keyof typeof BULK_DONE_VERB]).toBeTruthy();
    }
  });
});
