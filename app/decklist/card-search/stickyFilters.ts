// Per-device "sticky" defaults for the two print/art filters in the card-search
// deckbuilder ("No AB Versions" and "No 1st Print K/L Starters"). The user's
// last-used choice is remembered across sessions and survives a filter reset,
// in both the public builder and the Forge.
//
// Design: docs/superpowers/specs/2026-07-10-sticky-print-filters-design.md

const STORAGE_KEY = "deck-sticky-filters";
// Legacy key that only ever persisted noAltArt (and never applied while a deckId
// was present). Read once for a seamless migration into STORAGE_KEY.
const LEGACY_NOAB_KEY = "deck-filter-noab";

export type StickyFilters = {
  /** true = hide AB (alternate art) versions. */
  noAltArt: boolean;
  /** true = hide 1st-print K/L starter variants. */
  noFirstPrint: boolean;
};

// Default to "hide" for both, matching the historical hardcoded defaults so
// users who have never touched these filters see no behavior change.
export const DEFAULT_STICKY_FILTERS: StickyFilters = {
  noAltArt: true,
  noFirstPrint: true,
};

/**
 * Resolve sticky filters from raw storage values. Prefers the JSON blob under
 * `deck-sticky-filters`; falls back to the legacy `deck-filter-noab` value
 * (noAltArt only) for a one-time migration; otherwise returns defaults. Pure —
 * takes the stored strings as arguments so it stays unit-testable without a DOM.
 */
export function parseStickyFilters(
  raw: string | null,
  legacyNoAb: string | null = null,
): StickyFilters {
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        return {
          noAltArt:
            typeof parsed.noAltArt === "boolean"
              ? parsed.noAltArt
              : DEFAULT_STICKY_FILTERS.noAltArt,
          noFirstPrint:
            typeof parsed.noFirstPrint === "boolean"
              ? parsed.noFirstPrint
              : DEFAULT_STICKY_FILTERS.noFirstPrint,
        };
      }
    } catch {
      // Corrupt / non-JSON value — fall through to legacy/defaults.
    }
  }
  return {
    noAltArt:
      legacyNoAb === null ? DEFAULT_STICKY_FILTERS.noAltArt : legacyNoAb === "true",
    noFirstPrint: DEFAULT_STICKY_FILTERS.noFirstPrint,
  };
}

export function serializeStickyFilters(filters: StickyFilters): string {
  return JSON.stringify({
    noAltArt: filters.noAltArt,
    noFirstPrint: filters.noFirstPrint,
  });
}

/** SSR-safe read from localStorage. Returns defaults on the server. */
export function readStickyFilters(): StickyFilters {
  if (typeof window === "undefined") return DEFAULT_STICKY_FILTERS;
  return parseStickyFilters(
    localStorage.getItem(STORAGE_KEY),
    localStorage.getItem(LEGACY_NOAB_KEY),
  );
}

/** SSR-safe write to localStorage. No-op on the server. */
export function writeStickyFilters(filters: StickyFilters): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, serializeStickyFilters(filters));
}
