# Multiplayer Discord Feedback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship three multiplayer-mode polish features from Discord feedback: persistent look popup toggle, always-visible Priority button, and Three Nails (GoC) reset with opponent approval.

**Architecture:** Two pure-UI changes (Tasks 1, 2) plus one full-stack feature (Tasks 3–6) that adds a new `three_nails_reset` ability to the registry, a server-side reducer, and a client-side context-menu + approval-toast branch. All three reuse existing patterns — DeckPeekModal close behavior, GameToolbar layout, and the `request_opponent_action` / `approve_zone_search` / `<action>_execute` flow already used by Mayhem.

**Tech Stack:** React 19, TypeScript, Next.js 15 App Router, SpacetimeDB (server reducers + generated TS bindings), Vitest for parity tests.

**Spec:** [`docs/superpowers/specs/2026-05-11-multiplayer-discord-feedback-design.md`](../specs/2026-05-11-multiplayer-discord-feedback-design.md)

---

## Task 1: DeckPeekModal — "Keep open" toggle

**Files:**
- Modify: `app/shared/components/DeckPeekModal.tsx`

- [ ] **Step 1: Add `keepOpen` state and the title-bar toggle UI**

In `app/shared/components/DeckPeekModal.tsx`, after the existing `selectedIds` state declaration (~line 172), add:

```tsx
const [keepOpen, setKeepOpen] = useState(false);
```

Inside the `<DraggableTitleBar>` children (currently around lines 464–491, right after the existing `selectedIds.size > 0 &&` block), add a sibling node — the toggle. The full updated `DraggableTitleBar` block:

```tsx
<DraggableTitleBar
  dragHandleProps={dragHandleProps}
  title={title}
  onClose={onClose ? () => handleCloseAction('top') : undefined}
>
  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
    {selectedIds.size > 0 && (
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{
          color: 'var(--gf-accent)',
          fontSize: 12,
          fontFamily: 'var(--font-cinzel), Georgia, serif',
        }}>
          {selectedIds.size} selected
        </span>
        <button
          onClick={(e) => { e.stopPropagation(); setSelectedIds(new Set()); }}
          style={{
            background: 'transparent',
            border: '1px solid var(--gf-border)',
            borderRadius: 4,
            color: 'var(--gf-text-dim)',
            fontSize: 10,
            padding: '2px 6px',
            cursor: 'pointer',
            fontFamily: 'var(--font-cinzel), Georgia, serif',
          }}
        >
          Deselect
        </button>
      </div>
    )}
    {onClose && (
      <label
        onClick={(e) => e.stopPropagation()}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          fontFamily: 'var(--font-cinzel), Georgia, serif',
          color: 'var(--gf-text-dim)',
          fontSize: 11,
          cursor: 'pointer',
          userSelect: 'none',
        }}
      >
        <input
          type="checkbox"
          checked={keepOpen}
          onChange={(e) => setKeepOpen(e.target.checked)}
          style={{ cursor: 'pointer', accentColor: 'var(--gf-accent)' }}
        />
        Keep open
      </label>
    )}
  </div>
</DraggableTitleBar>
```

The `onClose &&` guard hides the toggle in read-only opponent-viewing mode (where `onClose` is undefined).

- [ ] **Step 2: Gate the auto-close-on-empty effect on `!keepOpen`**

Find the existing effect (~lines 234–238):

```tsx
useEffect(() => {
  if (!hasRemaining && peekedIds.length > 0 && onClose) {
    onClose();
  }
}, [hasRemaining]);
```

Replace with:

```tsx
useEffect(() => {
  if (!hasRemaining && peekedIds.length > 0 && onClose && !keepOpen) {
    onClose();
  }
}, [hasRemaining, keepOpen]);
```

- [ ] **Step 3: Smoke-test in goldfish**

Run the dev server (the user can test):

```bash
npm run dev
```

