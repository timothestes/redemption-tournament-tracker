export type CardSound = {
  /** Unique key used for once-per-game tracking. */
  id: string;
  /** Exact cardName to match (compared with ===). */
  cardName: string;
  /** Path under /public, e.g. "/gameplay/rawr.wav". */
  src: string;
  /** Playback volume 0..1. Defaults to 0.5. */
  volume?: number;
};

export const CARD_SOUNDS: CardSound[] = [
  {
    id: "roaring-lion",
    cardName: "Roaring Lion [2025 - Seasonal]",
    src: "/gameplay/rawr.wav",
  },
];
