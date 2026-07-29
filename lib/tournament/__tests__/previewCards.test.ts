import { describe, it, expect } from "vitest";
import { derivePreviewCards } from "../previewCards";
import type { DeckSnapshotCard } from "../deckSubmission";

const card = (
  name: string,
  set: string,
  imgFile: string,
  zone: "main" | "reserve" = "main",
  quantity = 1
): DeckSnapshotCard => ({ name, set, imgFile, zone, quantity });

// Real cards, so the type lookup in derivePreviewCards resolves for real.
const HERO = card("Aaron (Di)", "Di", "Aaron_(Di)");
const EVIL = card("Abaddon the Destroyer (L)", "Main", "Abaddon_the_Destroyer_(UL)");
const ARTIFACT = card("Aaron's Staff (CoW AB)", "CoW (AB)", "CoW_AB_N03-Aarons-Staff-R");
const DOMINANT = card("A New Beginning (FoM)", "FoM", "026-A-New-Beginning-R");

describe("derivePreviewCards", () => {
  it("picks the first hero and the first evil character", () => {
    expect(derivePreviewCards([ARTIFACT, HERO, DOMINANT, EVIL])).toEqual([
      "Aaron_(Di)",
      "Abaddon_the_Destroyer_(UL)",
    ]);
  });

  it("falls back to the first two main-deck cards when there is no hero or EC", () => {
    expect(derivePreviewCards([ARTIFACT, DOMINANT])).toEqual([
      "CoW_AB_N03-Aarons-Staff-R",
      "026-A-New-Beginning-R",
    ]);
  });

  it("ignores the reserve — a card the player never fields can't be the cover", () => {
    const reserveHero = { ...HERO, zone: "reserve" as const };
    const reserveEvil = { ...EVIL, zone: "reserve" as const };
    expect(derivePreviewCards([ARTIFACT, reserveHero, reserveEvil])).toEqual([
      "CoW_AB_N03-Aarons-Staff-R",
      null,
    ]);
  });

  it("returns nulls for an empty main deck rather than throwing", () => {
    expect(derivePreviewCards([])).toEqual([null, null]);
    expect(derivePreviewCards([{ ...HERO, zone: "reserve" }])).toEqual([null, null]);
  });

  it("skips zero-quantity rows", () => {
    expect(derivePreviewCards([{ ...HERO, quantity: 0 }, ARTIFACT])).toEqual([
      "CoW_AB_N03-Aarons-Staff-R",
      null,
    ]);
  });

  it("never returns a preview for a deck that would publish blank", () => {
    // Regression: the publish path hardcoded null previews for submission
    // snapshots, so QR-submitted decks landed on the community page with no
    // cover art at all.
    const [p1] = derivePreviewCards([HERO, EVIL]);
    expect(p1).not.toBeNull();
  });
});
