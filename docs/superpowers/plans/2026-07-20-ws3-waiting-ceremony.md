# WS-3 Waiting Room → Pregame Ceremony Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the approved WS-3 spec (`docs/superpowers/specs/2026-07-20-ws3-waiting-ceremony-design.md`, this branch): delete the dead ready-up/`deck_select` path (client **and** server), kill the fake "Ready" caption, opponent-joined toast, click-to-skip ceremony, discoverable "Change deck", clearer joiner copy.

**Architecture:** Client work in `app/play/components/PregameScreen.tsx` + `app/play/[code]/client.tsx` + `app/play/hooks/useGameState.ts`. Server work is one surgical deletion in `spacetimedb/src/index.ts` (+ schema comment) with regenerated bindings — **publish is gated on explicit user go-ahead** (spec: "pause before the dev-module publish"). Removed-reducer skew is inert pre-publish because no client code calls `pregame_ready` after Task 2.

**Tech Stack:** Next.js 15 / React 19, framer-motion, Tailwind, SpacetimeDB TS module, Playwright via the `verify` skill.

## Global Constraints

- Worktree: `/Users/timestes/projects/rtt-ws3-waiting-ceremony`, branch `feat/ws3-waiting-ceremony`. Absolute paths; never touch the main checkout; stage named files only (never `git add -A`).
- **Never delete/rename live code:** `pregameReady0`/`pregameReady1` + `pregamePhase` Game fields; `pregame_acknowledge_roll` / `pregame_acknowledge_first` / `pregame_skip_to_reveal` and their client wrappers; ceremony reads of `pregameReady0/1` (`PregameScreen.tsx:722-723,879,1011`, `client.tsx:1171`); `myDeckImageUrls`/`allImageUrls`/`areUrlsLoaded`/`imagesGateOpen`; any image/connection `isReady` elsewhere.
- **Keep** the `diceSkipped` state in `PlayerCards` — Task 5 wires it (it is the click-to-skip mechanism, not dead code).
- Type gate: `npx tsc --noEmit` (never `next build`; `strict: false` — avoid `if (x.ok)`/else narrowing).
- Styling: current amber pregame vocabulary; no `focus:ring-*`; no green/primary at rest.
- Copy verbatim: "⚔️ {name} joined — rolling for first player…", "Skip ▸", "Connected — starting game…", "Change deck", "Deck selected".
- **Do NOT run `spacetime publish`** anywhere in this plan — that happens only after user go-ahead, via the `spacetimedb-deploy` skill.
- Line numbers are pre-change anchors; after Task 2, find later edit points by quoted anchor text.

---

### Task 1: Commit spec addendum + this plan

**Files:**
- Modify: `docs/superpowers/specs/2026-07-20-ws3-waiting-ceremony-design.md` (append addendum — already drafted)
- Add: `docs/superpowers/plans/2026-07-20-ws3-waiting-ceremony.md`

- [ ] **Step 1: Commit**

```bash
cd /Users/timestes/projects/rtt-ws3-waiting-ceremony
git add docs/superpowers/specs/2026-07-20-ws3-waiting-ceremony-design.md docs/superpowers/plans/2026-07-20-ws3-waiting-ceremony.md
git commit -m "docs(ws3): scoping addendum + implementation plan"
```

---

### Task 2: Delete dead ready-up/`deck_select` client code (spec §1, §2, §7-client + addendum)

One atomic commit — the `canReady` threading spans `client.tsx` → `PregameScreen.tsx`.

**Files:**
- Modify: `app/play/components/PregameScreen.tsx`
- Modify: `app/play/[code]/client.tsx` (~484-498, ~1369)
- Modify: `app/play/hooks/useGameState.ts` (140, 776-778, 1015, 1325)
- Modify: `e2e/spectator/playHelpers.ts` (49-63)

**Interfaces:**
- Produces: `PregameScreenProps` without `canReady`; `PlayerCards` without `myReady`/`opponentReady`/`canReady` (but WITH `diceSkipped` intact); `GameState` without `pregameReady`. Task 3 rewrites the `{isWaiting && …}` block this leaves; Task 5 adds `skipped` props.

