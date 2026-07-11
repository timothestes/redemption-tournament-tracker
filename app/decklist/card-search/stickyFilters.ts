// Per-device "sticky" defaults for the two print/art filters in the card-search
// deckbuilder (the AB-versions mode and "No 1st Print K/L Starters"). The user's
// last-used choice is remembered across sessions and survives a filter reset,
// in both the public builder and the Forge.
//
// Design: docs/superpowers/specs/2026-07-10-sticky-print-filters-design.md

const STORAGE_KEY = "deck-sticky-filters";
// Legacy key that only ever persisted the AB toggle as a boolean (and never
// applied while a deckId was present). Read once for a seamless migration.
const LEGACY_NOAB_KEY = "deck-filter-noab";

// How AB (alternate-art booster) versions are shown:
//  - 'hide'   : hide all AB versions (historical default)
//  - 'all'    : show AB versions alongside the standard prints
//  - 'prefer' : show the AB version of any card that has one, hide its original
export type AltArtMode = "hide" | "all" | "prefer";

const ALT_ART_MODES: readonly AltArtMode[] = ["hide", "all", "prefer"];
const isAltArtMode = (v: unknown): v is AltArtMode =>
  typeof v === "string" && (ALT_ART_MODES as readonly string[]).includes(v);

export type StickyFilters = {
  /** How AB (alternate-art) versions are shown. */
  altArt: AltArtMode;
  /** true = hide 1st-print K/L starter variants. */
  noFirstPrint: boolean;
};

// Default to "hide" for AB and "hide" for 1st-print, matching the historical
// hardcoded defaults so users who have never touched these see no change.
export const DEFAULT_STICKY_FILTERS: StickyFilters = {
  altArt: "hide",
  noFirstPrint: true,
};

// Map a legacy boolean AB preference (noAltArt) to the new mode: the old toggle
// only expressed hide (true) vs show-all (false); "prefer" is new.
const altArtFromLegacyBool = (noAltArt: boolean): AltArtMode =>
  noAltArt ? "hide" : "all";

/**
 * Resolve sticky filters from raw storage values. Prefers the JSON blob under
 * `deck-sticky-filters` (accepting both the new `altArt` enum and a legacy
 * boolean `noAltArt`); falls back to the legacy `deck-filter-noab` value for a
 * one-time migration; otherwise returns defaults. Pure — takes the stored
 * strings as arguments so it stays unit-testable without a DOM.
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
          altArt: isAltArtMode(parsed.altArt)
            ? parsed.altArt
            : typeof parsed.noAltArt === "boolean"
              ? altArtFromLegacyBool(parsed.noAltArt)
              : DEFAULT_STICKY_FILTERS.altArt,
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
    altArt:
      legacyNoAb === null
        ? DEFAULT_STICKY_FILTERS.altArt
        : altArtFromLegacyBool(legacyNoAb === "true"),
    noFirstPrint: DEFAULT_STICKY_FILTERS.noFirstPrint,
  };
}

export function serializeStickyFilters(filters: StickyFilters): string {
  return JSON.stringify({
    altArt: filters.altArt,
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
