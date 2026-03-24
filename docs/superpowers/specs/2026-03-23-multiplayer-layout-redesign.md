# Multiplayer Canvas Layout Redesign — Universal Proportions

**Date:** 2026-03-23
**Status:** Draft
**Scope:** Fix multiplayer canvas layout to work at any viewport dimension, add card loupe panel, refactor layout code

---

## Problem Statement

The multiplayer canvas layout breaks at different viewport dimensions. Cards overflow their zones, sidebar piles clip, and resizing the window causes proportional distortion. The root cause: `getCardDimensions()` only constrains card size by viewport width, never height. With two players sharing one viewport and double the zones, height-unaware card sizing causes overflow at every non-ideal dimension.

Meanwhile, goldfish looks good at every dimension because it constrains card size by **both** width and height. The multiplayer layout needs the same approach, but adapted for a two-player mirror board.

Secondary issues: the card preview panel is too small, there's no collapsible loupe like goldfish, and the layout code is tangled into the 1700-line canvas component.

---

## Design Principles

1. **Every proportion is relative** — no pixel values survive a viewport change. All dimensions computed as ratios of `stageWidth` and `stageHeight`.
2. **Cards always fit their zone** — card dimensions are constrained by the zone they appear in. Four card size tiers for different zone contexts.
3. **Asymmetric hands, equal territories** — player's hand is larger (need to read cards); opponent's hand is compact (face-down). Both territories and LOBs are equal — the game board is fair.
4. **Layout logic is separate from rendering** — proportions live in dedicated layout files, canvas just renders.

---

## Vertical Proportion Budget

The canvas receives the full viewport height (the turn bar / action buttons remain as HTML below the canvas, same as current behavior). The `stageHeight` passed to layout functions is the canvas height after subtracting the HTML turn bar.

```
┌─────────────────────────────────────────────────────┐
│ OPPONENT HAND (8%)                                  │  Face-down cards, compact
├─────────────────────────────────────────────────────┤
│                                                     │
│ OPPONENT TERRITORY (27%)                            │  Free-form card placement
│                                                     │
├─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┤
│ OPPONENT LOB (9%)                                   │  Auto-arranged strip
├═════════════════════════════════════════════════════╡
│ DIVIDER (2%)                       ║  SIDEBAR (15%) │
├═════════════════════════════════════║                │
│ PLAYER LOB (9%)                    ║  ┌───────────┐ │
├─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─║  │ OPP Piles │ │
│                                    ║  │ LOR       │ │
│ PLAYER TERRITORY (27%)            ║  │ Banish    │ │
│                                    ║  │ Reserve   │ │
│                                    ║  │ Deck      │ │
├─────────────────────────────────── ║  │ Discard   │ │
│                                    ║  ├───────────┤ │
│ PLAYER HAND (18%)                  ║  │ MY Piles  │ │
│                                    ║  │ LOR       │ │
│                                    ║  │ Banish    │ │
│                                    ║  │ Reserve   │ │
│                                    ║  │ Deck      │ │
│                                    ║  │ Discard   │ │
└────────────────────────────────────╨──┴───────────┘
```

### Exact Proportions

Territories are **equal size** for both players. The asymmetry is only in the hands.

| Zone | % of stageHeight | At 1080px | Purpose |
|------|-----------------|-----------|---------|
| Opponent hand | 8% | 86px | Face-down card backs, compact |
| Opponent territory | 27% | 292px | Free-form placement area |
| Opponent LOB | 9% | 97px | Auto-arranged lost souls strip |
| Center divider | 2% | 22px | Visual separator between players |
| Player LOB | 9% | 97px | Auto-arranged lost souls strip |
| Player territory | 27% | 292px | Free-form placement area (equal to opponent) |
| Player hand | 18% | 194px | Fan of readable card faces |
| **Total** | **100%** | **1080px** | |

**Note:** The turn bar remains as HTML outside the canvas (current behavior). The canvas `stageHeight` is `viewportHeight - turnBarHeight`. All zone percentages apply to this canvas height.

