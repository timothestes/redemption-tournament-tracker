# Spotlight Scoreboard — Design Spec

**Date:** 2026-03-27
**Status:** Approved
**Location:** `app/decklist/card-search/`
**Depends on:** Spotlight Mode (implemented)

## Summary

Add a scoreboard below the card preview in SpotlightPanel. Two players, each with an editable name and score (0-7). Designed for streamers commentating on Redemption matches — track game score alongside the card spotlight.

## Layout

```
         [Clear X]
       [Card Image]
         [$2.50]

  ┌──────────────┐   ┌──────────────┐
  │   Player 1   │   │   Player 2   │
  │  [−]  3  [+] │   │  [−]  1  [+] │
  └──────────────┘   └──────────────┘
              [Reset]
```

- Scoreboard sits below the card image and price, centered in the panel
- Always visible in spotlight mode, even when no card is selected (empty state shows dashed placeholder above scores)
- Two player blocks side by side with a gap between them

## Player Block

Each player block contains:

- **Name** — inline-editable text. Click to edit, press Enter or blur to confirm. Defaults: "Player 1" / "Player 2".
- **Score** — large number displayed between -/+ buttons. Clamped to 0-7. Buttons visually disable at bounds (0 for minus, 7 for plus).

## Reset Button

- Small text button centered below both player blocks
- Resets both names to defaults ("Player 1" / "Player 2") and both scores to 0
- Immediate reset (no confirmation — scores are trivial to re-enter)

## State

All scoreboard state lives in `client.tsx`, passed to SpotlightPanel as props. This ensures scores persist independently of card changes.

- `player1Name: string` — default `"Player 1"`
- `player2Name: string` — default `"Player 2"`
- `player1Score: number` — default `0`
- `player2Score: number` — default `0`

Scores and names reset when leaving spotlight mode (cleared in the existing `mode === "deck"` cleanup effect).

## Files Affected

| File | Change |
|------|--------|
| `app/decklist/card-search/client.tsx` | Add 4 state variables, pass as props to SpotlightPanel, clear on mode exit |
| `app/decklist/card-search/components/SpotlightPanel.tsx` | Extend props interface, add scoreboard UI below card/price area |

## Out of Scope

- Persisting scores to localStorage or URL
- Match history / series tracking
- Timer / clock functionality
- Score animations
