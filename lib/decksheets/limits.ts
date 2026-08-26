import { ResolvedDeck } from "./types";
import { DeckCheckError } from "./errors";

export function enforceLimits(
  deck: ResolvedDeck,
  deckType: string,
  bypassAssertions: boolean
): void {
  if (bypassAssertions) {
    // still keep some assertions
    if (deck.mainSize > 140) {
      throw new DeckCheckError(
        "Please load a deck that contains 140 or less cards in the main deck."
      );
    }
    if (deck.reserveSize > 20) {
      throw new DeckCheckError(
        "Please load a deck that contains 20 or less cards in the reserve."
      );
    }
    return;
  }

  if (deck.mainSize < 40) {
    throw new DeckCheckError(
      "Please load a deck that contains at least 40 cards in the main deck."
    );
  }

  if (deck.mainSize > 140 && deckType === "type_2") {
    throw new DeckCheckError(
      "Please load a deck that contains 140 or less cards in the main deck for type 2"
    );
  } else if (deck.mainSize > 70 && (deckType === "type_1" || deckType === "paragon")) {
    throw new DeckCheckError(
      "Please load a deck that contains 70 or less cards in the main deck for type 1"
    );
  }

  if (deck.reserveSize > 10 && (deckType === "type_1" || deckType === "paragon")) {
    throw new DeckCheckError(
      "Please load a deck that contains 10 or less cards in the reserve for type 1"
    );
  } else if (deck.reserveSize > 20 && deckType === "type_2") {
    throw new DeckCheckError(
      "Please load a deck that contains 20 or less cards in the reserve for type 2"
    );
  }
}
