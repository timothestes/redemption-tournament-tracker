/**
 * Section → deck_cards zone derivation for the YTG deck-contents wizard.
 * 91 of 93 deck products ship a Reserve section (product copy: "50 card
 * deck, 10 card Reserve") — those lines import as zone 'reserve'; every
 * other section (and pre-section lines) is 'main'. Maybeboard is never
 * used. The wizard derives the zone from the parsed line's section; the
 * deckLinkOps write path trusts the entry. Kept out of the parser on
 * purpose — the parser reports sections, it doesn't assign zones.
 */

export type DeckZone = "main" | "reserve";

export function sectionZone(section: string | null): DeckZone {
  if (!section) return "main";
  // Section headers can be slash-composed ("Artifacts/Covenants/Curses");
  // any "Reserve" part makes the whole section the Reserve group.
  return section.split("/").some((p) => p.trim().toLowerCase() === "reserve")
    ? "reserve"
    : "main";
}
