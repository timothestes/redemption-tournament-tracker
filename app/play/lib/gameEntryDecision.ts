// Pure decision logic for the /play/[code] create flow. Extracted from the
// React component (client.tsx) so the branching can be tested without a DOM,
// mirroring connectionResetDecision.ts.

export interface GameEntryRow {
  id: bigint;
  code: string;
  status: string;
}

/**
 * The create-entry duplicate-game guard.
 *
 * Entering /play/[code] to CREATE re-reads a `role: 'create'` instruction from
 * sessionStorage on every mount. A connection-reset remount can replay that
 * instruction AFTER the original game already finished. The upstream reconnect
 * lookup ignores finished games, so without this guard createGame fires again
 * and spawns a duplicate game under the same code (the 'Z6NJ' incident).
 *
 * If a finished game with this code already exists, the create has already
 * been fulfilled — return its id to reuse (the page then shows the ended
 * state) instead of creating a new game.
 *
 * Only applies to role 'create'. Joiners hitting a finished-only code fall
 * through to joinGame and get the normal "no game found" error. The active
 * (non-finished) reconnect case is handled upstream, so this only fires once
 * the game has finished.
 *
 * Returns the game id to reuse, or null to proceed with createGame.
 */
export function finishedGameToReuseOnCreate(
  role: 'create' | 'join',
  games: readonly GameEntryRow[],
  code: string
): bigint | null {
  if (role !== 'create') return null;
  const finished = games.find((g) => g.code === code && g.status === 'finished');
  return finished ? finished.id : null;
}