- [ ] **Step 1: PregameScreen.tsx**
  - L102: `?? 'deck_select'` → `?? ''`.
  - Delete `canReady` from `PregameScreenProps` (comment+decl L67-71), destructure (L96), `PlayerCards` call (L175); delete `myReady={myReady}`/`opponentReady={opponentReady}` from that call (L165,167). Keep consts L119-120 (DebugOverlay uses them).
  - Delete the `phase === 'deck_select'` action-area arm (L190-199) so the chain reads `isWaiting ? (…) : phase === 'rolling' || phase === 'choosing' ? (…`.
  - In `PlayerCards`: remove `myReady`/`opponentReady`/`canReady` from interface+destructure; delete `handleToggleReady` (L371-373); delete `isDeckSelect` (L375) and every `{isDeckSelect && …}` block (L408-412, L427-456, L473-477, L492-498). **Keep** `const [diceSkipped, setDiceSkipped] = useState(false);` (L379).
  - `PregameCeremonyOverlay`'s `PlayerCards` call (L717-732): remove `myReady`/`opponentReady`/`canReady={true}`.
  - DebugOverlay (L228): `${phase !== 'deck_select' ? \`/${phase}\` : ''}` → `${phase ? \`/${phase}\` : ''}`.
  - `SpectatorPregameView`: delete the `deck_select` title line (L1281) and ready block (L1287-1298); title gets fallback:

```tsx
      <h2 className="text-2xl font-bold font-cinzel mt-2">
        {phase === 'rolling' && 'Rolling for First Player...'}
        {phase === 'choosing' && 'Choosing Who Goes First...'}
        {phase === 'revealing' && 'First Player Chosen'}
        {phase !== 'rolling' && phase !== 'choosing' && phase !== 'revealing' && 'Waiting for Players...'}
      </h2>
```

  - Remove `import { Button } from '@/components/ui/button';` (grep first to confirm the ready button was its only use in this file).

- [ ] **Step 2: client.tsx** — delete L484-498 (`myDeckImagesPreloaded`/`deckPreloadFallback`/`canReady` + comment) and `canReady={canReady}` (L1369). Keep `myDeckImageUrls` and the `imagesGateOpen` machinery.

- [ ] **Step 3: useGameState.ts** — delete `pregameReady` interface entry (L140), useCallback (L776-778), live-map entry (L1015), fallback `pregameReady: noopBool,` (L1325).

- [ ] **Step 4: e2e/spectator/playHelpers.ts** — delete the ready-up loop (L57-63); docblock (L49-55) becomes:

```ts
/**
 * Drive both players from the pregame ceremony into `playing`:
 *  - the roll winner clicks "I'll go first" (the loser auto-acks; the reveal
 *    auto-acks) — both pages attempt it, only the winner's button exists.
 * Resolves once both player pages have left the pregame UI (board mounted).
 */
```

- [ ] **Step 5: Verify**

```bash
cd /Users/timestes/projects/rtt-ws3-waiting-ceremony
grep -rn "deck_select" app/ e2e/ ; echo "app-exit=$?"
grep -rn "canReady" app/
npx tsc --noEmit
```
Expected: app-exit=1, no `canReady` matches, tsc clean.

- [ ] **Step 6: Commit**

```bash
git add app/play/components/PregameScreen.tsx "app/play/[code]/client.tsx" app/play/hooks/useGameState.ts e2e/spectator/playHelpers.ts
git commit -m "refactor(pregame): delete unreachable ready-up/deck_select UI and canReady gate"
```

---

### Task 3: Waiting card — deck name + visible "Change deck" (spec §2, §5 + addendum)

**Files:**
- Modify: `app/play/components/PregameScreen.tsx` (the `{isWaiting && (` block in `PlayerCards`; add `ArrowLeftRight` import)

- [ ] **Step 1:** Add `import { ArrowLeftRight } from 'lucide-react';` and replace the `{isWaiting && (` block (the one containing the `Ready` caption) with:

