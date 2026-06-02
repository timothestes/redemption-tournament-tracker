import { useEffect, useRef } from "react";
import { CARD_SOUNDS } from "@/app/shared/config/cardSounds";

/**
 * Plays a registered sound once per game the first time a matching card
 * (exact `cardName`) is present in the supplied territory cards.
 *
 * Tracking is keyed on `gameKey`; when it changes the fired set resets so the
 * sound can play again in the next game. See `app/shared/config/cardSounds.ts`.
 */
export function useCardSounds(
  territoryCards: ReadonlyArray<{ cardName: string }>,
  gameKey: string,
): void {
  const trackingRef = useRef<{ gameKey: string; fired: Set<string> }>({
    gameKey,
    fired: new Set<string>(),
  });

  useEffect(() => {
    // Reset the fired set when a new game starts.
    if (trackingRef.current.gameKey !== gameKey) {
      trackingRef.current = { gameKey, fired: new Set<string>() };
    }
    const fired = trackingRef.current.fired;

    for (const entry of CARD_SOUNDS) {
      if (fired.has(entry.id)) continue;
      if (!territoryCards.some((card) => card.cardName === entry.cardName)) continue;
      fired.add(entry.id);
      try {
        const audio = new Audio(entry.src);
        audio.volume = entry.volume ?? 0.5;
        audio.play().catch((e) => console.warn("Could not play card sound:", e));
      } catch (e) {
        console.warn("Could not play card sound:", e);
      }
    }
  }, [territoryCards, gameKey]);
}
