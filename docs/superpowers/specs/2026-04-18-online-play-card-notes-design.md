# Online Play — Card Text Notes

**Date:** 2026-04-18
**Status:** Approved, ready for implementation plan

## Problem

Players need a way to annotate cards during online play with short, free-form tactical reminders (e.g., "Heal 2 next turn", "Blocks Michael only"). Paper players use sticky notes on their own cards; online play has no equivalent.

## Scope

Wire up an existing-but-dormant backend feature. The `CardInstance.notes` field, the `set_note` reducer, and the `setNote` client hook all already exist. Notes render read-only in `CardZoomModal` and `GameCardNode`. The **only missing piece** is UI to invoke `setNote`.

Out of scope: goldfish mode (already has note editing), any changes to the read-only renderers, any changes to the reducer (other than verifying length cap).

## Design decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Visibility | Everyone (both players + spectators) | Simplest; matches existing `public: true` `card_instance` table; no view filtering needed |
| Who can edit | Only the card's owner | Prevents griefing; matches paper behavior |
| Character limit | 40 chars | Room for a short phrase without feeling chat-like |
| Edit UI | Inline popover at cursor | Lightweight; doesn't break game focus |
| Clear a note | Submit empty input | One menu item handles both add and clear |

## Components

### New: `app/play/components/CardNotePopover.tsx`

Small floating input anchored at cursor coordinates.

**Props:**
```ts
{
  x: number;
  y: number;
  initialValue: string;
  onSave: (text: string) => void;
  onCancel: () => void;
}
```

**Behavior:**
- Renders a `motion.div` styled consistently with existing modals/popovers
- Single `<input maxLength={40}>` auto-focused on mount
- Char counter (e.g., `12 / 40`)
- Enter → `onSave(trimmedText)`; Escape → `onCancel()`
- Click-outside → `onCancel()`
- Viewport clamping so popover doesn't render off-screen near edges

### Modified: `app/shared/components/CardContextMenu.tsx`

Add one menu item:
- **Label:** `Add text note` when `card.notes === ""`, otherwise `Edit note: "<truncated>..."` (truncate to ~20 chars)
- **Visibility:** Only shown when the current user owns the card (`card.ownerId` maps to viewer's `Player.id`)
- **onClick:** Closes menu, calls new `onEditNote(card, cursorX, cursorY)` prop

### Modified: `app/play/components/MultiplayerCanvas.tsx`

- New state: `notePopover: { cardId: bigint; x: number; y: number; initialValue: string } | null`
- `onEditNote` handler populates the state and closes the context menu
- Render `<CardNotePopover>` conditionally at end of canvas
- `onSave` → calls existing `setNote(cardId, text)` from `useGameState`, then clears `notePopover`
- `onCancel` → clears `notePopover`

## Data flow

1. User right-clicks a card they own → `CardContextMenu` opens at cursor
2. User clicks `Add text note` / `Edit note: "..."` → menu closes, `CardNotePopover` opens at same cursor coords with `initialValue = card.notes`
3. User types (up to 40 chars, enforced by `maxLength`) → presses Enter
4. Client calls `setNote(cardId, trimmedText)` → `conn.reducers.setNote({ cardInstanceId, note })`
5. Reducer updates `CardInstance.notes` → SpacetimeDB pushes update to all subscribers
6. `GameCardNode` and `CardZoomModal` re-render with new note

## Server-side safeguards

Current `set_note` reducer at [spacetimedb/src/index.ts:2570](../../spacetimedb/src/index.ts#L2570) only checks that the card exists in the game. **Must be updated** to add:

- **Length cap at 40 chars** — `throw new SenderError('Note too long')` if `text.length > 40` (defense in depth; client already caps)
- **Ownership check** — `card.ownerId !== player.id` → `throw new SenderError('Not your card')`. `player` is already looked up via `findPlayerBySender(ctx, gameId)` at line 2577.
- **Trim on server** — store `text.trim()` so whitespace-only notes are treated as cleared

Requires republishing the SpacetimeDB module after these edits (via `spacetimedb-deploy` skill).

## Edge cases

| Case | Handling |
|------|----------|
| Note on face-down / zoned-out card | Note data is public; display still gated by existing zone visibility in `GameCardNode`. No change needed. |
| Empty input submitted | Saved as `""` — treated as "note cleared". Existing read-only renderers already hide the note bar when empty. |
| Whitespace-only input | `trim()` before save, treated as empty |
| Popover open when card gets removed/moved | Popover closes via the `notePopover` state being cleared on unmount OR the save silently no-ops if the `CardInstance` no longer exists (reducer handles gracefully) |
| Two rapid right-clicks | Second right-click on a card closes the popover (click-outside) and opens a new context menu. Standard behavior. |
| Spectator right-clicks | `Edit note` item does not appear (ownership gate); other menu items behave as usual |

## Prompt injection / XSS

- Notes are user-typed text, rendered by React (auto-escaped). No XSS vector.
- Notes are never fed to an LLM. No prompt injection concern.
- 40-char cap + client/server enforcement prevents DB bloat.

## Testing

- Manual playthrough in online play: add note, edit note, clear note (empty submit), verify opponent sees the same note.
- Verify spectator cannot edit, only view.
- Verify reducer rejects `note.length > 40` and rejects non-owner callers.

## Files touched

| File | Change |
|------|--------|
| `app/play/components/CardNotePopover.tsx` | NEW |
| `app/shared/components/CardContextMenu.tsx` | Add "Edit note" menu item + owner gate |
| `app/play/components/MultiplayerCanvas.tsx` | Wire popover state + render |
| `spacetimedb/src/index.ts` (`set_note` reducer) | Add length cap + ownership check + server-side trim |

Reducer change requires republishing the module via the `spacetimedb-deploy` skill.
