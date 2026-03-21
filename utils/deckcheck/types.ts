// Input types - what the API accepts
export interface DeckCheckCard {
  name: string;
  set: string;
  quantity: number;
  imgFile?: string;
}

export interface DeckCheckRequest {
  deckId?: string;
  cards?: DeckCheckCard[];
  reserve?: DeckCheckCard[];
  format?: string; // defaults to "Type 1"
}

// A resolved card with full data from the card database
export interface ResolvedCard {
  name: string;
  set: string;
  quantity: number;
  isReserve: boolean;
  // Card properties from the TSV database
  type: string; // Hero, Evil Character, Enhancement, Dominant, Lost Soul, etc.
  brigade: string; // Blue, Red, Black, etc. or multi like "Blue/Red"
  strength: string;
  toughness: string;
  class: string;
  identifier: string;
  specialAbility: string;
  alignment: string; // Good, Evil, Good/Evil, Neutral
  reference: string;
  imgFile: string;
  // Same-card identity
  duplicateGroupId?: number; // from duplicate_card_groups table
  canonicalName?: string; // canonical name from the group
}

// Individual validation issue
export interface DeckCheckIssue {
  type: "error" | "warning" | "info";
  rule: string; // machine-readable rule ID like "t1-deck-size", "t1-banned-card"
  message: string; // human-readable explanation
  cards?: string[]; // card names involved
}

// The full result
export interface DeckCheckResult {
  valid: boolean;
  format: string;
  issues: DeckCheckIssue[];
  stats: {
    mainDeckSize: number;
    reserveSize: number;
    totalCards: number;
    lostSoulCount: number;
    requiredLostSouls: number;
    dominantCount: number;
    siteCityCount: number;
  };
}

// Type for a card's resolved quantity across all "same card" versions
export interface CardGroup {
  canonicalName: string;
  groupId?: number;
  cards: ResolvedCard[];
  totalQuantity: number;
}
