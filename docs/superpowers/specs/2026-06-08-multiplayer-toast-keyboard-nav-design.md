# Keyboard selection for multiplayer toasts

**Date:** 2026-06-08

## Goal

Let players resolve every interactive toast in multiplayer mode (`app/play`) from
the keyboard: `←`/`→` move the selection, `Enter` confirms the affirmative
("yes" / green) default, and `Esc` triggers the negative response.

## Shared core

New module `app/shared/components/toastKeyboardNav.ts`:

- A module-level **stack** of registered toast entries and a single
  `document` `keydown` listener (capture phase), installed lazily on first
  registration.
- The listener routes a key only to the **active** entry — the one with the
  highest `priority`, ties broken by most-recently-registered. This keeps
  stacked prompts (multiple card-choice prompts, multiple spectator banners)
  and cross-component overlap from double-firing.
- **Input guard:** keystrokes are ignored when focus is in an
  `input`/`textarea`/`select`/`contenteditable` (so the chat panel keeps working).
- The listener `preventDefault`/`stopPropagation`s only when an entry actually
  handled the key — when no toast is up, arrows/Enter/Esc behave normally.

Pure, unit-tested functions:

- `dispatchToastKey(key, isTextInput, entries)` → routes `ArrowLeft`,
  `ArrowRight`, `Enter`, `Escape` to the active entry's `onLeft`/`onRight`/
  `onEnter`/`onEscape`; returns whether it handled the key.
- `pickActiveEntry(entries)` → highest priority, latest wins ties.

Hook `useToastKeyboardNav({ count, defaultIndex, enabled, priority, onSelect, onCancel })`
→ `{ focusedIndex, setFocusedIndex }`:

- Seeds `focusedIndex` to `defaultIndex`; resets when re-enabled or when
  `count`/`defaultIndex` change.
- `←`/`→` move with wrap-around; `Enter` fires `onSelect(focusedIndex)`;
  `Esc` fires `onCancel()`.
- Registers an entry only while `enabled`; returns `focusedIndex === -1` when
  disabled so non-active toasts show no highlight.

## Focus highlight (no focus rings)

Per project preference, no `ring`. The focused option renders in the toast's
existing/hover appearance — brighter fill plus a subtle themed glow. Highlight
is driven from `focusedIndex`; `onMouseEnter` calls `setFocusedIndex` so mouse
and keyboard share a single highlight.

## Per-toast wiring

| Toast | Options (←/→ order) | `Enter` (default) | `Esc` |
|-------|--------------------|-------------------|-------|
| CardChoicePrompt | its N choices; only topmost active (`priority` above banners) | first `good`/green choice, else index 0 | dismiss prompt without applying (existing behavior) |
| PauseConsentToast | Accept · Decline | Accept | Decline |
| SpectatorHandRequestBanner | Dismiss · Share hand; topmost banner active | Share hand | Dismiss |
| GameOverOverlay — rematch | Accept · Decline | Accept | Decline |
| GameOverOverlay — opponent-left modal | Back to Lobby · Dismiss | Dismiss | Dismiss (close) |

Info-only `GameToast` (no buttons) is untouched.

## Out of scope

- Tab/focus-trap semantics, screen-reader announcements.
- Reworking how toasts are triggered or their visual layout.
