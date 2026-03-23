// Seeded xorshift64 PRNG — deterministic, suitable for SpacetimeDB reducers
export function xorshift64(seed: bigint): { next: () => bigint } {
  let state = seed === 0n ? 1n : seed; // Avoid zero state
  return {
    next(): bigint {
      state ^= state << 13n;
      state ^= state >> 7n;
      state ^= state << 17n;
      state &= 0xFFFFFFFFFFFFFFFFn; // Keep within u64 range
      return state < 0n ? -state : state; // Ensure positive
    },
  };
}

// Compose a unique seed from game state to avoid collisions
export function makeSeed(
  timestamp: bigint,
  gameId: bigint,
  playerId: bigint,
  rngCounter: bigint
): bigint {
  return timestamp ^ gameId ^ (playerId << 8n) ^ (rngCounter << 16n);
}

// Fisher-Yates shuffle using seeded PRNG — mutates array in place
export function seededShuffle<T>(items: T[], seed: bigint): T[] {
  const rng = xorshift64(seed);
  for (let i = items.length - 1; i > 0; i--) {
    const rand = rng.next();
    const j = Number(rand % BigInt(i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

// Roll a die with N sides using seeded PRNG
export function seededDiceRoll(sides: number, seed: bigint): number {
  const rng = xorshift64(seed);
  return Number(rng.next() % BigInt(sides)) + 1;
}

// Generate a random 4-character game code (A-Z)
export function generateGameCode(seed: bigint): string {
  const rng = xorshift64(seed);
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += chars[Number(rng.next() % 26n)];
  }
  return code;
}