Manual check (user-visible test plan, document in the commit body if asked):
1. Open goldfish mode → play any deck.
2. Right-click deck → Look at top 7.
3. Toggle "Keep open" ON in the modal title bar.
4. Drag one card to hand. Modal stays open with remaining 6 cards.
5. Drag remaining 6 cards out one by one. Modal stays open showing the "All revealed cards have been moved" empty state.
6. Press Esc. Modal closes.
7. Repeat without toggling. Modal auto-closes after the last card is moved (current behavior preserved).

- [ ] **Step 4: Commit**

```bash
git add app/shared/components/DeckPeekModal.tsx
git commit -m "$(cat <<'EOF'
add Keep open toggle to DeckPeekModal

Suppresses the auto-close-on-empty behavior so players can take
multiple cards from a single look (e.g. cards that say "take up
to 2") without the modal dismissing after the first action.
Per-modal-instance state, default off, hidden in read-only mode.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: GameToolbar — Always-visible Priority button

**Files:**
- Modify: `app/shared/components/GameToolbar.tsx` (lines 146–160)

- [ ] **Step 1: Replace the mutually-exclusive End Turn / Priority swap with both rendered side-by-side**

In `app/shared/components/GameToolbar.tsx`, find the current block (~lines 146–160):

```tsx
// End Turn (active player) or Request Priority (non-active player) — multiplayer only
...(isMultiplayer && isMyTurn ? [{
  id: 'end-turn',
  label: 'End Turn',
  onClick: onEndTurn ?? (() => {}),
  /* ...existing styling... */
}] : isMultiplayer && !isMyTurn && !isFinished ? [{
  id: 'request-priority',
  label: hasPendingPriority ? 'Pending...' : 'Priority',
  onClick: onRequestPriority ?? (() => {}),
  /* ...existing styling... */
  disabled: !!hasPendingPriority,
}] : []),
```

Replace with both buttons emitted whenever `isMultiplayer && !isFinished`:

```tsx
// End Turn + Priority — both visible in multiplayer, gated by their own conditions
...(isMultiplayer && !isFinished ? [
  {
    id: 'end-turn',
    label: 'End Turn',
    onClick: onEndTurn ?? (() => {}),
    /* ...existing styling: copy verbatim from the previous isMyTurn branch... */
    disabled: !isMyTurn,
  },
  {
    id: 'request-priority',
    label: hasPendingPriority ? 'Pending...' : 'Priority',
    onClick: onRequestPriority ?? (() => {}),
    /* ...existing styling: copy verbatim from the previous !isMyTurn branch... */
    disabled: !!hasPendingPriority,
  },
] : []),
```

**IMPORTANT:** The `/* ...existing styling... */` placeholders represent the icon, color, tooltip, and other props that were already on the original two button objects. Copy each property over verbatim from the original code — do NOT invent new styling. Read lines 146–160 first, then preserve every field.

- [ ] **Step 2: Smoke-test in multiplayer**

The user verifies in the running dev server (no automated test exists for this layout):
1. Start a multiplayer game with two browser tabs / sessions.
2. As the active player: confirm both End Turn (enabled) and Priority (enabled) are visible in the toolbar.
3. Click Priority as the active player → opponent sees the existing approval toast.
4. Approve → chat logs "granted action priority" to the active player.
5. As the non-active player: confirm both End Turn (disabled, greyed) and Priority (enabled) are visible.

- [ ] **Step 3: Commit**

```bash
git add app/shared/components/GameToolbar.tsx
git commit -m "$(cat <<'EOF'
show End Turn and Priority side-by-side in multiplayer toolbar

The Priority button was previously hidden for the active player,
preventing the offense from requesting initiative in battle. Both
buttons are now always rendered, with End Turn disabled when it's
not your turn and Priority disabled when a request is already
pending.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Card registry — add `three_nails_reset` ability

**Files:**
- Modify: `lib/cards/cardAbilities.ts`
- Modify: `spacetimedb/src/cardAbilities.ts`

- [ ] **Step 1: Add the new variant to the `CardAbility` union (both files)**

