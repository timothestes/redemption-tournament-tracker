# Deck Context Menu: Row Layout Redesign

**Date:** 2026-04-18
**Status:** Approved
**Scope:** `app/shared/components/DeckContextMenu.tsx` — `SubMenuActionRow` only

## Problem

The deck right-click menu exposes five count-based actions (Draw / Look / Reveal / Discard / Reserve) inside each positional submenu (Top Card / Bottom Card / Random Card). Today each row renders as:

```
[3]  [6]  [X]  [icon Draw]
```

Clicking the `Draw` label fires `onAction(1)`, but there is no visible indicator that the label is clickable or that it targets a count of 1. Reading the row right-to-left yields the count sequence `1 -> X -> 6 -> 3`, which has no discernible order.

This creates two concrete issues:

1. **Discoverability** — new users do not know the label itself is a click target for the count-of-1 action. The behavior is effectively hidden.
2. **Ordering** — the `3 / 6 / X` chip sequence combined with the implicit `1` on the label reads as an unordered set, increasing cognitive load every time the menu is used.

## Goals

- Make the count-of-1 action visibly obvious without adding new click targets.
- Render quick-counts in ascending reading order (`1 -> 3 -> 6 -> X`).
- Preserve current click behavior: clicking the label still fires `onAction(1)`. (Required for consistency with Look / Reveal / Discard / Reserve, which also rely on the label as their 1-action target.)
- No changes to the public `DeckContextMenuProps` API.
- No changes to callsites in `MultiplayerCanvas.tsx` or `GoldfishCanvas.tsx`.

## Non-Goals

- The top-level main-menu entries (`Search Deck`, `Draw 1`, `Draw X…`, `Shuffle Deck`) are already clear and are not changed.
- The submenu trigger rows (`Top Card`, `Bottom Card`, `Random Card`) are not changed.
- The custom-count stepper component (shown when `X` is expanded) is not changed.
- The `SubmenuTrigger` hover / auto-close logic is not changed.

## Design

### New row layout

```
[icon Draw 1]    [3]  [6]  [X]
[icon Look 1]    [3]  [6]  [X]
[icon Reveal 1]  [3]  [6]  [X]
[icon Discard 1] [3]  [6]  [X]
[icon Reserve 1] [3]  [6]  [X]
```

Lucide icons per row (unchanged from today): `Play` (Draw), `Eye` (Look), `Sparkles` (Reveal), `Trash2` (Discard), `Archive` (Reserve).

- **Label (left):** icon + `"{verb} 1"` — for example, `Draw 1`, `Look 1`. The `1` is rendered as normal label text with no separate styling, so the verb and its count read as a single phrase. The label takes `flex: 1` and remains the primary click target, firing `onAction(1)`.
- **Quick-count chips (right):** `[3]`, `[6]`, `[X]` in ascending order.
  - `[3]` → `onAction(3)`
  - `[6]` → `onAction(6)`
  - `[X]` → toggles the custom-count stepper (behavior unchanged)
- **Custom-count stepper:** when `X` is expanded, the stepper row (`− / count / + / Go`) renders below exactly as today.

### Conditional rendering

Unchanged from today:
- `[3]` hides when `max < 3`.
- `[6]` hides when `max < 6`.
- `[X]` and the label always render when the row is shown (any non-empty deck).

### Styling

- Label color: `var(--gf-text)` at rest, `var(--gf-text-bright)` on hover — same as today.
- Row-level hover: whole row gets `var(--gf-hover)` background — same as today.
- Per-chip hover: stronger accent (`rgba(196,149,90,0.35)` background, `var(--gf-accent)` border) — same as today.
- Horizontal spacing: label takes left padding consistent with today's right-anchored label; chip group takes right padding symmetric with that value so the row is visually balanced.
- Chip gaps between `3`, `6`, `X`: 2px (matches current value).
- Gap between label and first chip: preserved as the natural result of `flex: 1` on the label.

### What changes in code

Within `SubMenuActionRow` ([DeckContextMenu.tsx:135-261](app/shared/components/DeckContextMenu.tsx#L135-L261)):

1. Reorder JSX children of the row so the label (icon + text) comes first, followed by `[3]`, `[6]`, `[X]` in that order.
2. Change the label text from `{label}` to `{label} 1`.
3. Adjust `marginLeft` values on chips so the first chip now has minimal left gap (it sits next to the flex-filling label) and the last chip has right padding matching the row's left padding.
4. Ensure the label button retains `flex: 1` so it fills available width and remains a large click target.

## Risk & Rollback

- **Risk:** Low. Single component, no prop changes, no callsite changes, no new callbacks. Visual regression risk only, confined to one menu.
- **Rollback:** Revert the single commit.

## Verification

- Open the deck right-click menu in Goldfish mode and confirm each of the three positional submenus renders the new layout correctly for all five action rows.
- Open the same menu in Multiplayer mode (both own deck and opponent's deck with `hideDrawActions`) and confirm the `Draw` row is hidden on opponent decks while the rest render correctly.
- Confirm clicking the label still fires `onAction(1)`.
- Confirm `[3]`, `[6]` still fire their respective counts.
- Confirm `[X]` still opens the stepper and `Go` fires the custom count.
- Confirm `[3]` hides when the deck has `< 3` cards and `[6]` hides when the deck has `< 6` cards.
- Confirm submenu hover auto-close timing is unchanged (no regressions in `SubmenuTrigger`).