### Sidebar Proportions

The sidebar occupies 15% of `stageWidth` and the full `stageHeight`. It contains pile zones stacked vertically, split 50/50 between players.

**Standard format:** 5 zones per player (LOR, Banish, Reserve, Deck, Discard) = 10 total. Each zone gets `stageHeight * 0.10`.

**Paragon format:** 6 zones per player (adds Paragon zone) = 12 total. Each zone gets `stageHeight / 12 ≈ 0.083`.

The `calculateMultiplayerLayout` function accepts an `isParagon: boolean` parameter to adjust sidebar slot count.

---

## Four-Tier Card Sizing

The critical architectural change. All tiers use both width and height constraints. Cards adapt to their zone — smaller zones get smaller cards.

### Tier 1: Main Cards (territory, player hand)

The primary card size used in the main free-form play areas.

```typescript
function getMainCardDimensions(
  stageWidth: number, stageHeight: number, loupeWidth: number, sidebarWidth: number
): CardDimensions {
  const playWidth = stageWidth - loupeWidth - sidebarWidth;
  const widthBased = playWidth * 0.06;  // 6% of available play width

  // Height constraint: must fit in player hand zone
  const playerHandHeight = stageHeight * 0.18;
  const heightConstraint = playerHandHeight * 0.82;  // leave room for label + padding
  const heightBased = heightConstraint / CARD_ASPECT_RATIO;

  const cardWidth = Math.round(Math.min(widthBased, heightBased));
  const cardHeight = Math.round(cardWidth * CARD_ASPECT_RATIO);

  return { cardWidth, cardHeight };
}
```

**At 1920×1080 (with 260px loupe):**
- sidebarWidth = 1920 × 0.15 = 288px
- playWidth = 1920 - 260 - 288 = 1372px
- widthBased = 1372 × 0.06 = 82px
- playerHandHeight = 1080 × 0.18 = 194px
- heightConstraint = 194 × 0.82 = 159px, heightBased = 159 / 1.4 = 114px
- cardWidth = min(82, 114) = **82px**, cardHeight = **115px** ✓ fits in 194px hand

**At 1366×768:**
- sidebarWidth = 1366 × 0.15 = 205px
- playWidth = 1366 - 260 - 205 = 901px
- widthBased = 901 × 0.06 = 54px
- playerHandHeight = 768 × 0.18 = 138px
- heightConstraint = 138 × 0.82 = 113px, heightBased = 113 / 1.4 = 81px
- cardWidth = min(54, 81) = **54px**, cardHeight = **76px** ✓ fits

### Tier 2: LOB Cards (auto-arranged strips)

LOB zones are horizontal strips — cards are laid out in a row. Full-size main cards are too tall for these strips, so LOB cards scale down to fit the zone height.

```typescript
function getLobCardDimensions(mainCard: CardDimensions, lobZoneHeight: number): CardDimensions {
  const maxHeight = lobZoneHeight * 0.85;  // leave room for label
  if (mainCard.cardHeight <= maxHeight) return mainCard;  // main cards fit — use them
  const cardHeight = Math.round(maxHeight);
  const cardWidth = Math.round(cardHeight / CARD_ASPECT_RATIO);
  return { cardWidth, cardHeight };
}
```

**At 1920×1080:** lobHeight = 97px → maxH = 82px → cardHeight = 82px, cardWidth = **59px** (71% of main card) ✓
**At 1366×768:** lobHeight = 69px → maxH = 59px → cardHeight = 59px, cardWidth = **42px** ✓

### Tier 3: Opponent Hand Cards

Face-down card backs. Smaller to fit the compact opponent hand zone.

```typescript
function getOpponentHandCardDimensions(mainCard: CardDimensions, opponentHandHeight: number): CardDimensions {
  const maxHeight = opponentHandHeight * 0.78;  // leave room for label
  const heightBased = maxHeight / CARD_ASPECT_RATIO;
  const cardWidth = Math.round(Math.min(mainCard.cardWidth * 0.55, heightBased));
  const cardHeight = Math.round(cardWidth * CARD_ASPECT_RATIO);
  return { cardWidth, cardHeight };
}
```

