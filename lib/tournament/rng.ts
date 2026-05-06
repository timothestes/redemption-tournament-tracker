// lib/tournament/rng.ts
//
// Seeded PRNG for deterministic tournament randomness.
// See prompt_context/algorithm.md "Seeded Randomness" section for rationale.

/** FNV-1a 32-bit hash. Stable across runs and platforms. */
export function fnv1a32(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Mulberry32 PRNG. Returns a function that emits values in [0, 1). */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) | 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** PRNG seeded from (tournamentId, roundNumber). Same inputs → same sequence. */
export function rngForRound(tournamentId: string, round: number): () => number {
  return mulberry32(fnv1a32(`${tournamentId}:${round}`));
}