In `lib/cards/cardAbilities.ts` (~lines 21–35), add `three_nails_reset` to the union and register it on the card.

Update the union (insert before the `| { type: 'custom'; ... }` line):

```ts
| { type: 'three_nails_reset' }
| { type: 'custom'; reducerName: string; label: string }
```

Update the registry (alphabetical-by-card-name is not enforced; place near the bottom before any "Promo / variant" sections, or wherever other (GoC) cards live):

```ts
'Three Nails (GoC)': [{ type: 'three_nails_reset' }],
```

In `abilityLabel()` (~lines 201–242), add a case before `case 'custom':`:

```ts
case 'three_nails_reset':
  return 'Reset (banishes Nails, both players draw 8)';
```

**Then make the IDENTICAL edits to `spacetimedb/src/cardAbilities.ts`.** The two files must stay byte-equivalent for the parity test to pass. Don't paraphrase — copy exactly.

- [ ] **Step 2: Run the parity test**

```bash
npx vitest run lib/cards/__tests__/cardAbilities.test.ts
```

Expected: all tests pass, including `'every key resolves to a real card via findCard()'` and `'SpacetimeDB duplicate of CARD_ABILITIES stays in sync'`.

If `findCard('Three Nails (GoC)')` fails, check for typos against the card name in `lib/cards/generated/cardData.ts:79387` (`"name": "Three Nails (GoC)"`).

- [ ] **Step 3: Commit**

```bash
git add lib/cards/cardAbilities.ts spacetimedb/src/cardAbilities.ts
git commit -m "$(cat <<'EOF'
register three_nails_reset ability for Three Nails (GoC)

Adds a new CardAbility variant and registers it on Three Nails
(GoC). Both lib/ and spacetimedb/ copies updated together to
satisfy the parity test. Reducer wiring follows in the next
commit.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Server reducer — `three_nails_reset_execute` + dispatch guard

**Files:**
- Modify: `spacetimedb/src/index.ts`

- [ ] **Step 1: Add the dispatch guard for `three_nails_reset`**

The `request_opponent_action` flow (existing reducer at ~line 5267) already creates pending `ZoneSearchRequest` rows from the client side, so the dispatch reducer should NOT also create one. Match the convention used by `discard_opponent_deck` and `look_at_opponent_deck` — throw to enforce client-side routing.

In `spacetimedb/src/index.ts`, find the `dispatch_card_ability` switch statement (~line 3185). Add a new case before the existing `case 'custom':` line:

```ts
case 'three_nails_reset':
  throw new SenderError('three_nails_reset is dispatched by the client, not this reducer');