```tsx
          {isWaiting && (
            <div className="mt-1 flex flex-col items-start gap-1.5">
              <p className="text-[10px] text-amber-200/40 truncate max-w-full" title={myDeckName}>
                {myDeckName || 'Deck selected'}
              </p>
              <button
                onClick={() => setPickerOpen(true)}
                disabled={isChangingDeck}
                className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded border border-amber-200/20 text-[11px] text-amber-200/70 hover:bg-amber-200/5 hover:text-amber-200/90 transition-colors disabled:opacity-50"
              >
                <ArrowLeftRight className="h-3 w-3" />
                {isChangingDeck ? 'Loading…' : 'Change deck'}
              </button>
              {changeError && (
                <p className="text-[10px] text-red-400/80">{changeError}</p>
              )}
            </div>
          )}
```

- [ ] **Step 2: Verify + commit**

```bash
npx tsc --noEmit
git add app/play/components/PregameScreen.tsx
git commit -m "feat(pregame): deck name + visible Change deck button in waiting room"
```

---

### Task 4: Opponent-joined toast (spec §3)

**Files:**
- Modify: `app/play/components/PregameScreen.tsx` (new export `OpponentJoinedToast`)
- Modify: `app/play/[code]/client.tsx` (state + trigger effect + render in ceremony branch)

**Interfaces:**
- Produces: `OpponentJoinedToast({ name }: { name: string })` export from PregameScreen.tsx.

- [ ] **Step 1: Component** (after `OpponentDisconnectBanner` in PregameScreen.tsx; `motion` already imported):

```tsx
// ---------------------------------------------------------------------------
// OpponentJoinedToast — brief host-side beat when the ceremony starts, so the
// jump out of the waiting room / practice mode isn't a cold cut (WS-3 §3).
// ---------------------------------------------------------------------------

export function OpponentJoinedToast({ name }: { name: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="absolute top-16 left-1/2 -translate-x-1/2 z-50 rounded-lg border border-amber-200/20 bg-black/85 backdrop-blur-sm px-4 py-2.5 pointer-events-none"
    >
      <p className="font-cinzel text-sm text-amber-200/90 tracking-wide whitespace-nowrap">
        ⚔️ {name} joined — rolling for first player…
      </p>
    </motion.div>
  );
}
```

- [ ] **Step 2: client.tsx wiring**
  - Extend import: `import PregameScreen, { PregameCeremonyOverlay, OpponentJoinedToast } from '../components/PregameScreen';`
  - By `isPracticing` state: `const [justJoinedToast, setJustJoinedToast] = useState<string | null>(null);` and `const JOINED_TOAST_MS = 2500;`
  - After `gameStateRef.current = gameState;` (ref must exist first):

```tsx
  // WS-3 §3: the host was in the waiting room (possibly practicing) and the
  // opponent's join yanks them straight into the roll ceremony — announce it.
  // Reading the opponent name via gameStateRef (not a dep) is deliberate:
  // gameState is a fresh object every render (see the unstable-object gotcha),
  // and this must fire once per lifecycle change only. Joiners (prev
  // 'joining') initiated the join; rematches (prev 'finished') aren't a join.
  const prevLifecycleForToastRef = useRef<LifecycleState>('creating');
  useEffect(() => {
    const prev = prevLifecycleForToastRef.current;
    prevLifecycleForToastRef.current = lifecycle;
    if (lifecycle === 'pregame' && prev === 'waiting') {
      setIsPracticing(false);
      setJustJoinedToast(gameStateRef.current.opponentPlayer?.displayName || 'Opponent');
    }
  }, [lifecycle]);

  useEffect(() => {
    if (!justJoinedToast) return;
    const timer = setTimeout(() => setJustJoinedToast(null), JOINED_TOAST_MS);
    return () => clearTimeout(timer);
  }, [justJoinedToast]);
```

  - In the `if (isCeremonyPhase)` return, right after `<PregameCeremonyOverlay …/>`:

