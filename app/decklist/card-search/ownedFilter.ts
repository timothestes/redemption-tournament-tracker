// The card-search "Collection" filter, which cycles through three states:
//
//   off     — every card (no collection filtering)
//   owned   — only cards in your collection
//   missing — only cards that are NOT in your collection (the want-list view)
//
// Ownership is name-level everywhere (any printing counts), the rule
// `ownedCardNames` / "Check my collection" already use.

export type OwnedFilterMode = "off" | "owned" | "missing";

/** Click order for the filter button: all → owned → missing → all. */
export function cycleOwnedMode(mode: OwnedFilterMode): OwnedFilterMode {
  return mode === "off" ? "owned" : mode === "owned" ? "missing" : "off";
}

/**
 * Read the `owned` search param. `true`/`false` read as "cards I do/don't own",
 * so the `?owned=true` links minted before the missing mode existed still work.
 * Anything else (absent, empty, junk) means no collection filtering.
 */
export function parseOwnedMode(param: string | null): OwnedFilterMode {
  if (param === "true") return "owned";
  if (param === "false") return "missing";
  return "off";
}

/** The `owned` param value for a mode, or null when it shouldn't be in the URL. */
export function ownedModeParam(mode: OwnedFilterMode): string | null {
  if (mode === "owned") return "true";
  if (mode === "missing") return "false";
  return null;
}

/** Button/pill label. `off` shows what a click would apply, like the other filter buttons. */
export const OWNED_MODE_LABELS: Record<OwnedFilterMode, string> = {
  off: "Cards I own",
  owned: "Cards I own",
  missing: "Cards I don't own",
};
