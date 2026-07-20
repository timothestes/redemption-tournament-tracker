# WS-1 — Forge Lobby & Deck-Choice Parity

**Status:** Design approved (Approach A: surgical parity). Ready for implementation plan.
**Source:** First of six workstreams decomposed from the multiplayer UX audit (PR #221, `docs/multiplayer-flows-ux-audit.md`).
**Branch:** `feat/ws1-forge-lobby-parity`.

## Goal

Bring the Forge playtest lobby up to the polish of the normal `/play` lobby, and remove a cluster of small deck-choice inconsistencies across both. Every change traces to an audit finding. This is **parity work** — port patterns that already exist in `GameLobby.tsx`; do not invent new UI vocabulary and do not merge the two lobby files (that unification is WS-6).

## Approach

**Surgical parity (Approach A).** Fix each item inline, matching each file's existing style. No shared-component extraction, no lobby merge, no restyle beyond what each item requires. Rejected alternatives: extracting shared lobby primitives (does WS-6's job early, collides later), and copy-only (doesn't deliver "make it a real button").

## Scope — the eight changes

### `app/forge/play/games/ForgeGameLobby.tsx`

1. **"Host a game" → real primary CTA.**
   Today it's a bordered `<div>`-button ([L94-97](app/forge/play/games/ForgeGameLobby.tsx#L94)) that doesn't read as a button. Replace with the shadcn `Button` primary CTA (green, `size="lg"`, full-width `h-12`), with "Get a code to share with another playtester." as a caption beneath — mirroring the normal lobby's Create Game ([GameLobby.tsx:455-469](app/play/components/GameLobby.tsx#L455)).

2. **Host loading feedback.**
   Add an `isCreating` state. On click, the button shows a `Loader2` spinner + "Loading deck…" and disables, matching normal ([GameLobby.tsx:461-468](app/play/components/GameLobby.tsx#L461)). `handleCreate` sets it before `router.push`. (No cleanup needed — navigation unmounts the lobby.)

3. **Empty state → builder link.**
   "No Forge decks yet — build one first." ([L82-83](app/forge/play/games/ForgeGameLobby.tsx#L82)) becomes an actionable link/button to **`/forge/play/decks/new`** (the Forge Deckbuilder route, confirmed in `ForgeNav.tsx`). Style after the normal lobby's "Build one" link ([GameLobby.tsx:344-349](app/play/components/GameLobby.tsx#L344)). Host/Join stay disabled while `!selected` (already the case).

4. **Tighten the too-wide open-games join rows.**
   The `<li>` rows ([L118-127](app/forge/play/games/ForgeGameLobby.tsx#L118)) span the full `max-w-3xl` with the Join button flung to the far edge, leaving a large dead gap — the "banner … way too wide." Constrain the open-games list to a compact width (e.g. cap the `<ul>` at ~`max-w-md`) so each clickable row is a tidy card, not a full-bleed banner. Content-left / Join-right stays, but the horizontal gap collapses. Visual-only; no behavior change.

### `app/play/components/GameLobby.tsx`

5. **Deck-change verb: "Swap" → "Change deck".**
   [L337](app/play/components/GameLobby.tsx#L337). Keep the `ArrowLeftRight` icon.

6. **Explain the pre-selected deck.**
   The lobby silently auto-selects the last-played deck (`decks[0]`, [L37](app/play/components/GameLobby.tsx#L37)). Add a muted **"Last played"** chip beside the format badge in the deck-info row ([L308-319](app/play/components/GameLobby.tsx#L308)). Guard: show only when the selected deck is the initial auto-pick **and** carries a real timestamp — `selectedDeck.id === decks[0]?.id && selectedDeck.last_played_at` (field exists on `DeckOption`, `DeckPickerCard.tsx:17`). It disappears once the user deliberately changes decks, so it never mislabels a manual choice.

7. **Make the spectate ON-state obvious.**
   Spectate already defaults OFF ([L87](app/play/components/GameLobby.tsx#L87)) and stays off — verified as the correct default. The real footgun is that turning it on silently relabels Join→Watch. When `isSpectate` is true ([L519-555](app/play/components/GameLobby.tsx#L519)): give the "Watch" button a distinct treatment (an `Eye` icon + clearer styling) and add a small caption under the join input — "Spectating — you'll watch, not play." Restrained per the design system (no flashy color). **Logic unchanged** — only the on-state's legibility.

### `app/play/[code]/client.tsx` — verb consolidation (copy-only)

8. **In-game practice-swap confirm copy.**
   "Swap your game deck to …" ([L1281](app/play/[code]/client.tsx#L1281)) → "Change your game deck to …"; "Swap Deck" button ([L1342](app/play/[code]/client.tsx#L1342)) → "Change deck". Internal identifiers (`ForgeSwapErrorDialog`, `forgeSwapError`, handler names) are **not** user-facing — leave them. Pregame already reads "Change deck." Deck-picker **dialog titles** stay "Choose a deck" (that's *choosing*, not *changing*); only trigger/action buttons unify.

## Out of scope (deferred, on purpose)

- Merging `GameLobby` and `ForgeGameLobby` into one component → **WS-6**.
- Restyling the Forge deck-selector bar itself / adding Forge card-art preview → lower-priority polish.
- Any change to spectate routing, the `Spectator` table, or self-spectate ("watch your own game") → **WS-2**.
- Gating debug artifacts → explicitly kept per user.

## Verb inventory (for completeness)

Surfaces that will read "Change deck" after this WS: normal lobby button (#5), in-game practice confirm (#8), pregame (already correct, `PregameScreen.tsx:401`). Empty-state placeholder `Choose a deck…` and dialog titles `Choose a deck` (`ForgeDeckPicker.tsx`) intentionally remain — they describe first-time selection, not changing.

## File-overlap / sequencing note

Item #8 edits `client.tsx`, which WS-2 and WS-3 also touch — but these are two isolated string lines. As long as WS-1 lands first, there is no real collision. Items #1-4 (`ForgeGameLobby.tsx`) and #5-7 (`GameLobby.tsx`) are disjoint from all other workstreams.

## Verification

Manual, driven with the `verify` skill (mint `sb-` cookies, standalone Playwright) — host = `baboonytim@gmail.com`, joiner = `landofredemption@gmail.com`, both have Forge + normal decks.

Success criteria:
- **Forge lobby:** "Host a game" renders as a green primary button; clicking it shows "Loading deck…" + spinner + disabled before navigation; with zero Forge decks the empty state links to `/forge/play/decks/new`; the open-games rows are compact, not full-bleed.
- **Normal lobby:** the deck-change control reads "Change deck"; the auto-selected last-played deck shows a "Last played" chip that vanishes after a manual change; toggling Spectate on makes it unmistakable that Join became Watch, with the explanatory caption.
- **In-game:** the practice-swap confirm reads "Change …/Change deck".
- `npm run build` (or `tsc --noEmit`) passes; no unused imports left by the CTA/`Eye`/`Loader2` additions.