**At 1920×1080:** opponentHand = 86px → maxH = 67px → cardWidth = min(45, 48) = **45px**, cardHeight = **63px** ✓

### Tier 4: Pile Cards (sidebar zones)

Independently sized to always fit their sidebar slot. Never derived from main card size.

```typescript
function getPileCardDimensions(sidebarSlotHeight: number): CardDimensions {
  const labelRatio = 0.22;  // 22% of slot for label + badge + padding
  const maxHeight = sidebarSlotHeight * (1 - labelRatio);
  const cardHeight = Math.round(Math.max(30, maxHeight));  // minimum 30px
  const cardWidth = Math.round(cardHeight / CARD_ASPECT_RATIO);
  return { cardWidth, cardHeight };
}
```

**At 1920×1080 (standard):** slotHeight = 1080 × 0.10 = 108px → maxH = 84px → pileCard = **60×84px** ✓
**At 1920×1080 (paragon):** slotHeight = 1080 / 12 = 90px → maxH = 70px → pileCard = **50×70px** ✓
**At 1366×768 (standard):** slotHeight = 768 × 0.10 = 77px → maxH = 60px → pileCard = **43×60px** ✓

### Size Tier Summary

| Tier | Used in | Sizing basis | At 1920×1080 |
|------|---------|--------------|--------------|
| Main | Territory, player hand | min(width%, hand height) | 82×115px |
| LOB | Both LOB strips | min(main, LOB zone height × 0.85) | 59×82px |
| Opponent hand | Opponent hand | min(main×0.55, zone height × 0.78) | 45×63px |
| Pile | All sidebar zones | zone slot height × 0.78 | 60×84px |

---

## Card Loupe Panel

Port goldfish's `CardLoupePanel` to the multiplayer context. Replaces the current small inline `CardPreviewPanel`.

### Behavior

