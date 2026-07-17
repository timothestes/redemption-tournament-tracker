// lib/tournament/tableAssignment.ts
//
// Post-pairing table/seat assignment. Pure: no IO, no RNG. Decides WHERE each
// match happens; never changes who plays whom.
// Spec: docs/superpowers/specs/2026-07-15-static-seats-design.md
//
// Seat math (seats mode): table k holds seats 2k-1 (player1 chair) and 2k
// (player2 chair). A pin is a table number in tables mode, a seat number in
// seats mode.

import type { NumberingMode } from "./types";

export interface AssignOptions {
  startingTableNumber: number;
  mode: NumberingMode;
}

export interface AssignableMatch {
  player1Id: string;
  player2Id: string;
  matchOrder: number;
}

export interface AssignResult<M extends AssignableMatch> {
  /** In matchOrder order. player1Id/player2Id may be swapped vs input
   * (seats-mode chair sides). */
  matches: Array<M & { tableNumber: number }>;
  /** Participants whose pin was not honored this round. */
  overriddenPins: string[];
}

/** Table a pin points to: identity in tables mode, ceil(seat/2) in seats mode. */
function pinTable(pin: number, mode: NumberingMode): number {
  return mode === "seats" ? Math.ceil(pin / 2) : pin;
}

export function assignTables<M extends AssignableMatch>(
  matches: M[],
  pins: Map<string, number>,
  opts: AssignOptions,
): AssignResult<M> {
  const { startingTableNumber, mode } = opts;
  const overridden = new Set<string>();

  // Rank order (matchOrder asc); input order isn't guaranteed.
  const ranked = [...matches].sort((a, b) => a.matchOrder - b.matchOrder);

  // Step 1: per-match claims. A match with two pins keeps the lower value
  // (both, when they resolve to the same table — the seats 9+10 happy case).
  interface Claim {
    match: M;
    table: number;
    pinValue: number;
    pinnedIds: string[];
  }
  const claims: Claim[] = [];
  const unclaimed: M[] = [];
  for (const match of ranked) {
    const p1Pin = pins.get(match.player1Id);
    const p2Pin = pins.get(match.player2Id);
    if (p1Pin === undefined && p2Pin === undefined) {
      unclaimed.push(match);
      continue;
    }
    let pinValue: number;
    let pinnedIds: string[];
    if (p1Pin !== undefined && p2Pin !== undefined) {
      if (pinTable(p1Pin, mode) === pinTable(p2Pin, mode)) {
        pinValue = Math.min(p1Pin, p2Pin);
        pinnedIds = [match.player1Id, match.player2Id];
      } else if (p1Pin <= p2Pin) {
        pinValue = p1Pin;
        pinnedIds = [match.player1Id];
        overridden.add(match.player2Id);
      } else {
        pinValue = p2Pin;
        pinnedIds = [match.player2Id];
        overridden.add(match.player1Id);
      }
    } else if (p1Pin !== undefined) {
      pinValue = p1Pin;
      pinnedIds = [match.player1Id];
    } else {
      pinValue = p2Pin as number;
      pinnedIds = [match.player2Id];
    }
    claims.push({ match, table: pinTable(pinValue, mode), pinValue, pinnedIds });
  }

  // Step 2: resolve cross-match claims to the same table — (pin value asc,
  // matchOrder asc); first claimant keeps it, the rest drop to fill.
  claims.sort((a, b) => a.pinValue - b.pinValue || a.match.matchOrder - b.match.matchOrder);
  const taken = new Set<number>();
  const placed: Array<{ match: M; tableNumber: number; pinnedIds: string[] }> = [];
  for (const c of claims) {
    if (taken.has(c.table)) {
      for (const id of c.pinnedIds) overridden.add(id);
      unclaimed.push(c.match);
      continue;
    }
    taken.add(c.table);
    placed.push({ match: c.match, tableNumber: c.table, pinnedIds: c.pinnedIds });
  }

  // Step 3: fill — bumped + unpinned matches take the lowest free tables
  // >= startingTableNumber in rank order, skipping claimed tables.
  unclaimed.sort((a, b) => a.matchOrder - b.matchOrder);
  let next = startingTableNumber;
  for (const match of unclaimed) {
    while (taken.has(next)) next++;
    taken.add(next);
    placed.push({ match, tableNumber: next, pinnedIds: [] });
  }

  // Step 4: seats-mode chair sides — an honored pin to an even seat sits in
  // the player2 slot, odd in player1. Swaps a copy, never the input.
  const out = placed.map(({ match, tableNumber, pinnedIds }) => {
    let result: M = match;
    if (mode === "seats") {
      for (const id of pinnedIds) {
        const pin = pins.get(id) as number;
        const wantsPlayer1 = pin % 2 === 1;
        const isPlayer1 = result.player1Id === id;
        if (wantsPlayer1 !== isPlayer1) {
          result = { ...result, player1Id: result.player2Id, player2Id: result.player1Id };
        }
      }
    }
    return { ...result, tableNumber };
  });

  out.sort((a, b) => a.matchOrder - b.matchOrder);
  return { matches: out, overriddenPins: [...overridden] };
}
