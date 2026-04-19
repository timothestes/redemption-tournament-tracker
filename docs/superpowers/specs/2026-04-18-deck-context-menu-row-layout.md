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

- Make the count-of-1 action visibly obvious by giving it the same boxed-chip affordance as `3` / `6` / `X`.
- Render quick-counts in ascending reading order (`1 -> 3 -> 6 -> X`).
- Preserve the wide label click target as a muscle-memory shortcut for count-of-1.
- Equalize the visual weight of the `X` custom-count chip with its numeric siblings.
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
[icon Draw]    [1]  [3]  [6]  [X]
[icon Look]    [1]  [3]  [6]  [X]
[icon Reveal]  [1]  [3]  [6]  [X]
[icon Discard] [1]  [3]  [6]  [X]
[icon Reserve] [1]  [3]  [6]  [X]
```

Lucide icons per row (unchanged from today): `Play` (Draw), `Eye` (Look), `Sparkles` (Reveal), `Trash2` (Discard), `Archive` (Reserve).

- **Label (left):** icon + verb text (e.g. `Draw`, `Look`). The label takes `flex: 1` and is a wide click target that fires `onAction(1)`.
- **`[1]` chip:** same 36×36 boxed style as `[3]` / `[6]`; fires `onAction(1)`. Deliberately redundant with the label click — the label provides the wide Fitts's-Law target (muscle memory), the chip provides visible affordance so every count shares the same chip vocabulary.
- **`[3]` / `[6]` chips:** same as today — `onAction(3)` and `onAction(6)`.
- **`[X]` chip:** toggles the custom-count stepper (behavior unchanged). Font size equalized with its numeric siblings (11px, inherited from `QUICK_COUNT_STYLE`); retains `letterSpacing: '0.05em'` so `X` stays visually distinct in kind, not size.
- **Custom-count stepper:** when `X` is expanded, the stepper row (`− / count / + / Go`) renders below exactly as today.

### Conditional rendering

- `[1]` always renders (matches the always-rendering label button pattern).
- `[3]` hides when `max < 3`.
- `[6]` hides when `max < 6`.
- `[X]` and the label always render when the row is shown.

### Styling

- Label color: `var(--gf-text)` at rest, `var(--gf-text-bright)` on hover — same as today.
- Row-level hover: whole row gets `var(--gf-hover)` background — same as today.
- Per-chip hover (applies uniformly to `[1]`, `[3]`, `[6]`, `[X]`): background toggles between `rgba(196,149,90,0.12)` and `rgba(196,149,90,0.35)`; borderColor toggles between `var(--gf-border)` and `var(--gf-accent)`.
- `[1]` chip styling matches `[3]` and `[6]` exactly — no "default marker" distinction. The wide label click target is the muscle-memory shortcut; the chip is visual consistency.
- Chip gaps: 2px between all chips (`marginLeft: 2`). Right edge: `marginRight: 10` on `[X]` for breathing room.
- Gap between label and `[1]` chip: natural result of `flex: 1` on the label.

### What changes in code

Within `SubMenuActionRow` ([DeckContextMenu.tsx:135-261](app/shared/components/DeckContextMenu.tsx#L135-L261)):

1. Move the label button (`icon` + `{label}`) from the trailing position to the leading position. Label text is `{label}` (no appended count).
2. Insert a new `[1]` chip button between the label button and the `{max >= 3 && ...}` block. The chip uses `{ ...QUICK_COUNT_STYLE, marginLeft: 2 }`, fires `onAction(1)`, has hover handlers matching the `[3]` / `[6]` chips, `title={\`${label} 1\`}`, and renders the text `1`.
3. Change the `[3]` chip's `marginLeft` from `10` to `2` (no longer the leftmost element in the chip group).
4. Add `marginRight: 10` to the `[X]` toggle's style (now the rightmost element).
5. Remove the `fontSize: 9` override on the `[X]` toggle so it inherits `fontSize: 11` from `QUICK_COUNT_STYLE`. Keep `letterSpacing: '0.05em'`.
6. Keep the label button's `flex: 1`, `paddingLeft: 8`, `background: 'transparent'`, and `onClick={() => onAction(1)}`.

## Risk & Rollback

- **Risk:** Low. Single component, no prop changes, no callsite changes, no new callbacks. Visual regression risk only, confined to one menu.
- **Rollback:** Revert the single commit.

## Verification

- Open the deck right-click menu in Goldfish mode and confirm each of the three positional submenus renders the new layout correctly for all five action rows.
- Open the same menu in Multiplayer mode (both own deck and opponent's deck with `hideDrawActions`) and confirm the `Draw` row is hidden on opponent decks while the rest render correctly.
- Confirm clicking the label still fires `onAction(1)` and clicking the `[1]` chip also fires `onAction(1)`.
- Confirm `[3]`, `[6]` still fire their respective counts.
- Confirm `[X]` still opens the stepper and `Go` fires the custom count.
- Confirm `[1]` always renders; confirm `[3]` hides when the deck has `< 3` cards and `[6]` hides when the deck has `< 6` cards.
- Confirm `[X]` now renders at the same font size as `[1]` / `[3]` / `[6]` while remaining visually distinct via letter-spacing.
- Confirm submenu hover auto-close timing is unchanged (no regressions in `SubmenuTrigger`).