```

This mirrors the existing entries for `discard_opponent_deck`, `reserve_opponent_deck`, etc. The client routes Three Nails reset through `requestOpponentAction` (Task 5).

- [ ] **Step 2: Add the `three_nails_reset_execute` reducer**

Insert this reducer immediately after `opponent_shuffle_and_draw` (~line 4050 in the current file). It mirrors that reducer's validation pattern, then sweeps zones and uses `shuffleAndDrawForPlayerImpl` per player after temporarily routing all swept cards into each player's deck.

```ts
// ---------------------------------------------------------------------------
// Reducer: three_nails_reset_execute
// Authorised via an approved ZoneSearchRequest (action='three_nails_reset').
// Banishes the source Three Nails (GoC), then for each player sweeps their
// hand + territory + land-of-bondage into their deck (lost souls owned by
// the shared paragon soul-deck route back there), reshuffles, and draws 8.
// Dispatched by the requester after the opponent approves.
// ---------------------------------------------------------------------------
export const three_nails_reset_execute = spacetimedb.reducer(
  {
    gameId: t.u64(),
    requestId: t.u64(),
  },
  (ctx, { gameId, requestId }) => {
    const game = ctx.db.Game.id.find(gameId);
    if (!game) throw new SenderError('Game not found');
    if (game.status !== 'playing') throw new SenderError('Game is not in progress');

    const player = findPlayerBySender(ctx, gameId);

    const req = ctx.db.ZoneSearchRequest.id.find(requestId);
    if (!req) throw new SenderError('Search request not found');
    if (req.gameId !== gameId) throw new SenderError('Request not in this game');
    if (req.requesterId !== player.id) throw new SenderError('Not your search request');
    if (req.status !== 'approved') throw new SenderError('Search request not approved');
    if (req.action !== 'three_nails_reset') throw new SenderError('Wrong action type');

    // Parse sourceInstanceId from actionParams
    let sourceInstanceId: bigint;
    try {
      const params = JSON.parse(req.actionParams);
      sourceInstanceId = BigInt(params.sourceInstanceId);
    } catch {
      throw new SenderError('Invalid actionParams');
    }

    // Locate Three Nails (GoC) — verify still in territory and owned by requester
    const source = ctx.db.CardInstance.id.find(sourceInstanceId);
    if (
      !source ||
      source.gameId !== gameId ||
      source.ownerId !== player.id ||
      source.cardName !== 'Three Nails (GoC)' ||
      source.zone !== 'territory'
    ) {
      // No-op path: Nails was moved/negated mid-flight. Log and clean up.
      logAction(
        ctx, gameId, player.id, 'THREE_NAILS_RESET_CANCELLED',
        JSON.stringify({ reason: 'source_card_not_in_territory' }),
        game.turnNumber, game.currentPhase,
      );
      ctx.db.ZoneSearchRequest.id.delete(requestId);
      return;
    }

    // Banish Three Nails (GoC) — preserve owner, clear in-play state
    ctx.db.CardInstance.id.update({
      ...source,
      zone: 'banish',
      zoneIndex: 0n,
      posX: '',
      posY: '',
      isFlipped: false,
    });

    // Sweep hand + territory + land-of-bondage for both players. Route each
    // card back to its OWNER's deck (so player A's card sitting in player B's
    // territory or LoB returns to A's deck). Lost souls whose owner is the
    // game-shared paragon soul deck (ownerId === 0n sentinel for shared souls
    // — verify this matches the existing convention in moveLostSoulToLor) go
    // back to soul-deck.
    const allPlayers = [...ctx.db.Player.player_game_id.filter(gameId)];
    const SWEEP_ZONES = new Set(['hand', 'territory', 'land-of-bondage']);

    for (const card of [...ctx.db.CardInstance.card_instance_game_id.filter(gameId)]) {
      // Skip the Three Nails source (already banished)
      if (card.id === sourceInstanceId) continue;
      if (!SWEEP_ZONES.has(card.zone)) continue;

      // Lost souls in LoB whose original owner is the shared soul-deck:
      // route back to soul-deck. Look at how moveLostSoulToLor handles
      // shared-soul ownership to identify these — typically a special
      // ownerId value or a flag on the card. If the existing helper has a
      // public predicate, reuse it; otherwise mirror its check inline.
      // Until verified, the conservative path: keep the existing ownerId
      // and route the card to its owner's deck. If the owner is one of the
      // current players, they get it back.
      const ownerIsActivePlayer = allPlayers.some((p: any) => p.id === card.ownerId);
      if (!ownerIsActivePlayer) {
        // Shared paragon soul-deck card or orphaned ownership. Route to soul-deck.
        ctx.db.CardInstance.id.update({
          ...card,
          zone: 'soul-deck',
          zoneIndex: 0n,
          posX: '',
          posY: '',
          isFlipped: true,
        });
        continue;
      }

      // Route to owner's deck (zoneIndex assigned during reshuffle below)
      ctx.db.CardInstance.id.update({
        ...card,
        zone: 'deck',
        zoneIndex: 0n,
        posX: '',
        posY: '',
        isFlipped: true,
      });
    }

    // Reshuffle each player's deck and draw 8.
    // shuffleAndDrawForPlayerImpl with shuffleCount=0 reshuffles the entire
    // deck (its hand-shuffle phase is a no-op when shuffleCount=0) and then
    // draws drawCount. Verify by inspecting shuffleAndDrawForPlayerImpl —
    // if shuffleCount=0 short-circuits before the reshuffle, change to a
    // direct call to the same reshuffle + draw logic inline.
    for (const target of allPlayers) {
      shuffleAndDrawForPlayerImpl(ctx, gameId, target, 0, 8);
    }

    // Mark request completed (delete to clean up — matches existing pattern
    // for finished requests; check how opponent_shuffle_and_draw handles
    // this and mirror).
    ctx.db.ZoneSearchRequest.id.delete(requestId);

    const finalGame = ctx.db.Game.id.find(gameId);
    if (finalGame) {
      logAction(
        ctx, gameId, player.id, 'THREE_NAILS_RESET',
        JSON.stringify({ requesterId: player.id.toString() }),
        finalGame.turnNumber, finalGame.currentPhase,
      );
    }
  }
);
```

**Verify before committing:**
1. Open `spacetimedb/src/index.ts` ~line 2860 (`shuffleAndDrawForPlayerImpl`). Confirm that calling it with `shuffleCount=0` does NOT short-circuit before the reshuffle pass. The function's hand-shuffle phase uses `actualShuffle = Math.min(0, handCards.length) = 0` — the for-loop at line 2892 won't execute, and `pickedCards` is empty. The reshuffle pass at line 2917 unconditionally runs. So `shuffleAndDrawForPlayerImpl(ctx, gameId, target, 0, 8)` will reshuffle target's deck and draw 8. ✓
2. Confirm that `opponent_shuffle_and_draw` (~line 4024) does NOT delete the ZoneSearchRequest itself — there's a separate `complete_zone_search` reducer (~line 5363) that does cleanup. Decide based on what you find:
   - If `opponent_shuffle_and_draw` leaves cleanup to `complete_zone_search`, then `three_nails_reset_execute` should follow the same pattern: don't `delete(requestId)` in the reducer; instead, the requester's client calls `complete_zone_search` after the reducer succeeds. Update the reducer to remove the explicit `delete` and document the client-side completion in Task 5.
   - If `opponent_shuffle_and_draw` does NOT leave cleanup behind, keep the `delete(requestId)` call.
3. Confirm the `logAction` action name format — match the casing of existing entries (e.g. `SHUFFLE_AND_DRAW`, `REQUEST_OPPONENT_ACTION`). The `THREE_NAILS_RESET` and `THREE_NAILS_RESET_CANCELLED` strings used above match this format.

If verification reveals a mismatch with steps 1–2, adjust the code BEFORE proceeding to Step 3.

- [ ] **Step 3: Run the spacetimedb-deploy skill**

This task includes a server-side schema change (new reducer) — the module must be republished and bindings regenerated before the client can call `three_nails_reset_execute`. Use the `spacetimedb-deploy` skill (do not skip — the client will get "reducer not found" errors otherwise).

```
/spacetimedb-deploy
```

Or invoke the skill via the Skill tool. Verify the output shows successful publish + `spacetime generate` regeneration of `spacetimedb/module_bindings/`.

- [ ] **Step 4: Commit**

```bash
git add spacetimedb/src/index.ts spacetimedb/module_bindings/
git commit -m "$(cat <<'EOF'
add three_nails_reset_execute reducer

