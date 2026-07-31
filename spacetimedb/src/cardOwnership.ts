// Pure card-ownership routing. No SpacetimeDB runtime imports so this can be
// unit tested in isolation (see __tests__/cardOwnership.test.ts) and shared by
// move_card and move_cards_batch in index.ts, which previously carried two
// hand-maintained copies of the same decision chain.

// Home zones = private per-player piles. Every other zone (territory, battle,
// land-of-redemption, soul-deck) is shared table space.
export const HOME_ZONES: string[] = ['deck', 'discard', 'reserve', 'banish', 'hand', 'land-of-bondage'];

// The subset of home zones whose contents the opponent cannot see.
export const HIDDEN_HOME_ZONES: string[] = ['deck', 'discard', 'reserve', 'banish', 'hand'];

// Piles a card falls into when it leaves play. These always belong to the
// card's true owner — you can never send a card into someone else's pile.
export const GRAVEYARD_PILE_ZONES: string[] = ['discard', 'reserve', 'banish'];

export interface OwnerRouting {
  /** Current owner of the card. 0n is the shared (Paragon soul) sentinel. */
  ownerId: bigint;
  /** Owner the card was dealt to; 0n when it has never changed hands. */
  originalOwnerId: bigint;
  /** Zone the card is leaving. */
  fromZone: string;
  /** Zone the card is entering. */
  toZone: string;
  /** Seat that invoked the reducer. */
  actorId: bigint;
  /** Seat whose zone the card was explicitly dropped on; null for a non-drop move. */
  targetOwnerId: bigint | null;
}

/**
 * The card's real owner — the seat its piles belong to. A captured card keeps
 * originalOwnerId pointing at the seat that brought it to the table, so it
 * finds its way home when it leaves play.
 */
export function resolveTrueHomeOwnerId(
  card: Pick<OwnerRouting, 'ownerId' | 'originalOwnerId'>,
): bigint {
  return card.originalOwnerId !== 0n ? card.originalOwnerId : card.ownerId;
}

/**
 * Owner for a card landing in a private pile.
 *
 * Normally the card's true owner. Narrow exception: when the actor pulls a card
 * OUT of an opponent's hidden pile (their deck/hand/reserve/banish/discard)
 * without naming a target seat, treat it as *taking* — route to the actor. That
 * exception is what makes "take the top card of the opponent's deck into your
 * hand" work. It deliberately does NOT apply to graveyard piles; see
 * resolveDestinationOwnerId.
 */
export function resolveHomeOwnerId(card: OwnerRouting): bigint {
  const trueHome = resolveTrueHomeOwnerId(card);
  const isTakingFromOpponentHiddenZone =
    HIDDEN_HOME_ZONES.includes(card.fromZone) && card.ownerId !== card.actorId;
  return isTakingFromOpponentHiddenZone ? card.actorId : trueHome;
}

/**
 * Which seat owns the card once it arrives in `toZone`.
 *
 * Rules, in priority order:
 *  1. An explicit drop on a seat's Land of Bondage or hand is unambiguous user
 *     intent ("take into my hand" / "give to the opponent") and always wins.
 *  2. Graveyard piles (discard / reserve / banish) always belong to the card's
 *     true owner, whoever moved it and wherever it came from.
 *  3. Other home zones route home, honoring an explicit drop on the other seat.
 *  4. Shared table zones keep the current owner unless a target seat is named.
 */
export function resolveDestinationOwnerId(card: OwnerRouting): bigint {
  const { toZone, actorId, targetOwnerId } = card;
  const trueHome = resolveTrueHomeOwnerId(card);

  const isExplicitLobDrop = toZone === 'land-of-bondage' && targetOwnerId !== null;
  const isExplicitHandDrop = toZone === 'hand' && targetOwnerId !== null;
  if (isExplicitLobDrop || isExplicitHandDrop) return targetOwnerId as bigint;

  // Unconditionally the true owner — deliberately NOT resolveHomeOwnerId. A
  // card leaving play was never *taken*, so pulling the opponent's card out of
  // their deck/hand and reserving, discarding, or banishing it fills THEIR pile.
  if (GRAVEYARD_PILE_ZONES.includes(toZone)) return trueHome;

  if (HOME_ZONES.includes(toZone)) {
    const droppedOnOwnZone = targetOwnerId === null || targetOwnerId === actorId;
    return droppedOnOwnZone ? resolveHomeOwnerId(card) : targetOwnerId;
  }

  return targetOwnerId !== null ? targetOwnerId : card.ownerId;
}
