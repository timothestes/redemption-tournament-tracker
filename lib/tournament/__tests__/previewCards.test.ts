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

  it("never repeats the same card in both slots", () => {
    // Real case, 1 deck in prod: hero sits at main[1] and there is no exact
    // Evil Character, so an independent positional fallback for slot 2 returned
    // the hero again — the community tile rendered the same art twice.
    const [p1, p2] = derivePreviewCards([ARTIFACT, HERO]);
    expect(p1).toBe("Aaron_(Di)");
    expect(p2).toBe("CoW_AB_N03-Aarons-Staff-R");
    expect(p2).not.toBe(p1);
  });

  it("returns a single preview rather than a duplicate for a one-card deck", () => {
    expect(derivePreviewCards([HERO])).toEqual(["Aaron_(Di)", null]);
  });

  it("matches dual-typed cards", () => {
    // "Behemoth" is GE/Evil Character. An exact-equality type check misses it,
    // so a deck whose only EC is dual-typed silently falls through to a
    // positional pick. Two prod decks are in exactly that shape.
    const dualEvil = card("Behemoth (RoJ AB)", "RoJ (AB)", "RoJ_AB_N25-Behemoth-R");
    expect(derivePreviewCards([HERO, ARTIFACT, dualEvil])).toEqual([
      "Aaron_(Di)",
      "RoJ_AB_N25-Behemoth-R",
    ]);
  });

  it("skips cards with no usable art instead of storing a blank cover", () => {
    // Storing a null imgFile would publish exactly the blank tile this
    // function exists to prevent.
    const artless = { ...HERO, imgFile: null };
    const forgeRef = { ...EVIL, imgFile: "forge:abc-123" };
    expect(derivePreviewCards([artless, forgeRef, ARTIFACT])).toEqual([
      "CoW_AB_N03-Aarons-Staff-R",
      null,
    ]);
  });
});
