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

## Focus highlight

The focused option is clearly highlighted via `toastFocusShadow(ring, glow)` —
a 2px ring in the button's OWN accent color (gold / green / red) plus a soft
glow, on top of a brighter fill. This is a deliberate selection indicator, not
the jarring global focus ring on neutral form controls. Highlight is driven
from `focusedIndex`; `onMouseEnter` calls `setFocusedIndex` so mouse and
keyboard share a single highlight.

## Existing-keybinding interaction

`useGameHotkeys` maps `Enter` → advance phase, and when it isn't your turn it
fires a `showGameToast("Wait for your turn")`. Because the toast listener runs
in the **capture** phase and `stopPropagation`s when it handles a key, an open
toast pre-empts that bubble-phase handler — so confirming a request with `Enter`
no longer also pops "Wait for your turn".

Typing in the chat `<input>` is exempt (input guard), so `Enter` there sends a
message and never auto-affirms a toast.

## Per-toast wiring

| Toast | Options (←/→ order) | `Enter` (default) | `Esc` |
|-------|--------------------|-------------------|-------|
| CardChoicePrompt | its N choices; only topmost active (`priority` above banners) | first `good`/green choice, else index 0 | dismiss prompt without applying (existing behavior) |
| PauseConsentToast | Accept · Decline | Accept | Decline |
| SpectatorHandRequestBanner | Dismiss · Share hand; topmost banner active | Share hand | Dismiss |
| GameOverOverlay — rematch | Accept · Decline | Accept | Decline |
| GameOverOverlay — opponent-left modal | Back to Lobby · Dismiss | Dismiss | Dismiss (close) |
| ConsentDialog (search / reveal / action / priority) | Allow/Grant · Deny | Allow/Grant | Deny |
| BoardRequestBanner — Three Nails reset | Approve · Deny | Approve | Deny |
| BoardRequestBanner — action priority | Grant · Deny | Grant | Deny |
| BoardRequestBanner — initiative | Grant · Deny | Grant | Deny |

Info-only `GameToast` (no buttons) is untouched. The three structurally
identical center-of-board request banners (Three Nails / priority / initiative)
were consolidated into one shared `BoardRequestBanner` component.

## Out of scope

- Tab/focus-trap semantics, screen-reader announcements.
- Reworking how toasts are triggered or their visual layout.
