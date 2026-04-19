# Battle Bridge: Field of Battle Zone Design

**Date:** 2026-03-31
**Status:** Draft
**Branch:** spacetime-dbt-thoughts-with-new-display

## Overview

When the game enters Battle Phase, a dedicated **Field of Battle** zone expands between the two territories, giving both players a clear, structured place to position their attacking/blocking characters and enhancements. This replaces the current invisible 0.5%-height divider with a dynamic zone that borrows vertical space from both territories during battle.

## Problem

Currently, there is no "Field of Battle" in the digital board. The divider between territories is essentially invisible (0.5% of canvas height). Players have no clear place to put heroes that are attacking or evil characters that are blocking. Cards in battle are indistinguishable from cards sitting in territory. This makes it hard for both players (and spectators) to understand the game state at a glance.

In the physical card game, players push their characters forward to the center of the table. The digital version needs an equivalent.

## Goals

- Players immediately understand where to place cards when battle starts
- Cards "in battle" are visually distinct from cards "in territory"
- Enhancement stacking on characters is intuitive
- Banding (multiple characters per side) is supported
- The battle zone feels like a natural extension of the board, not a modal overlay
- Battle state (who's winning, initiative) is glanceable

## Non-Goals

- Rules enforcement (legal plays, initiative validation) — the game remains sandbox-style
- Automatic card movement (players still drag cards manually)
- Combat resolution calculator — players resolve battles manually
- Animation polish beyond basic transitions (can be refined later)

---

## Architecture

### The Battle Bridge Concept

The "Battle Bridge" is a zone that **expands from the divider** when Battle Phase starts and **collapses** when Battle Phase ends. It borrows vertical space equally from both territories, compressing them to make room.

```
NON-BATTLE LAYOUT:                    BATTLE LAYOUT:

┌──────────────────────┐              ┌──────────────────────┐
│ Opponent Hand        │              │ Opponent Hand        │
├──────────────────────┤              ├──────────────────────┤
│ Opp LOB              │              │ Opp LOB              │
├──────────────────────┤              ├──────────────────────┤
│                      │              │ Opp Territory        │
│ Opp Territory        │              │ (compressed)         │
│                      │              ├┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┤
├══════════════════════┤  ← 0.5%     │ ▲ Opp Battle Side    │
│                      │              │   (blocker + enh.)   │
│ Player Territory     │              │ ─ ─ clash line ─ ─ ─ │
│                      │              │   (attacker + enh.)  │
├──────────────────────┤              │ ▼ Player Battle Side │
│ Player LOB           │              ├┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┤
├──────────────────────┤              │ Player Territory     │
│ Player Hand          │              │ (compressed)         │
└──────────────────────┘              ├──────────────────────┤
                                      │ Player LOB           │
                                      ├──────────────────────┤
                                      │ Player Hand          │
                                      └──────────────────────┘
```

### Layout Changes

**Current layout ratios (standard profile):**

| Zone | Ratio |
|------|-------|
| Opponent Hand | 0.08 |
| Opponent Territory | 0.2775 |
| Opponent LOB | 0.09 |
| **Divider** | **0.005** |
| Player LOB | 0.09 |
| Player Territory | 0.2775 |
| Player Hand | 0.18 |

**Battle-active layout ratios (standard profile):**

| Zone | Ratio | Change |
|------|-------|--------|
| Opponent Hand | 0.08 | unchanged |
| Opponent Territory | 0.18 | -0.0975 |
| Opponent LOB | 0.09 | unchanged |
| **Field of Battle** | **0.20** | **+0.195** |
| Player LOB | 0.09 | unchanged |
| Player Territory | 0.18 | -0.0975 |
| Player Hand | 0.18 | unchanged |

**Battle-active layout ratios (narrow profile):**

| Zone | Ratio | Change |
|------|-------|--------|
| Opponent Hand | 0.07 | unchanged |
| Opponent Territory | 0.1825 | -0.0975 |
| Opponent LOB | 0.10 | unchanged |
| **Field of Battle** | **0.20** | **+0.195** |
| Player LOB | 0.10 | unchanged |
| Player Territory | 0.1825 | -0.0975 |
| Player Hand | 0.165 | unchanged |

Each territory loses ~0.1 (about 35% of its height) to create the battle zone. The battle zone at 20% of canvas height provides enough room for one row of characters plus one row of enhancements on each side.

The `calculateMultiplayerLayout` function gains an optional `battleActive: boolean` parameter. When true, it uses the battle ratios instead of the standard ones. The transition between layouts is animated via Konva tweens on all zone rects (300ms ease-in-out).

### Zone System Changes

A new zone value `"field-of-battle"` is added to the system:

| Property | Value |
|----------|-------|
| Zone key | `"field-of-battle"` |
| Type | Free-form (posX/posY positioning) |
| Drop target | Yes |
| Ownership | Cards from both players can exist here |
| Layout | Divided into two halves — player's side and opponent's side |

The `findZoneAtPosition` function is updated to recognize the battle zone. Cards dropped in the top half are placed on the opponent's side; cards dropped in the bottom half are placed on the player's side. (Relative to the viewer — each player sees their side at the bottom.)

### SpacetimeDB Schema

No schema changes needed. Cards moved to the Field of Battle use:
- `zone: "field-of-battle"` — the new zone value
- `posX`, `posY` — normalized coordinates within the battle zone rect (same 0–1 ratio system as territory)
- All existing fields (isMeek, isFlipped, counters) continue to work

The `moveCard` reducer already accepts any zone string. The client-side rendering code is where the new zone is given visual meaning.

---

## Visual Design

### Battle Zone Background

The battle zone has a distinct visual treatment that sets it apart from territory:

- **Background**: A darker, more saturated version of the cave background with a warm amber glow emanating from the center (the candle/torch motif from the existing design system). Uses the `surface-container-lowest` (#19120C) as base with a radial gradient of `primary` (#F1BD7E) at 8-12% opacity centered on the clash line.
- **Boundaries**: No hard borders (per the "No-Line Rule" from the design system). Instead, background color shift creates the zone boundaries — the battle zone is perceptibly warmer/brighter than the compressed territories.
- **Clash Line**: A subtle horizontal line at the exact center of the battle zone. Rendered as a thin (1px) gradient line using `primary` (#F1BD7E) at 30% opacity, fading to transparent at the edges. This is the conceptual "meeting point" between attacker and defender.

### Drop Guide Silhouettes

When the battle zone is empty (or has room for more cards), semi-transparent card-shaped outlines appear as placement guides:

- **Hero guide** (player's side): A card-sized rectangle with dashed outline in the hero's brigade color (or neutral gold if no card is being dragged). Label: "Hero" in small Cinzel text.
- **Blocker guide** (opponent's side): Same treatment. Label: "Blocker".
- **Enhancement guides**: When a character is placed, smaller card outlines appear to its left, cascading horizontally with slight overlap. Label: "Enhancement" on the first slot.

Guides fade out (opacity → 0) when a card is placed in that slot. They're purely visual — not enforced drop targets.

### Card Layout Within the Battle Zone

Each side of the battle zone uses a **horizontal layout**:

```
PLAYER'S BATTLE SIDE (bottom half of battle zone):

  [Enh 3] [Enh 2] [Enh 1]  [ HERO ]  [Banded Char 2] [Banded Char 3]
                                ↑
                          Primary character
                        (centered horizontally)
```

- **Primary character**: Centered horizontally in the battle side, vertically centered within the half.
- **Enhancements**: Stack to the LEFT of the character, overlapping by 40% of card width (so you can read the brigade color and title). Most recent enhancement is closest to the character.
- **Banded characters**: Spread to the RIGHT of the primary character with a small gap (8px). Each banded character can have its own enhancement cascade extending further right.

This left-to-right reading order (enhancements → character → banded) keeps the most important information (the character) central and visible.

### Battle State Indicators

Displayed at the center of the battle zone, between the two sides:

```
         ┌─────────────────────┐
         │   ATK  6/6          │
         │   ─── vs ───        │
         │   DEF  4/5          │
         └─────────────────────┘
```

- **Strength/Toughness display**: Shows combined S/T for each side. Updated live as cards enter/leave battle.
- **Position**: Overlaid on the clash line, centered horizontally.
- **Styling**: Small, semi-transparent pill using `surface-container-high` with `on-surface` text. Should not obscure cards.
- **Initiative indicator**: A small chevron or glow on the side that currently has initiative (based on who's winning/losing). This is purely informational — not enforced.

This indicator is **optional for MVP** — it can be added after the core zone works.

---

## Interaction Design

### Entering Battle Phase

1. Player clicks "BATTLE" in the phase bar (or navigates to it via arrows)
2. The divider smoothly expands into the Field of Battle zone (300ms Konva tween)
3. Territories compress equally from both sides
4. Drop guide silhouettes appear in the battle zone
5. Cards already in territory remain in territory (they don't auto-move)

### Placing Cards in Battle

1. Player drags a Hero from their territory (or hand) toward the center of the board
2. As the card crosses into the battle zone, the zone highlights (subtle border glow)
3. On drop, the card snaps to the player's battle side — centered horizontally if it's the first character
4. The drop guide for that slot fades out; enhancement guides appear to the left of the character
5. Opponent drags an Evil Character from their territory to their side of the battle zone
6. Enhancement drop targets appear next to the blocker

### Playing Enhancements

1. Player drags an Enhancement from hand toward their character in battle
2. Dropping the Enhancement anywhere on their battle side causes it to cascade to the left of the leftmost enhancement (or directly left of the character if it's the first enhancement)
3. Auto-cascade positioning: enhancements stack with 40% overlap, newest closest to the character
4. In a banded group, the enhancement cascades off the **nearest character** to the drop point. Proximity is measured from the drop coordinates to each character's center position. This is intuitive — drop near the character you want to enhance.

### Banding (Adding Characters to Battle)

1. Player drags another character to their battle side
2. The new character positions to the right of the existing character(s) with a small gap
3. Each character can then receive its own enhancement cascade

### Exiting Battle Phase

1. Player clicks a different phase in the phase bar, or the phase advances naturally
2. Cards remaining in `"field-of-battle"` zone are automatically moved back to their owner's territory via batch `moveCard` calls. They are positioned at the inner edge of territory (closest to where the battle zone was) so they appear to "slide back" into territory. A toast notifies: "Battle ended — cards returned to territory."
3. The Field of Battle zone smoothly collapses (300ms Konva tween)
4. Defeated cards (moved to discard during battle resolution) are already in the correct zone — auto-return only affects surviving characters and enhancements still in the battle zone.

### Edge Cases

- **Battle with no blocker**: Attacker places a Hero. Defender chooses not to block. The attacker's Hero stays in the battle zone alone. When the rescue resolves, the Hero returns to territory.
- **Multiple battles per turn**: In Redemption, you typically get one battle per turn, but some abilities allow multiple. The battle zone persists across the entire Battle Phase regardless of how many battles occur.
- **Cards removed from battle by abilities**: If an ability removes a character from battle, the player drags it from the battle zone back to territory (or wherever the ability specifies). The enhancement cascade for that character should be manually moved or auto-discarded per game rules (player's responsibility in sandbox mode).
- **Spectator view**: Spectators see the same battle zone expansion. No special handling needed.

---

## Implementation Components

### 1. Layout System Update (`multiplayerLayout.ts`)

Add `battleActive` parameter to `calculateMultiplayerLayout`. When true:
- Replace `dividerRatio` with `battleZoneRatio: 0.20`
- Reduce both territory ratios proportionally
- Add `fieldOfBattle` to the `zones` record in the return type
- The battle zone rect is split into two halves internally for rendering guides and snap behavior

### 2. Zone Registration (`MultiplayerCanvas.tsx`)

- Add `"field-of-battle"` to `FREE_FORM_ZONES` (or a new `BATTLE_ZONES` array)
- Update `findZoneAtPosition` to check the battle zone rect
- Update zone-to-rect mapping (`myZones` / `opponentZones`) — the battle zone is shared but each player "owns" their half
- Add zone rendering: background treatment, clash line, drop guides

### 3. Card Snap Logic (new: `battleZoneSnap.ts`)

A utility that calculates snap positions within the battle zone:
- `getCharacterSnapPosition(side: 'player' | 'opponent', characterIndex: number, zoneRect: ZoneRect): {x, y}`
- `getEnhancementSnapPosition(side: 'player' | 'opponent', characterIndex: number, enhancementIndex: number, zoneRect: ZoneRect): {x, y}`
- Called on card drop within the battle zone to suggest/snap positions
- Returns normalized 0–1 coordinates for storage in SpacetimeDB

### 4. Battle Zone Renderer (new: `BattleZoneLayer.tsx`)

A Konva `Group` component that renders:
- Background gradient/glow
- Clash line
- Drop guide silhouettes (conditional on current card count)
- Strength/toughness comparison indicator (optional/later)

### 5. Transition Animation

On phase change to/from "battle":
- Calculate both layout states (with and without battle zone)
- Tween all zone rects from current position to target position over 300ms
- Cards in territory zones reposition proportionally as their container shrinks (their normalized 0–1 positions stay the same, but the zone rect changes)

### 6. Card Return Logic

When leaving battle phase:
- Query all cards with `zone: "field-of-battle"`
- Move each card back to its owner's territory zone via `moveCard` reducer
- Position them at the edge of territory closest to where the battle zone was (so they appear to "slide back" into territory)

---

## Data Flow

```
Phase changes to "battle"
  → Client calls setPhase("battle")
  → MultiplayerCanvas detects phase === "battle"
  → calculateMultiplayerLayout(width, height, isParagon, battleActive: true)
  → Tween zone rects to new positions (300ms)
  → Render BattleZoneLayer with drop guides

Player drags Hero to battle zone
  → findZoneAtPosition returns { zone: "field-of-battle", owner: "my" }
  → battleZoneSnap calculates snap position
  → moveCard(gameId, cardId, "field-of-battle", 0, snapX, snapY)
  → SpacetimeDB updates, both clients re-render

Opponent drags Evil Character to battle zone
  → Same flow, but snap position is on opponent's half

Phase changes away from "battle"
  → Client detects phase !== "battle"
  → All cards in "field-of-battle" zone → moveCard back to territory
  → calculateMultiplayerLayout(width, height, isParagon, battleActive: false)
  → Tween zone rects back to normal positions
```

---

## Considered Alternatives

### Floating Arena Overlay

A semi-transparent panel appears over the center of the board. Cards are dragged into it.

**Rejected because**: Players need to see their territory during battle — abilities reference territory cards, you need to see what characters are available to band, and you may need to interact with artifacts or fortresses. An overlay obscures this.

### In-Place Snap Guides (No Layout Change)

Subtle drop guides appear near the divider. No layout change.

**Rejected because**: This is exactly the current problem — the divider area is too small for cards, and subtle hints don't solve "I don't know where to put my cards." The battle zone needs real space.

### Permanent Battle Zone (Always Visible)

The battle zone is always allocated, even outside Battle Phase.

**Rejected because**: This wastes valuable screen space during the majority of the game (Draw, Upkeep, Preparation, Discard phases). The dynamic expansion/collapse makes better use of the canvas.

---

## Open Questions

1. **Should the battle zone also appear during non-battle phases if cards are still in it?** (e.g., a player drags a card there during Preparation). Recommendation: No — restrict the zone to Battle Phase only. Cards left in it when phase changes get auto-returned.

2. **Should enhancement auto-cascade be "smart" (detect which character they go with) or purely positional?** Recommendation: Purely positional for MVP. If you drop an enhancement on the left side of the battle zone near a character, it cascades off the nearest character. No automatic brigade-matching logic.

3. **Should the S/T comparison indicator be part of MVP or a follow-up?** Recommendation: Follow-up. The core value is the zone itself with clear card placement. S/T display is nice-to-have polish.

4. **Card scale in battle zone**: Should battle zone cards be the same size as territory cards, or slightly larger for visibility? Recommendation: Same size as `mainCard` dimensions for consistency. The zone is large enough (20% of canvas height) to accommodate them.
