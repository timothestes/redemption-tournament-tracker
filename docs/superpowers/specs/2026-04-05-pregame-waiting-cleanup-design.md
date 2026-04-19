# Pregame Waiting Screen Cleanup

**Date:** 2026-04-05
**File:** `app/play/components/PregameScreen.tsx`

## Problem

The waiting state of `PregameScreen` has accumulated redundant UI: the invite/share action appears twice (header icon + standalone button), the lobby message input dominates the screen for a secondary feature, the "Back to lobby" link is nearly invisible at the bottom with no icon, and redundant status indicators (double bounce dots, text repeating what the player card already shows) create visual clutter. The screen's one job is to get an opponent into the game, but that purpose is buried under a flat vertical stack of equally-weighted elements.

## Changes

### 1. Game Code Header — tappable invite link

- Remove the share icon button from `GameCodeHeader` (lines 206-220).
- Make the game code text itself tappable. Tapping copies the full invite URL (`origin/play?join=CODE`). Add `cursor-pointer` and a tooltip: "Tap to copy invite link."
- Keep the existing copy-code icon button (copies raw 4-letter code only).
- Show inline "Copied!" feedback (green checkmark, same pattern already used) on either action.

### 2. Lobby message — collapse to pencil icon

- Replace the always-visible input + "Set" button in `WaitingActions` (lines 486-504) with a pencil icon button.
- Tooltip on hover: "Set lobby message."
- On click: expand inline to input (100 char max) + "Save" button (rename from "Set" for clarity).
- After saving: collapse back to pencil icon with brief "Saved!" feedback.
- If a message is already set: show a truncated text preview next to the pencil icon.
- Placement: below the player cards row, left-aligned, small and unobtrusive.

### 3. Back to lobby — icon + reposition

- Move the "Back to lobby" link (lines 152-157) from the bottom of the card to the **top-left corner**, inside the card but above the game code.
- Add a chevron-left SVG icon inline before the text.
- Bump opacity from `text-amber-200/25` to `text-amber-200/40`, hover to `/60`.

### 4. Remove redundant status indicators

- Remove the bounce dots below "Waiting for opponent to join..." (lines 479-483). The player card's "Waiting" slot already has its own bounce dots.
- Remove the "Waiting for opponent to join..." status text (line 478) entirely. The empty player slot with "Waiting" + dots communicates the state.
- Remove the `h-px` divider (line 540) above "Practice While You Wait." Use a `mt-4` gap instead.

### 5. Remove standalone Invite Link button

- Delete the entire invite link button block in `WaitingActions` (lines 507-535). This functionality is now handled by tapping the game code in the header.

## Result

The WaitingActions component shrinks to:
- Collapsed pencil icon for lobby message
- "Practice While You Wait" button (conditional on goldfish deck)

The overall card layout becomes:
1. Back to lobby (top-left, with chevron icon)
2. Game code (tappable for invite link) + copy-code icon
3. Player cards (host + waiting slot with dots)
4. Pencil icon for lobby message (expandable)
5. Practice While You Wait button (when available)

## Files Modified

- `app/play/components/PregameScreen.tsx` — all changes are in this single file