```tsx
            {justJoinedToast && <OpponentJoinedToast name={justJoinedToast} />}
```

  (It sits inside the `position: relative` board container — `absolute top-16` centers it above the overlay card, z-50 over the overlay's z-40.)

- [ ] **Step 3: Verify + commit**

```bash
npx tsc --noEmit
git add app/play/components/PregameScreen.tsx "app/play/[code]/client.tsx"
git commit -m "feat(pregame): opponent-joined toast when the ceremony starts"
```

---

### Task 5: Click-to-skip ceremony (spec §4)

**Files:**
- Modify: `app/play/components/PregameScreen.tsx` only.

**Interfaces:**
- Produces: `skipped?: boolean` prop on `PlayerCards`, `RollAndChooseArea`, `RevealArea`; `skipped` state + "Skip ▸" button in `PregameCeremonyOverlay`.

- [ ] **Step 1: `PregameCeremonyOverlay`** — add `const [skipped, setSkipped] = useState(false);`, pass `skipped={skipped}` to `PlayerCards`, `RollAndChooseArea`, and `RevealArea`, and render below the action-area `</div>`:

```tsx
        {!skipped && (phase === 'rolling' || phase === 'revealing') && (
          <button
            onClick={() => setSkipped(true)}
            className="mt-4 text-[11px] text-amber-200/40 hover:text-amber-200/70 font-cinzel tracking-widest uppercase transition-colors"
          >
            Skip ▸
          </button>
        )}
```

- [ ] **Step 2: `PlayerCards`** — add `skipped?: boolean` prop; wire the existing (kept) dice state:

```tsx
  useEffect(() => {
    if (skipped) {
      setDiceSkipped(true);
      setDiceRevealed(true);
    }
  }, [skipped]);
```

- [ ] **Step 3: `RollAndChooseArea`** — add `skipped?: boolean` prop; results appear immediately on skip:

```tsx
  useEffect(() => {
    if (skipped) { setShowResults(true); return; }
    const timer = setTimeout(() => setShowResults(true), RITUAL_TUMBLE_MS + 700);
    return () => clearTimeout(timer);
  }, [skipped]);
```

  and the loser's ack fires immediately (choose stays a real decision — skip never auto-picks):

```tsx
  useEffect(() => {
    if (iWonRoll || myRollAcked) return;
    if (phase !== 'rolling') return;
    if (skipped) { acknowledgeRoll(); return; }
    const timer = setTimeout(() => {
      acknowledgeRoll();
    }, RITUAL_TUMBLE_MS + ROLLING_RESULT_DISPLAY_MS);
    return () => clearTimeout(timer);
  }, [iWonRoll, myRollAcked, phase, acknowledgeRoll, skipped]);
```

- [ ] **Step 4: `RevealArea`** — add `skipped?: boolean` prop; ack immediately on skip:

```tsx
  useEffect(() => {
    if (alreadyAcked) return;
    if (skipped) { acknowledgeFirst(); return; }
    const timer = setTimeout(() => {
      acknowledgeFirst();
    }, REVEAL_AUTO_ACK_MS);
    return () => clearTimeout(timer);
  }, [alreadyAcked, acknowledgeFirst, skipped]);
```

  (Non-overlay render paths pass no `skipped` → optional prop, unchanged behavior.)

- [ ] **Step 5: Verify + commit**

```bash
npx tsc --noEmit
git add app/play/components/PregameScreen.tsx
git commit -m "feat(pregame): click-to-skip the roll/reveal ceremony"
```

---

### Task 6: Joiner "Connected — starting game…" copy (spec §6)

**Files:**
- Modify: `app/play/[code]/client.tsx` (loading-screen headline)

- [ ] **Step 1:** In the loading return, change the headline `<p …>{loadingMessage}</p>` to:

```tsx
          <p className="font-cinzel text-xl tracking-wide text-amber-200/90 mb-6">
            {lifecycle === 'joining' && isConnected ? 'Connected — starting game…' : loadingMessage}
          </p>
```

- [ ] **Step 2: Verify + commit**

```bash
npx tsc --noEmit
git add "app/play/[code]/client.tsx"
git commit -m "feat(pregame): honest joiner loading copy once connected"
```

---

### Task 7: Server — delete `pregame_ready`, regen bindings (spec §7; NO publish)

**Files:**
- Modify: `spacetimedb/src/index.ts` (delete reducer, ~954-1059)
- Modify: `spacetimedb/src/schema.ts` (line 30 comment)
- Regenerate: `lib/spacetimedb/module_bindings/` (via `spacetime generate` — never hand-edit)

- [ ] **Step 1:** Read `spacetimedb/src/index.ts` around 940-1070 to confirm the exact reducer boundaries (`export const pregame_ready = …` through its closing `);`), then delete the whole reducer.
- [ ] **Step 2:** `schema.ts:30` comment → `// "" | "rolling" | "choosing" | "revealing"`.
- [ ] **Step 3:** Regenerate bindings per the `spacetimedb-deploy` skill's generate step (typescript, out `lib/spacetimedb/module_bindings`, project path `spacetimedb`). Expect: `pregame_ready_reducer.ts` deleted; refs removed from `module_bindings/index.ts` and `types/reducers.ts`; `game_table.ts`/`types.ts` keep `pregamePhase`/`pregameReady0/1`.
- [ ] **Step 4: Verify**

```bash
cd /Users/timestes/projects/rtt-ws3-waiting-ceremony
grep -rn "pregame_ready\|pregameReady\b" spacetimedb/src/ lib/spacetimedb/module_bindings/ | grep -v "pregameReady0\|pregameReady1" ; echo "exit=$?"
npx tsc --noEmit
```
Expected: exit=1 (no matches); tsc clean.

- [ ] **Step 5: Commit** (bindings diff is committed; publish deferred)

```bash
git add spacetimedb/src/index.ts spacetimedb/src/schema.ts lib/spacetimedb/module_bindings
git commit -m "refactor(spacetimedb): delete dead pregame_ready reducer, regen bindings"
```

---

### Task 8: Verification + PR (publish still gated)

- [ ] **Step 1: Static gates**

```bash
cd /Users/timestes/projects/rtt-ws3-waiting-ceremony
npx tsc --noEmit && npm test
```
Expected: clean / suite green.

- [ ] **Step 2: Live 2-player pass** (spec Verification §; `verify` skill, host `baboonytim@gmail.com`, joiner `landofredemption@gmail.com`, dev server on a non-default port). Confirm: no "Ready" caption + visible "Change deck"; practice → join → toast → ceremony; Skip lands dice instantly and advances (choose still manual); joiner sees "Connected — starting game…"; full roll→play works. Screenshots for the PR.

- [ ] **Step 3: Push + PR**

```bash
git push -u origin feat/ws3-waiting-ceremony
gh pr create --base main --title "feat(pregame): WS-3 waiting-room → ceremony flow fixes" --body "$(cat <<'EOF'
Implements WS-3 (spec + plan in docs/superpowers/, this branch; from the PR #221 audit §3/§5):

- Deletes the unreachable ready-up/deck_select path: client UI, canReady preload gate, pregameReady wrapper, e2e dead loop, and the dead server reducer pregame_ready (bindings regenerated; pregameReady0/1 + pregamePhase fields untouched — they serve the live roll/reveal acks)
- Fake "Ready" caption → real deck name; "Change deck" is a visible button
- "⚔️ {name} joined — rolling for first player…" toast for the host when the ceremony starts (covers the practice-mode cold cut)
- Click-to-skip the roll/reveal ceremony (server-authoritative result; skip never auto-picks who goes first)
- Joiner loading screen says "Connected — starting game…" once through

**Deploy note:** the module change is a pure deletion of an unreachable reducer — the dev/prod module publish is deliberately NOT done yet (pause per spec); client is inert against the old module in the interim.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 4: STOP.** Report to the user; request go-ahead for the dev-module publish (`spacetimedb-deploy` skill). Prod publish pairs with the Vercel deploy at merge time, as with WS-4.

## Self-Review

- **Spec coverage:** §1→T2, §2→T2+T3, §3→T4, §4→T5, §5→T3, §6→T6, §7→T2 (wrapper) + T7 (server/bindings), Verification→T8, publish-pause→T7 constraint + T8 Step 4. Addendum items (e2e loop, spectator fallback, Button import, deck name) → T2/T3.
- **Placeholder scan:** none.
- **Type consistency:** `skipped?: boolean` uniform across T5; `OpponentJoinedToast({ name })` matches T4 usage; `diceSkipped` kept in T2 and consumed in T5.
