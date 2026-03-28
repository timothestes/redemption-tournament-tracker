# Spotlight Mode — Design Spec

**Date:** 2026-03-27
**Status:** Approved
**Location:** `/app/decklist/card-search/`

## Summary

A new display mode on the card search page that replaces the deck builder panel with a single large card preview. Designed for streamers who want to commentate on Redemption cards — search on the left, spotlight a card on the right. Desktop only.

## Approach

Mode state in `client.tsx` (Approach A). A `mode` state variable controls whether the right panel renders the `DeckBuilderPanel` or a new `SpotlightPanel`. All search, filter, and grid infrastructure stays unchanged. Deck state remains intact underneath — toggling back to deck mode restores everything.

## State & URL

- `mode: "deck" | "spotlight"` — new state in `client.tsx`, default `"deck"`
- `spotlightCard: CardType | null` — the currently previewed card, default `null`
- URL param: `?mode=spotlight` synced to URL, same pattern as existing filter params
  - Entering spotlight mode sets the param; leaving removes it
  - Bookmarkable — streamers can save a direct link
- Deck state untouched while in spotlight mode — no deck operations occur
- On mobile viewports, `?mode=spotlight` falls back to normal deck mode

## Components

### Mode Toggle

- Location: existing toolbar area near panel hide/show buttons at page top
- Appearance: icon button (Lucide `Monitor` or `Presentation` icon) with "Spotlight" label
- Tooltip: "Spotlight Mode — preview cards for streaming"
- Hidden on mobile viewports
- Toggles `mode` between `"deck"` and `"spotlight"`

### `SpotlightPanel` (new component)

Renders in place of `DeckBuilderPanel` when `mode === "spotlight"`.

**Card selected (`spotlightCard !== null`):**
- Large card image centered in panel, filling available space while maintaining aspect ratio
- Price displayed below the image (if price data available)
- Clear button (X icon) at the top-right corner of the panel — sets `spotlightCard` to `null`

**Empty state (`spotlightCard === null`):**
- Clean empty panel
- Faint dashed border outline in the shape of a card (card aspect ratio placeholder)
- No text, no icons — minimal

### Card Grid Modifications (spotlight mode only)

When `mode === "spotlight"`, card grid items change:

- **+/- buttons replaced** with a single magnifying glass icon button
- Clicking the magnifying glass sets `spotlightCard` to that card
- **Three-dot menu hidden** — no deck operations in this mode
- **Quantity badges hidden** — not relevant without deck context
- **Highlight ring** on the currently spotlighted card in the grid (subtle border/ring to show which card is displayed)
- All search, filtering, sorting, and infinite scroll remain unchanged
- Grid column layout unchanged (up to 6 columns on large screens)

## Mobile Behavior

- Spotlight mode is desktop-only
- Mode toggle is hidden on mobile viewports
- Navigating to `?mode=spotlight` on mobile falls back to normal deck mode (param ignored)

## Files Affected

| File | Change |
|------|--------|
| `app/decklist/card-search/client.tsx` | Add `mode` and `spotlightCard` state, URL param sync, conditional right panel rendering, conditional card grid button rendering |
| `app/decklist/card-search/components/SpotlightPanel.tsx` | New component — card preview + clear button + empty state |
| Card grid item rendering (in `client.tsx`) | Swap +/- for magnifying glass, hide menu/badges, add highlight ring when in spotlight mode |

## Out of Scope

- Mobile spotlight mode
- Keyboard shortcuts for spotlight (e.g., arrow keys to cycle cards)
- Card detail overlay/modal in spotlight mode
- Any changes to the deck builder panel itself
- History of previously spotlighted cards