Server side of the Three Nails (GoC) reset: dispatch_card_ability
inserts a pending ZoneSearchRequest with action='three_nails_reset',
the opponent approves it via the existing approve_zone_search flow,
then the requester fires three_nails_reset_execute which banishes
the source card, sweeps both players' hand + territory + LoB into
their decks, reshuffles, and draws 8 each. Lost souls owned by the
shared paragon soul-deck route back to soul-deck.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Client wiring — context menu + approval toast

**Files:**
- Modify: `app/play/components/MultiplayerCanvas.tsx`

- [ ] **Step 1: Add the context-menu / executeCardAbility branch for `three_nails_reset`**

In `app/play/components/MultiplayerCanvas.tsx`, the entry point is `executeCardAbility(sourceInstanceId, abilityIndex)` defined ~line 1159. It already dispatches `discard_opponent_deck` and `look_at_opponent_deck` to `requestOpponentAction(...)`. Add a parallel branch for `three_nails_reset`.

Insert after the existing `discard_opponent_deck` branch (~line 1216):

```tsx
if (ability?.type === 'three_nails_reset') {
  // Requires opponent consent. On approve, the approvedSearchRequest
  // effect dispatches three_nails_reset_execute.
  requestOpponentAction(
    'three_nails_reset',
    JSON.stringify({ sourceInstanceId: sourceInstanceId.toString() }),
  );
  return;
}
```