- **Expanded**: 260px wide panel on the right, shows full-size card image of hovered card
- **Collapsed**: 36px chevron strip, click to expand
- **Toggle**: Click chevron or keyboard shortcut
- **Persistence**: Collapse state saved to localStorage with key `multiplayer-loupe-visible` (separate from goldfish's `goldfish-loupe-visible` so the two modes are independent)
- Canvas width adjusts dynamically: `playAreaWidth = stageWidth - sidebarWidth - (isExpanded ? 260 : 36)`

### Integration

The current `client.tsx` has a left sidebar (`clamp(200px, 14vw, 280px)`) containing `CardPreviewPanel` + `ChatPanel`. The redesign:

- **Left sidebar** shrinks to `ChatPanel` only (the card preview moves to the loupe)
- **Right side** gets the `CardLoupePanel` (260px expanded, 36px collapsed)
- Layout becomes: `[chat sidebar | canvas | loupe panel]`

`CardPreviewProvider` wraps the entire `GameInner` component return (covers all lifecycle render paths: waiting, playing, finished).

`MultiplayerCanvas` calls `setHoveredCard()` from `useCardPreview()` on card hover, replacing the current `onHoveredCardChange` prop callback. The `hoveredCard` state in `client.tsx` and the `CardPreviewPanel` component are deleted.

### Hover Tooltip (follow-up)

When the loupe is collapsed, a lightweight card name tooltip on hover would be nice. This is a **follow-up**, not part of this spec — the collapsed loupe chevron is enough for v1. Players can click to expand if they need to see a card.

---

## Layout Code Refactoring

### Current Structure (tangled)

```
mirrorLayout.ts (120 lines)        — zone rects only
MultiplayerCanvas.tsx (1699 lines) — EVERYTHING else:
  - card sizing, hand fan, auto-arrange, pile layout
  - drag/drop handling, zone + card rendering
  - hover/selection, context menus
```

### Proposed Structure (separated by concern)

```
app/play/layout/
  multiplayerLayout.ts        — Zone rects + all four card size tiers
                                 Single source of truth for all proportions
                                 Exports: calculateMultiplayerLayout(width, height, isParagon)
                                 Returns: { zones, sidebar, mainCard, lobCard, opponentCard, pileCard }

  multiplayerHandLayout.ts    — Hand fan positioning (adapted from goldfish handLayout.ts)
                                 Exports: calculateHandPositions(handRect, cards, cardDims, options)

  multiplayerAutoArrange.ts   — Auto-arrange logic for LOB, territory grid, sidebar piles
                                 Exports: calculateAutoArrangePositions(zone, cardCount, cardDims)

app/play/components/
  MultiplayerCanvas.tsx        — Rendering only: Konva stage, zone groups, card images
                                 Imports layout functions, doesn't compute proportions
                                 Target: < 1500 lines (down from 1699)
```

### What `calculateMultiplayerLayout` Returns

```typescript
type PileZone = 'lor' | 'banish' | 'reserve' | 'deck' | 'discard' | 'paragon';

interface MultiplayerLayout {
  // Zone rectangles
  zones: {
    opponentHand: Rect;
    opponentTerritory: Rect;
    opponentLob: Rect;
    divider: Rect;
    playerLob: Rect;
    playerTerritory: Rect;
    playerHand: Rect;
  };

  // Sidebar zone rects (5 or 6 per player depending on isParagon)
  sidebar: {
    opponent: Partial<Record<PileZone, Rect>>;
    player: Partial<Record<PileZone, Rect>>;
  };

  // Card dimensions (four tiers)
  mainCard: { cardWidth: number; cardHeight: number };
  lobCard: { cardWidth: number; cardHeight: number };
  opponentHandCard: { cardWidth: number; cardHeight: number };
  pileCard: { cardWidth: number; cardHeight: number };

  // Derived constants
  sidebarWidth: number;
  playAreaWidth: number;
}
```

---

## Migration Strategy

This is a **refactor with visual changes**. The rendering logic (drag/drop, context menus, hover effects, card images) stays the same — only the numbers change.

**Phase 1: Extract layout code**
- Create `multiplayerLayout.ts` with all proportions from this spec
- Create `multiplayerHandLayout.ts` (adapt from goldfish's `handLayout.ts`)
- Create `multiplayerAutoArrange.ts` (extract from canvas)

**Phase 2: Update MultiplayerCanvas**
- Replace inline layout math with imports from layout files
- Use four-tier card dimensions (main for territory/hand, LOB tier for LOB zones, opponent tier for opponent hand, pile tier for sidebar)
- Remove dead code from extraction

**Phase 3: Add loupe panel**
- Add `CardPreviewProvider` wrapper around `GameInner` in `client.tsx`
- Import `CardLoupePanel` from goldfish
- Use separate localStorage key (`multiplayer-loupe-visible`) — either parameterize `CardPreviewContext` or create a thin wrapper
- Wire up `setHoveredCard` on card hover in MultiplayerCanvas
- Remove old `CardPreviewPanel` and `hoveredCard` state from `client.tsx`
- Restructure sidebar: left = ChatPanel only, right = CardLoupePanel
- Update canvas width calculation for loupe

**Phase 4: Verify at multiple dimensions**
- Test at: 1920×1080, 1366×768, 1280×720, 2560×1440, mobile landscape
- Verify: cards fit all zones at every dimension, sidebar piles visible, hand cards readable, opponent hand compact, LOB cards scaled correctly

---

## Files Affected

| File | Change |
|---|---|
| `app/play/layout/multiplayerLayout.ts` | **New** — Zone rects + four-tier card sizing. Single source of proportions. Accepts `isParagon` parameter |
| `app/play/layout/multiplayerHandLayout.ts` | **New** — Hand fan positioning (adapted from goldfish) |
| `app/play/layout/multiplayerAutoArrange.ts` | **New** — Auto-arrange for LOB, territory, sidebar piles |
| `app/play/layout/mirrorLayout.ts` | **Delete** — Replaced by multiplayerLayout.ts |
| `app/play/components/MultiplayerCanvas.tsx` | **Major refactor** — Import layout functions, use four-tier card sizing, remove inline math. Target < 1500 lines |
| `app/play/components/CardPreviewPanel.tsx` | **Delete** — Replaced by CardLoupePanel |
| `app/play/[code]/client.tsx` | Add `CardPreviewProvider` wrapper around `GameInner`, import `CardLoupePanel`, restructure left sidebar to ChatPanel only, add loupe on right, remove `hoveredCard` state and `onHoveredCardChange` prop |

## Components Reused (Minimal or No Changes)

- `app/goldfish/components/CardLoupePanel.tsx` — Reused. May need localStorage key parameterization (see loupe section)
- `app/goldfish/state/CardPreviewContext.tsx` — CardPreviewProvider reused. May need localStorage key parameterization

---

## Proportions Reference Table

All values relative. Pixel values shown for reference viewports.

### Zone Heights (% of stageHeight)

| Zone | Ratio | At 1080px | At 768px |
|------|-------|-----------|----------|
| Opponent hand | 0.08 | 86px | 61px |
| Opponent territory | 0.27 | 292px | 207px |
| Opponent LOB | 0.09 | 97px | 69px |
| Center divider | 0.02 | 22px | 15px |
| Player LOB | 0.09 | 97px | 69px |
| Player territory | 0.27 | 292px | 207px |
| Player hand | 0.18 | 194px | 138px |

### Sidebar Widths

| Element | Ratio | At 1920px | At 1366px |
|---------|-------|-----------|-----------|
| Sidebar | 0.15 × stageWidth | 288px | 205px |
| Loupe (expanded) | 260px fixed | 260px | 260px |
| Play area | stageWidth - sidebar - loupe | 1372px | 901px |

### Card Dimensions at 1920×1080 (with 260px loupe)

| Tier | Width | Height | Used in |
|------|-------|--------|---------|
| Main | 82px | 115px | Both territories, player hand |
| LOB | 59px | 82px | Both LOB strips |
| Opponent hand | 45px | 63px | Opponent hand (face-down) |
| Pile | 60px | 84px | All sidebar zones |

### Card Dimensions at 1366×768 (with 260px loupe)

| Tier | Width | Height | Used in |
|------|-------|--------|---------|
| Main | 54px | 76px | Both territories, player hand |
| LOB | 42px | 59px | Both LOB strips |
| Opponent hand | 30px | 42px | Opponent hand (face-down) |
| Pile | 43px | 60px | All sidebar zones |

### Verification: Cards Fit Their Zones

**At 1920×1080:**
- Player hand: 194px zone, 115px card ✓ (59% of zone)
- Opponent hand: 86px zone, 63px card ✓ (73% of zone)
- LOB: 97px zone, 82px card ✓ (85% of zone)
- Sidebar slot: 108px zone, 84px card ✓ (78% of zone)

**At 1366×768:**
- Player hand: 138px zone, 76px card ✓ (55% of zone)
- Opponent hand: 61px zone, 42px card ✓ (69% of zone)
- LOB: 69px zone, 59px card ✓ (86% of zone)
- Sidebar slot: 77px zone, 60px card ✓ (78% of zone)

**At 1280×720 (minimum target):**
- Player hand: 130px zone → main card = min(52, 76) = 52px wide, 73px tall ✓
- Opponent hand: 58px zone → 45px × 0.78 = 35px card ✓
- LOB: 65px zone → 55px card ✓
- Sidebar slot: 72px zone → 56px card ✓

---

## Out of Scope

- Battle zone mechanics (cards battle in-place in territory)
- Mobile portrait layout (multiplayer is landscape-oriented)
- Spectator view layout changes
- Turn bar / phase indicator redesign
- Card animation during zone transitions
- Goldfish layout changes (leave as-is per user request)
- Hover tooltip when loupe collapsed (follow-up feature)
