/**
 * Monte Carlo M count + Ancient of Days breakdown.
 *
 * Transcription of redemption-tournament-api/src/utilities/decklist.py:196-334
 * (Decklist.calculate_m_count / Decklist.calculate_aod_breakdown). Both are
 * randomized simulations (10,000 draws each), so parity with the Python
 * fixtures is statistical, not exact — see counts.test.ts for tolerances.
 */
import type { ResolvedCard } from "./types";

const NUM_SIMULATIONS = 10_000;

/**
 * Partial Fisher-Yates: shuffles the first k positions of a copy of `arr`
 * and returns those k elements, sampling WITHOUT replacement.
 */
function sampleWithoutReplacement<T>(arr: T[], k: number): T[] {
  const a = arr.slice();
  for (let i = 0; i < k; i++) {
    const j = i + Math.floor(Math.random() * (a.length - i));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, k);
}

/**
 * Expected number of unique brigades when randomly drawing up to 8 non-Lost-Soul
 * cards from the main deck. Parity with Python calculate_m_count.
 */
export function calculateMCount(main: Map<string, ResolvedCard>): number {
  const nonLostSoulCards: string[][] = [];
  for (const card of main.values()) {
    if ((card.type || "").toLowerCase() !== "lost soul") {
      for (let i = 0; i < card.quantity; i++) {
        nonLostSoulCards.push(card.brigades);
      }
    }
  }

  if (nonLostSoulCards.length === 0) return 0.0;

  const sampleSize = Math.min(8, nonLostSoulCards.length);

  let totalUniqueBrigades = 0;
  for (let sim = 0; sim < NUM_SIMULATIONS; sim++) {
    const sampled = sampleWithoutReplacement(nonLostSoulCards, sampleSize);
    const uniqueBrigades = new Set<string>();
    for (const brigades of sampled) {
      for (const b of brigades) uniqueBrigades.add(b);
    }
    totalUniqueBrigades += uniqueBrigades.size;
  }

  return Math.round((totalUniqueBrigades / NUM_SIMULATIONS) * 100) / 100;
}

export interface AodBreakdown {
  aod_count: number;
  soul_aod_count: number;
  whiff_percentage: number;
}

/**
 * Run one Monte Carlo simulation of the top of the deck and return the full
 * AoD breakdown. Parity with Python calculate_aod_breakdown.
 */
export function calculateAodBreakdown(main: Map<string, ResolvedCard>): AodBreakdown {
  const allCards: Array<[string, boolean]> = [];
  for (const [cardName, card] of main.entries()) {
    if (cardName === "The Ancient of Days") continue;

    const reference = card.reference || "";
    const isLostSoul = (card.type || "").toLowerCase() === "lost soul";
    for (let i = 0; i < card.quantity; i++) {
      allCards.push([reference, isLostSoul]);
    }
  }

  if (allCards.length < 9) {
    return { aod_count: 0.0, soul_aod_count: 0.0, whiff_percentage: 0.0 };
  }

  let nonSoulTotal = 0;
  let soulTotal = 0;
  let whiffs = 0;

  for (let sim = 0; sim < NUM_SIMULATIONS; sim++) {
    const shuffled = sampleWithoutReplacement(allCards, allCards.length);

    const first3 = shuffled.slice(0, 3);
    const triggered = first3.some(([ref]) => ref && ref.includes("Daniel"));

    if (!triggered) {
      whiffs++;
      continue;
    }

    const top9 = shuffled.slice(0, 9);
    for (const [ref, isLostSoul] of top9) {
      if (ref && ref.includes("Daniel")) {
        if (isLostSoul) soulTotal++;
        else nonSoulTotal++;
      }
    }
  }

  return {
    aod_count: Math.round((nonSoulTotal / NUM_SIMULATIONS) * 100) / 100,
    soul_aod_count: Math.round(((nonSoulTotal + soulTotal) / NUM_SIMULATIONS) * 100) / 100,
    whiff_percentage: Math.round(((whiffs / NUM_SIMULATIONS) * 100) * 100) / 100,
  };
}