The right-click menu itself is already wired generically — it uses `getAbilitiesForCard(card.cardName)` and renders one menu item per ability via `abilityLabel(ability)`. Since Task 3 added the `'three_nails_reset'` case to `abilityLabel()` returning "Reset (banishes Nails, both players draw 8)", the menu item appears automatically. No separate menu-builder edit is needed — verify by reading the menu-builder code (search for `getAbilitiesForCard` and `executeCardAbility` calls in the same file).

- [ ] **Step 2: Add the approval-toast branch**

Find the `incomingSearchRequest` rendering (~lines 6241–6275, where `action-priority` is special-cased). Add a new branch BEFORE the existing `if (incomingSearchRequest && incomingSearchRequest.zone !== 'action-priority')` generic branch. The new branch:

```tsx
{incomingSearchRequest && incomingSearchRequest.action === 'three_nails_reset' && (
  <div /* same outer wrapper used by the action-priority branch — copy verbatim */>
    <div /* same content layout */>
      <span>
        {/* Format: "{requester display name} is activating Three Nails (GoC) — shuffles all hands, territories, and lands of bondage; both players draw 8." */}
        {gameState.opponentPlayer?.displayName ?? 'Opponent'} is activating Three Nails (GoC) — shuffles all hands, territories, and lands of bondage; both players draw 8.
      </span>
      <button onClick={() => gameState.approveZoneSearch(BigInt(incomingSearchRequest.id))}>
        Approve
      </button>
      <button onClick={() => gameState.denyZoneSearch(BigInt(incomingSearchRequest.id))}>
        Deny
      </button>
    </div>
  </div>
)}
```

Open the existing `action-priority` branch first and COPY its outer styling/wrapper structure exactly. The above is a placeholder showing the logic — the visual chrome (background colors, border, padding, fonts, button classes) must match neighboring toasts so this fits in.

- [ ] **Step 3: Add the requester-side dispatch when the request is approved**

Find the existing `approvedSearchRequest` watcher effect (~lines 2099–2108 in `MultiplayerCanvas.tsx`). It dispatches based on `action`. Add a new case alongside the existing ones (e.g. after the `shuffle_and_draw` case):

```tsx
if (action === 'three_nails_reset') {
  gameState.threeNailsResetExecute(reqIdBig);
  return;
}
```

The `gameState.threeNailsResetExecute` method needs to exist on the gameState hook. In `app/play/hooks/useGameState.ts`:

1. Find the existing wrapper for `opponent_shuffle_and_draw` (likely named `opponentShuffleAndDraw`). Look near the other reducer wrappers around line 744–760 (where `approveZoneSearch` etc. live).
2. Add the type signature in the `GameState` interface (near line 141–143):
   ```ts
   threeNailsResetExecute: (requestId: bigint) => void;
   ```
3. Add the implementation (mirror `approveZoneSearch` style):
   ```ts
   const threeNailsResetExecute = useCallback(
     (requestId: bigint) => {
       if (!gameId) return;
       conn?.reducers.threeNailsResetExecute({ gameId, requestId });
     },
     [conn, gameId],
   );
   ```
4. Add `threeNailsResetExecute` to the returned object (near line 886–888).

Per Task 4, the `three_nails_reset_execute` reducer deletes the request inline. So no separate `completeZoneSearch` call is needed in the watcher — verify this matches Task 4's final implementation. If Task 4 ended up leaving cleanup to `complete_zone_search` instead, add `gameState.completeZoneSearch(reqIdBig)` after the execute call.

- [ ] **Step 4: Smoke-test the full flow**

User testing in two browser tabs:
1. Start a multiplayer game with both players seated and decks loaded.
2. Player A: drop a Three Nails (GoC) into territory (use deck-search modal or hand-drag).
3. Player A: right-click Three Nails (GoC) → context menu shows "Activate Reset (banishes Nails)".
4. Player A: click it.
5. Player B: approval toast appears with the spec text. Click Approve.
6. Both players see: Three Nails moves to banish, hands clear, territories clear, LoBs clear, decks reshuffle, both players draw 8.
7. Chat log shows "Three Nails (GoC) reset executed — both players drew 8" (or whatever `THREE_NAILS_RESET` formats to in the chat panel).
8. Edge case: repeat steps 1–4, then before Player B approves, Player A moves Three Nails out of territory (or it gets discarded). Player B approves. Expected: chat shows the cancellation message; no state change.
9. Edge case: Player B clicks Deny. Expected: chat shows denial; no state change.

- [ ] **Step 5: Commit**

```bash
git add app/play/components/MultiplayerCanvas.tsx app/play/hooks/useGameState.ts
git commit -m "$(cat <<'EOF'
wire Three Nails (GoC) reset context menu and approval toast

Right-click on Three Nails (GoC) in territory now offers Activate
Reset, which sends an opponent-approval request reusing the
existing zone-search flow. Approving fires the new
three_nails_reset_execute reducer.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Optional chat polish

**Files:**
- Modify: `app/play/components/ChatPanel.tsx`

- [ ] **Step 1: Add a friendly chat label for the new action**

Find the chat-event formatter that handles `action-priority` strings (~line 677 of `ChatPanel.tsx`). Add formatting for the `three_nails_reset` action so the log reads naturally:

```tsx
if (data.action === 'three_nails_reset') return 'is activating Three Nails (GoC) reset';
// ...inside the granted-formatter:
if (data.action === 'three_nails_reset') return 'approved Three Nails (GoC) reset';
// ...inside the denied-formatter:
if (data.action === 'three_nails_reset') return 'denied Three Nails (GoC) reset';
```

Also add a formatter for the `THREE_NAILS_RESET` action log (the one emitted by the executor reducer at the end). Locate the chat-event switch and add:

```tsx
case 'THREE_NAILS_RESET':
  return 'Three Nails (GoC) reset executed — both players drew 8';
case 'THREE_NAILS_RESET_CANCELLED':
  return 'Three Nails (GoC) reset cancelled — source no longer in play';
```

The exact insertion point depends on the existing switch structure — read the file first and follow the surrounding format conventions exactly.

- [ ] **Step 2: Commit**

```bash
git add app/play/components/ChatPanel.tsx
git commit -m "$(cat <<'EOF'
add chat formatting for Three Nails (GoC) reset events

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Self-review checklist (for the implementing engineer)

Before declaring done, verify:

- [ ] Feature 1 (Task 1) — toggle visible, default OFF, modal stays open with toggle ON, peer modals unchanged.
- [ ] Feature 3 (Task 2) — both buttons visible side-by-side, End Turn disabled when not your turn, Priority disabled when pending.
- [ ] Feature 2 (Tasks 3–6) — registry parity test passes, reducer published, full flow tested in two-tab multiplayer including the no-op cancellation path.
- [ ] No type errors (`npm run build` or `tsc --noEmit`).
- [ ] Per CLAUDE.md guidance, do NOT add docstrings, planning comments, or refactor unrelated code.
- [ ] Per `~/.claude/.../memory/feedback_skip_build.md`, do NOT run `next build` after small UI edits — type-check is enough.
