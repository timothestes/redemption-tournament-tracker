# Battle Zone (Field of Battle) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A battle zone band that opens between the two territories, with placement-derived side totals, a live initiative banner, soft brigade warnings, format-aware soul surrender, and automated end-of-battle card return.

**Architecture:** One new SpacetimeDB zone string `'battle'` rendered as a shared Konva band whose halves are derived from owner-local card centers (never stored). Server holds three Game columns + three CardInstance origin columns; all battle-field clearing is centralized in `leavePlayFieldOverrides`. Client math (totals/initiative/brigade) lives in a pure lib. Layout gains a `battleActive` variant per profile with the band midline pinned to the idle divider center.

**Tech Stack:** SpacetimeDB TypeScript module, Next.js 15 / React 19, react-konva, vitest.

**Spec:** `docs/superpowers/specs/2026-07-12-battle-zone-design.md` — read it before ANY task. Every task below cites spec sections; when in doubt the spec wins.

## Global Constraints

- Zone id is exactly `'battle'`. No `battleSide` column anywhere — side is derived (spec §3).
- New Game/CardInstance columns are `t.string().default('')` (rollWinner-style seats: `'' | '0' | '1'`).
- **READ `spacetimedb/CLAUDE.md` before touching any file under `spacetimedb/`.** After ANY change to `spacetimedb/src/*`, the module must be republished via the `spacetimedb-deploy` skill (Task 6 batches this once for Phase 1; later server edits re-run it).
- Battle UI is always gated on `game.status === 'playing'`.
- Type-check with `npx tsc --noEmit` — do NOT run `next build` while dev may be running (project memory: shared `.next`).
- `git add` only your specific files; never `-A`/`.`.
- Tests: vitest (`npx vitest run <path>`).
- tsconfig has `strict: false`: union narrowing via `if (x.ok)` does not narrow — use explicit `=== false` / `!== ''` comparisons.

## File Structure

| File | Role |
|---|---|
| `spacetimedb/src/schema.ts` | +3 Game columns, +3 CardInstance columns |
| `spacetimedb/src/index.ts` | shared consts, helper extensions, stamping, redirect, `enter_battle`/`resolve_battle`/`surrender_soul`/`end_battle`, auto-return helper, end_turn hook, rematch reset |
| `spacetimedb/src/cardAbilities.ts` + `lib/cards/cardAbilities.ts` | `'battle'` in DEFAULT_ABILITY_SOURCE_ZONES (both copies) |
| `app/play/layout/multiplayerLayout.ts` | `battleActive` param, battle ratio variants, `zones.battle`, idle-keyed sidebar |
| `app/play/layout/__tests__/multiplayerLayout.battle.test.ts` | layout invariant tests |
| `app/play/lib/battleMath.ts` (new) | side derivation, totals, initiative, brigade check |
| `app/play/lib/__tests__/battleMath.test.ts` (new) | math tests |
| `app/shared/types/gameCard.ts`, `app/goldfish/**` | ZoneId fallout |
| `app/play/components/MultiplayerCanvas.tsx` | band render, hit-test, chrome, drag safety |
| `app/play/components/BattleResolutionUI.tsx` (new) | band buttons, confirm summary, soul dialog, HTML overlays |
| `app/play/hooks/useGameState.ts` | battle fields + reducer wrappers |

---

### Task 1: Server schema columns + rematch reset

**Files:**
- Modify: `spacetimedb/src/schema.ts` (Game table ~line 52; CardInstance table ~line 140)
- Modify: `spacetimedb/src/index.ts` (`respond_rematch` reset list, lines ~1402-1427)

**Interfaces:**
- Produces: `game.battleState: string` (`'' | 'active' | 'awaiting-soul'`), `game.battleAttackerSeat: string`, `game.lastBattlePlayBySeat: string`; `card.originZone/originPosX/originPosY: string`.

- [ ] **Step 1: Read `spacetimedb/CLAUDE.md` in full.** Non-negotiable.

- [ ] **Step 2: Add Game columns** after `totalPausedMicros` in `schema.ts`:

```ts
    battleState: t.string().default(''),        // '' | 'active' | 'awaiting-soul'
    battleAttackerSeat: t.string().default(''), // '' | '0' | '1'
    lastBattlePlayBySeat: t.string().default(''), // '' | '0' | '1' — REG stalemate/mutual tiebreak
```

- [ ] **Step 3: Add CardInstance columns** after `revealStartedAt`:

```ts
    // Stamped when the card enters zone 'battle'; cleared by leavePlayFieldOverrides
    // whenever it leaves. Drives end-of-battle auto-return (survivors → origin).
    originZone: t.string().default(''),
    originPosX: t.string().default(''),
    originPosY: t.string().default(''),
```

- [ ] **Step 4: Patch `respond_rematch`** — add to the in-place Game reset object (spec §7 F1): `battleState: '', battleAttackerSeat: '', lastBattlePlayBySeat: ''`.

- [ ] **Step 5: Typecheck the module** (`cd spacetimedb && npx tsc --noEmit`). Expected: clean. Do NOT publish yet (Task 6 publishes Phase 1 as one unit).

- [ ] **Step 6: Commit** `feat(battle): schema columns for battle state and card origins`

### Task 2: In-play helpers + ability zones learn `'battle'`

**Files:**
- Modify: `spacetimedb/src/index.ts` — `clearCountersIfLeavingPlay` (~224), `leavePlayFieldOverrides` (~240), the 6 inline `ABILITY_SOURCE_ZONES` (2188, 3957, 4077, 4126, 4234, 5324)
- Modify: `spacetimedb/src/cardAbilities.ts` (~22) and `lib/cards/cardAbilities.ts` (~17-19) — `DEFAULT_ABILITY_SOURCE_ZONES`

**Interfaces:**
- Produces: `leavePlayFieldOverrides(fromZone, toZone)` now also returns `{originZone:'', originPosX:'', originPosY:''}` whenever `toZone !== 'battle'` (battle-field clearing lives ONLY here — spec §7).

- [ ] **Step 1:** In both helpers, extend the in-play predicate `['territory','land-of-bondage']` → `['territory','land-of-bondage','battle']`. In `leavePlayFieldOverrides`, unconditionally merge origin-clear fields when `toZone !== 'battle'`:

```ts
const battleClears = toZone !== 'battle'
  ? { originZone: '', originPosX: '', originPosY: '' }
  : {};
return { ...existingOverrides, ...battleClears };
```

(Important: origin clears apply on EVERY move whose target isn't battle — even territory→hand — harmless because the fields are already `''` outside battle.)

- [ ] **Step 2:** Extract one module-level `const ABILITY_SOURCE_ZONES = ['territory','land-of-bondage','land-of-redemption','battle']` and replace all 6 inline copies. Add `'battle'` to `DEFAULT_ABILITY_SOURCE_ZONES` in BOTH cardAbilities files (client + module). Leave per-ability explicit `sourceZones` arrays untouched (spec §7).

- [ ] **Step 3:** Typecheck module + client (`npx tsc --noEmit` in both roots). Commit `feat(battle): treat battle as in-play for counters/abilities; centralize origin clearing`.

### Task 3: Entry stamping, closed-band redirect, attach/bypass fixes

**Files:**
- Modify: `spacetimedb/src/index.ts` — `move_card` (~2250-2580), `move_cards_batch` (~2593-3010), `attach_card` (~4534), `shuffle_card_into_deck` (~4828), `move_opponent_card` (~6922)

**Interfaces:**
- Produces: helper `stampBattleEntry(ctx, game, card, updates)` used by both move reducers and `attach_card`; sets `updates.originZone/originPosX/originPosY` from the card's CURRENT zone/pos and `game.lastBattlePlayBySeat` = card **owner's** seat.

- [ ] **Step 1:** Add near the other helpers:

```ts
// Battle entry: stamp origin (pre-move zone/pos) + last-play seat (card owner, not
// sender — courtesy drags must not steal initiative). Spec §7.
function stampBattleEntry(ctx: any, gameId: bigint, card: any, updates: any) {
  if (card.zone === 'battle') return; // intra-band repositions never re-stamp
  updates.originZone = card.zone;
  updates.originPosX = card.posX;
  updates.originPosY = card.posY;
  const owner = ctx.db.Player.id.find(card.ownerId);
  const game = ctx.db.Game.id.find(gameId);
  if (owner && game) ctx.db.Game.id.update({ ...game, lastBattlePlayBySeat: owner.seat.toString() });
}
```

- [ ] **Step 2:** In `move_card` and `move_cards_batch` main paths, before the zone write when `toZone === 'battle'`:
  - If `game.battleState !== 'active'` → **redirect** `toZone = 'territory'` (mirror the lost-soul redirect pattern at ~2307; log nothing extra). Spec §7: undo replays / stale dispatches must not create invisible cards.
  - Else call `stampBattleEntry(...)`.

- [ ] **Step 3:** `attach_card`: when the host's zone is `'battle'`, keep `attachZone = 'battle'` and stamp the weapon via `stampBattleEntry` (spec §4). Verify `detach_card` drops in the host's current zone (read it; fix only if it hardcodes territory).

- [ ] **Step 4:** Route `shuffle_card_into_deck` and `move_opponent_card` zone writes through `leavePlayFieldOverrides`/`clearCountersIfLeavingPlay` (fixes pre-existing counter leak too), and make `move_opponent_card` reject `toZone === 'battle'` with `SenderError('Cannot move cards into battle for the opponent')` (spec §7).

- [ ] **Step 5:** Typecheck. Commit `feat(battle): entry stamping, closed-band redirect, attach-in-battle, helper routing`.

### Task 4: Auto-return routine + `end_battle` + `end_turn` hook

**Files:**
- Modify: `spacetimedb/src/index.ts` (new helper + reducer; `end_turn` ~2076)

**Interfaces:**
- Produces: `runBattleAutoReturn(ctx, gameId)` — snapshot-safe routing of all rows in zone `'battle'`, clears `battleState/battleAttackerSeat/lastBattlePlayBySeat`; reducer `end_battle(gameId)` callable by either player when `battleState !== ''`.

- [ ] **Step 1:** Implement `runBattleAutoReturn` per spec §7 routing precedence. Skeleton (adapt iteration/index patterns from `move_cards_batch` ~2698-2713 — snapshot first, LOCAL per-(owner,zone) index counters):

```ts
function runBattleAutoReturn(ctx: any, gameId: bigint) {
  const game = ctx.db.Game.id.find(gameId);
  if (!game || game.battleState === '') return;
  const all = [...ctx.db.CardInstance.card_instance_game_id.filter(gameId)];
  const inBattle = all.filter((c: any) => c.zone === 'battle');
  const keptNames: string[] = [];
  // local free-form index counters per owner+zone, seeded from snapshot
  const nextIdx = new Map<string, bigint>(); /* seed from `all` like batch reducer */
  const hosts = new Map<string, any>(); // instanceId -> routed host row
  const isPlaceKeep = (sa: string) =>
    /\bplace\b/i.test(sa) && !/\bin (the )?place of\b/i.test(sa) && !/take the place of/i.test(sa);
  const enhSegment = (ct: string) =>
    ct.split('/').map((s: string) => s.trim()).some((s: string) => s === 'GE' || s === 'EE');
  const routed: any[] = [];
  for (const c of inBattle) {
    if (c.equippedToInstanceId !== 0n) continue; // pass 2: follow host
    let toZone = 'territory'; let posX = ''; let posY = '';
    if (isLostSoul(c)) { toZone = 'land-of-bondage'; }
    else if (isCharacterCard(c.cardName, c.cardType)) {
      if (c.originZone === 'territory') { posX = c.originPosX; posY = c.originPosY; }
      // non-territory origin (hand/reserve/discard) → free territory spot per REG
    } else if (enhSegment(c.cardType)) {
      if (isPlaceKeep(c.specialAbility)) { keptNames.push(c.cardName); }
      else { toZone = 'discard'; }
    } else {
      // Dominants/Artifacts/Curses/Fortresses/unknown/Forge-blanked: origin, NEVER discard
      if (c.originZone !== '') { toZone = c.originZone === 'battle' ? 'territory' : c.originZone; posX = c.originPosX; posY = c.originPosY; }
    }
    if (c.isToken && ['deck','hand','discard','reserve','banish'].includes(toZone)) {
      deleteTokenWithCounters(ctx, c); continue;
    }
    /* write row: zone, pos (or freeform slot via nextIdx), clear origin fields,
       spread leavePlayFieldOverrides('battle', toZone) for counters/notes/meek */
    hosts.set(c.id.toString(), /* routed row */);
  }
  for (const c of inBattle) { /* pass 2: equipped accessories follow hosts.get(...) zone, keep attachment */ }
  logAction(ctx, gameId, 0n, 'BATTLE_END', JSON.stringify({ kept: keptNames }), game.turnNumber, game.currentPhase);
  const g2 = ctx.db.Game.id.find(gameId);
  ctx.db.Game.id.update({ ...g2, battleState: '', battleAttackerSeat: '', lastBattlePlayBySeat: '' });
}
```

(The implementer fills the marked writes using the EXACT idioms already in `move_cards_batch` — free-form `zoneIndex` assignment, `leavePlayFieldOverrides` spread, LoB routing via the existing lost-soul helpers. `isLostSoul` = the LS check used at index.ts ~4408: `cardType 'LS' | 'TOKEN_LS' |` name contains "lost soul".)

- [ ] **Step 2:** Reducer:

```ts
export const end_battle = spacetimedb.reducer({ gameId: t.u64() }, (ctx, { gameId }) => {
  const game = ctx.db.Game.id.find(gameId);
  if (!game) throw new SenderError('Game not found');
  if (game.status !== 'playing') throw new SenderError('Game is not in playing state');
  if (game.battleState === '') throw new SenderError('No battle in progress');
  findPlayerBySender(ctx, gameId); // either player; also blocks spectators
  runBattleAutoReturn(ctx, gameId);
});
```

- [ ] **Step 3:** `end_turn` hook — first line of its body after game/player validation: `if (game.battleState !== '') runBattleAutoReturn(ctx, gameId);` then re-read the game row before further mutation (auto-return updates it).

- [ ] **Step 4:** Typecheck. Commit `feat(battle): auto-return routine, end_battle reducer, end_turn hook`.

### Task 5: `enter_battle`, `resolve_battle`, `surrender_soul`

**Files:**
- Modify: `spacetimedb/src/index.ts`

**Interfaces:**
- Produces: reducers `enter_battle(gameId, cardId, posX, posY)`, `resolve_battle(gameId)`, `surrender_soul(gameId, cardId)`.
- Consumes: `stampBattleEntry`, `runBattleAutoReturn`, `moveLostSoulToLor(ctx, gameId, card, targetOwnerId, game)` (~4334), `normalizeFormat` (~111), `refillSoulDeck`.

- [ ] **Step 1: `enter_battle`** — atomic open+move (spec §4): validate `status==='playing'`; if `battleState===''` set `{battleState:'active', battleAttackerSeat: game.currentTurn.toString(), lastBattlePlayBySeat: ''}`; then perform the move into `'battle'` exactly as `move_card` would (reuse its battle-entry path — extract shared logic rather than duplicating: `stampBattleEntry` + zone/pos write + `leavePlayFieldOverrides` spread).

- [ ] **Step 2: `resolve_battle`** — per spec §7: guard `battleState==='active'`; caller seat must equal `battleAttackerSeat` (Claim Victory) or the other seat (Battle Lost); Paragon: call `refillSoulDeck` first; stakes LoB = defender's LoB for T1/T2 (`normalizeFormat`), shared LoB (`ownerId 0n` LoB rows) for Paragon; ≥1 Lost Soul → `battleState='awaiting-soul'`, else `runBattleAutoReturn`.

- [ ] **Step 3: `surrender_soul`** — per spec §7: guard `battleState==='awaiting-soul'`; chooser permission (T1 → defender seat; T2/Paragon → attacker seat); validate LS in stakes LoB (reuse the LS check at ~4408); `moveLostSoulToLor(ctx, gameId, card, attackerPlayerId, game)`; then **T1/Paragon**: `runBattleAutoReturn`; **T2**: leave `battleState='awaiting-soul'` (dialog's Done → `end_battle`).

- [ ] **Step 4:** Typecheck. Commit `feat(battle): enter/resolve/surrender reducers`.

### Task 6: Publish module + regenerate bindings

- [ ] **Step 1:** Invoke the **`spacetimedb-deploy` skill** (dev module, `--clear` — schema changed; project memory: incremental publish after schema change panics with "No such index").
- [ ] **Step 2:** Verify generated bindings include the new columns + 3 reducers (`grep -l battleState app/play/generated/ -r` or wherever bindings live — follow the skill's output).
- [ ] **Step 3:** `npx tsc --noEmit` at repo root. Commit bindings: `feat(battle): regenerate spacetimedb bindings`.
- Note (spec §11): prod publish happens only at feature ship, paired with a Vercel deploy of these bindings.

### Task 7: Layout — `battleActive` variants + invariants

**Files:**
- Modify: `app/play/layout/multiplayerLayout.ts`
- Create: `app/play/layout/__tests__/multiplayerLayout.battle.test.ts`

**Interfaces:**
- Produces: `calculateMultiplayerLayout(stageWidth, stageHeight, format, viewerKind, battleActive = false)`; when active, `zones.battle: ZoneRect` is set and `zones.divider.height === 0`; sidebar + `pileCard` ALWAYS computed from idle anchors.

- [ ] **Step 1: Write failing tests** (all profiles × viewerKinds × formats):

```ts
import { describe, it, expect } from 'vitest';
import { calculateMultiplayerLayout } from '../multiplayerLayout';

const CASES = [
  { w: 1920, h: 1080 }, { w: 1440, h: 1080 }, // Standard / Narrow
];
describe('battle layout invariants', () => {
  for (const { w, h } of CASES) for (const vk of ['player','spectator'] as const) {
    it(`midline pinned + sidebar idle-keyed @${w} ${vk}`, () => {
      const idle = calculateMultiplayerLayout(w, h, 'T1', vk, false);
      const battle = calculateMultiplayerLayout(w, h, 'T1', vk, true);
      const idleCenter = idle.zones.divider.y + idle.zones.divider.height / 2;
      const band = battle.zones.battle!;
      expect(Math.abs(band.y + band.height / 2 - idleCenter)).toBeLessThanOrEqual(2);
      expect(battle.sidebar).toEqual(idle.sidebar);           // piles never move
      expect(battle.pileCard).toEqual(idle.pileCard);          // piles never resize
      expect(battle.zones.playerHand.y + battle.zones.playerHand.height).toBe(h); // rows fill stage
      expect(battle.zones.opponentLob.height).toBe(idle.zones.opponentLob.height); // LoBs untouched
    });
  }
  it('paragon battle band sits below shared LoB, taken equally from territories', () => {
    const idle = calculateMultiplayerLayout(1920, 1080, 'Paragon', 'player', false);
    const battle = calculateMultiplayerLayout(1920, 1080, 'Paragon', 'player', true);
    expect(battle.zones.battle!.y).toBeGreaterThanOrEqual(battle.zones.sharedLob!.y + battle.zones.sharedLob!.height - 1);
    const oppShrink = idle.zones.opponentTerritory.height - battle.zones.opponentTerritory.height;
    const plShrink = idle.zones.playerTerritory.height - battle.zones.playerTerritory.height;
    expect(Math.abs(oppShrink - plShrink)).toBeLessThanOrEqual(2);
  });
});
```

- [ ] **Step 2:** Run: `npx vitest run app/play/layout/__tests__/multiplayerLayout.battle.test.ts` — FAIL (no `battleActive` param / `zones.battle`).

- [ ] **Step 3: Implement.** Battle ratio sets (spec §2 — sums are exactly 1.0, keep the sum-check comments):
  - Standard battle: oppHand .08, oppLob .09, oppTerritory .185, band .19, playerTerritory .21, playerLob .09, playerHand .155.
  - Narrow battle: .07 / .10 / .1975 / .17 / .2125 / .10 / .15.
  - Spectator deltas compose unchanged (they cancel: +.035 opp hand / −.035 player hand).
  - Compute idle Y anchors ALWAYS; feed `buildSidebar` + `pileCard` from idle values only. Battle anchors feed the zone rects. `zones.battle` label `'Field of Battle'`. Non-battle: `zones.battle` undefined. T1/T2 battle: divider rect collapses to zero-height at the band midline (Paragon precedent, line ~443). Paragon battle: band opens below `sharedLob`, half-height taken from each territory; sharedLob/soulDeck shift up by band/2.
  - Add `MultiplayerLayout.zones.battle?: ZoneRect`.

- [ ] **Step 4:** Tests pass; also run the existing layout/LoB tests (`npx vitest run app/play/layout`). Commit `feat(battle): layout battle variants with pinned midline and idle-keyed sidebar`.

### Task 8: `battleMath` pure lib

**Files:**
- Create: `app/play/lib/battleMath.ts`, `app/play/lib/__tests__/battleMath.test.ts`

**Interfaces:**
- Produces (consumed by Tasks 10/12/13):

```ts
export type BattleSeat = '0' | '1';
export interface BattleCardLike { ownerSeat: BattleSeat; dbY: number; cardRelH: number;
  strength: string; toughness: string; brigade: string; cardType: string;
  specialAbility: string; isFlipped: boolean; }
export function battleSideOf(c: BattleCardLike): BattleSeat; // centerY = dbY + cardRelH/2 >= 0.5 ? ownerSeat : other
export interface SideTotals { str: number; tgh: number; hasUnknown: boolean; }
export function sideTotals(cards: BattleCardLike[], side: BattleSeat): SideTotals; // face-down excluded → hasUnknown
export type InitiativeState =
  | { kind: 'waiting-blocker' } | { kind: 'no-attacker' }
  | { kind: 'unknown' }
  | { kind: 'initiative'; seat: BattleSeat; reason: 'losing' | 'stalemate' | 'mutual-destruction' };
export function computeInitiative(cards: BattleCardLike[], attackerSeat: BattleSeat, lastPlayBySeat: BattleSeat | ''): InitiativeState;
export function brigadeMismatch(enh: BattleCardLike, sameSideCharacters: BattleCardLike[]): boolean;
```

- [ ] **Step 1: Failing tests** — cover: all four REG table rows incl. boundaries (`str < tgh && tgh <= str`: test str=4,tgh=4 vs str=5,tgh=5 → losing; equal 5/5 vs 5/5 → mutual destruction; 3/9 vs 3/9 → stalemate); **anchor-clamp regression**: card with `dbY=0.33, cardRelH=0.67` (max clamped anchor, center 0.665) → own side — an anchor-based `>=0.5` test would fail this; opponent mirroring is a non-issue (dbY is owner-local — document with a test comment); face-down → excluded + `hasUnknown` → `computeInitiative` returns `{kind:'unknown'}`; `*`/`''` stats → 0 + hasUnknown; empty defender side → `waiting-blocker`, empty attacker side → `no-attacker`; stalemate with `lastPlayBySeat=''` → initiative seat = non-attacker (blocker played last in practice; when unset, default reason-holder = attacker's opponent... **NO — spec is silent; return `{kind:'unknown'}` when stalemate/mutual and `lastPlayBySeat===''`**); brigade: exact token intersection, multi/neutral matches anything, `'Good Gold/Evil Gold'` splits.

- [ ] **Step 2:** Run — FAIL. **Step 3:** Implement (pure functions, no imports from canvas). **Step 4:** Pass. **Step 5:** Commit `feat(battle): battleMath lib (sides, totals, initiative, brigade)`.

### Task 9: ZoneId + client zone plumbing

**Files:**
- Modify: `app/shared/types/gameCard.ts` (ZoneId union ~8, ALL_ZONES ~20, ZONE_LABELS ~26)
- Modify: `app/goldfish/**/zoneLayout.ts` (fully-keyed Record ~148-159 — off-canvas placeholder rect, `paragonZone` precedent), goldfish `gameInitializer.ts` (verify `createEmptyZones` picks up battle via ALL_ZONES)
- Modify: `app/play/components/MultiplayerCanvas.tsx` — `isFreeFormZone` (~119)

- [ ] **Step 1:** Add `'battle'` to `ZoneId` + `ALL_ZONES` + `ZONE_LABELS: { battle: 'Field of Battle' }`. Fix every compile error `npx tsc --noEmit` surfaces (expected: goldfish zoneLayout Record; audit `MultiCardContextMenu`, `ZoneBrowseModal`, `refill.test` iterators — battle should be a no-op/hidden entry in goldfish contexts).
- [ ] **Step 2:** `isFreeFormZone = (zone) => zone === 'territory' || zone === 'battle'` (one predicate, five behaviors — spec §4).
- [ ] **Step 3:** `npx tsc --noEmit` clean + `npx vitest run` (goldfish refill test still green). Commit `feat(battle): battle ZoneId plumbing + free-form classification`.

### Task 10: Canvas — static band render, hit-testing, drops

**Files:**
- Modify: `app/play/components/MultiplayerCanvas.tsx`: layout call (~530), zone memos (~549-573), `findZoneAtPosition` (~2268-2317), drag-end drop handling (~3573-3608), render blocks (pattern: territory groups at ~5193-5336), `allCardBounds` (~4467), `allZoneRects` (~4759)
- Modify: `app/play/hooks/useGameState.ts` — expose `battleState`, `battleAttackerSeat`, `lastBattlePlayBySeat`, and `enterBattle/endBattle/resolveBattle/surrenderSoul` reducer wrappers (pattern: existing wrappers around ~300-400)

**Interfaces:**
- Consumes: `zones.battle` (Task 7), bindings (Task 6).
- Produces: cards render/drag in the band; `handleCardDragEnd` battle drops call `enterBattle(cardId, x, y)` when `battleState !== 'active'`, else plain `moveCard` with `targetOwnerId: ''`.

- [ ] **Step 1:** Pass `battleActive={game.battleState === 'active' || game.battleState === 'awaiting-soul'}` into the layout call. (Deferral while dragging arrives in Task 15 — note the TODO.)
- [ ] **Step 2:** Hit-testing (spec §4): in `findZoneAtPosition`, BEFORE the `myZones` loop: if battle active and point in `zones.battle` → return `{ zone: 'battle', owner: 'my' }` (owner is irrelevant for battle; drop path must send `targetOwnerId: ''`). If battle INACTIVE and `status==='playing'` and point in a divider proxy rect (divider Y-center ± 1.5% of stage height, play-area width) → return `{ zone: 'battle', owner: 'my' }`.
- [ ] **Step 3:** Drop path in `handleCardDragEnd` for `zone === 'battle'`: clamp against the FULL band rect; convert via `toDbPos(x, y, band, cardOwner)` (mirroring by CARD owner — spec §3); `targetIsRotated = card is opponent-owned`; if `battleState !== 'active'` → `gameState.enterBattle(...)` else `moveCard(id, 'battle', '', x, y)`.
- [ ] **Step 4:** Render: two Konva groups inside a band clip Group — my battle cards (rot 0, `toScreenPos(...,'my')`) and opponent battle cards (rot 180 + anchor offset, `toScreenPos(...,'opponent')`), reusing the territory render pattern verbatim, at `mainCard` size, with the render-time bottom clamp (spec §2) applied in BOTH territory and battle groups:

```ts
const clampedY = Math.min(screenY, zone.y + zone.height - cardHeight); // rot-0; mirrored variant for rot-180
```

- [ ] **Step 5:** Add band rect to `allZoneRects` (hover glow) and battle cards to `allCardBounds` (marquee).
- [ ] **Step 6:** Manual verify via the **`verify` skill** (two sessions): drag hero onto divider → band opens both clients; drag across centerline; opponent drags; reload page mid-battle → band restored. Commit `feat(battle): static band rendering, hit-testing, atomic enter_battle drops`.

### Task 11: Weapons in battle

**Files:**
- Modify: `MultiplayerCanvas.tsx` — attach gate (~3439-3445), derived weapon positions (`myDerivedWeaponPositions` ~4375+)

- [ ] **Step 1:** Extend the attach drop gate to `(targetZone === 'territory' || targetZone === 'battle') && hit.owner === 'my'` — for battle, host lookup searches my battle cards.
- [ ] **Step 2:** Add battle derived-position maps for both owners (copy the territory pattern; opponent variant uses the rot-180 anchor).
- [ ] **Step 3:** Verify-skill check: equip weapon onto battling hero — hero stays in band, weapon renders attached; end battle → both return together attached. Commit `feat(battle): weapon attach + derived rendering in the band`.

### Task 12: Band chrome — totals, initiative banner, header

**Files:**
- Modify: `MultiplayerCanvas.tsx` (new Konva chrome group rendered AFTER the battle card groups — chips/banner/buttons above cards, with backdrop)

**Interfaces:**
- Consumes: `battleMath` (Task 8); `mpLayout.zones.battle`; `game.battleAttackerSeat/lastBattlePlayBySeat`.

- [ ] **Step 1:** Build `BattleCardLike[]` from battle-zone rows (`cardRelH = mainCard.cardHeight / band.height`; `ownerSeat` from ownerId→seat map; `dbY = parseFloat(posX/posY)` owner-local).
- [ ] **Step 2:** Chrome per spec §5: gutter-anchored chips `⚔ {str}/{tgh}` (+`?` when hasUnknown) per half; centerline dashed rule; header `⚔ {attackerName} attacking — {Rescue attempt|Battle challenge}` (stakes-LoB count from rows); banner from `computeInitiative` incl. the two empty-side strings and the unknown degradation. All on a dark backdrop Rect (listening={false} so drags pass through except on buttons).
- [ ] **Step 3:** Brigade soft-check (spec §6): on battle rows change, for each GE/EE-segment enhancement with `brigadeMismatch(...)` → red pulsing `shadowColor` on its card node + one interactive toast in a NEW band-edge HTML container (`virtualToScreen` positioning, zIndex 600, pointer events auto) with a `Discard` button → `moveCard(id,'discard')`.
- [ ] **Step 4:** Verify-skill: two-client sanity of totals/initiative flipping as enhancements land; neutral card dragged across centerline flips totals. Commit `feat(battle): band chrome — totals, initiative banner, brigade warnings`.

### Task 13: Resolution buttons + confirm summary

**Files:**
- Create: `app/play/components/BattleResolutionUI.tsx` (HTML overlay: band buttons + confirm dialog; positioned via `virtualToScreen`, zIndex 600)
- Modify: `app/play/[code]/client.tsx` (mount it), `useGameState.ts` (already has wrappers from Task 10)

- [ ] **Step 1:** Buttons per spec §8, gated `status==='playing'`: attacker seat sees `⚑ Claim Victory`, defender seat sees `🏳 Battle Lost`, both see `↩ End Battle`; hidden for spectators; disabled during `awaiting-soul` (except the dialog flow). All three open the **confirm summary** first — computed client-side with the SAME precedence rules as `runBattleAutoReturn` (reuse a small client mirror in `battleMath.ts`: `summarizeAutoReturn(cards): { toTerritory: number; toDiscard: number; keptInPlay: string[]; weaponsAttached: number }`) → "N characters → territory · N enhancements → discard · kept: X, Y". Confirm → `resolveBattle()` / `endBattle()`.
- [ ] **Step 2:** End Turn guard (spec §8): in `TurnIndicator`/toolbar End Turn handlers, when `battleState==='awaiting-soul'` show confirm "A soul surrender is pending — end turn anyway?".
- [ ] **Step 3:** Verify-skill: stalemate End Battle round-trips cards to exact origin spots; enhancements discard; confirm lists counts. Commit `feat(battle): resolution buttons with auto-return confirm`.

### Task 14: Soul surrender dialog

**Files:**
- Modify: `BattleResolutionUI.tsx`

- [ ] **Step 1:** When `battleState==='awaiting-soul'`: chooser (T1 defender / T2+Paragon attacker, `normalizeFormat` mirror client-side) sees a modal of eligible souls (defender LoB rows T1/T2; `ownerId 0n` LoB rows Paragon) as card images; site-attached souls badged "⚑ in Site"; empty state has inline **End Battle** button. Non-choosers + spectators see a status line "Waiting for {name} to choose a soul…" near the band — never the modal.
- [ ] **Step 2:** Pick → `surrenderSoul(cardId)`. T2 only: dialog stays open with "Surrender another / **Done**" (Done → `endBattle()`); T1/Paragon close on the server's state clear (dialog visibility is purely `battleState`-driven — reconnect-safe).
- [ ] **Step 3:** Verify-skill E2E (spec §10): T1 full rescue (defender picks, soul → attacker LoR, survivors return); T2 two-soul rescue; Paragon shared-soul pick + soul-deck refill; escape hatch (End Battle during awaiting-soul). Commit `feat(battle): soul surrender dialogs per format`.

### Task 15: Animation + mid-drag safety

**Files:**
- Modify: `MultiplayerCanvas.tsx`

- [ ] **Step 1: Deferral (spec §4):** hold the applied `battleActive` in state; when the server flag flips while `isDraggingRef.current`, park the new value in a ref and apply it on dragend/dragcancel. Single-step flip (no per-frame layout animation).
- [ ] **Step 2: stopDrag guard:** effect watching the dragged card's row (`draggedCardIdRef`): if its zone changed server-side mid-drag → `node.stopDrag()`, clear drag refs (never let react-konva destroy a dragging node — ghost-card class).
- [ ] **Step 3: FLIP glides:** extend the `useHandLayoutTween` slot-map pattern with a combined territory+battle slot map so open/close glides cards between old/new rects (200ms EaseOut). **Opponent-owned targets bake the `+(cardW, cardH)` rot-180 anchor** (PR #176 lesson). Hand/LoB glide free via existing hooks.
- [ ] **Step 4:** Band background Rect gets a one-off `Konva.Tween` height/opacity ease on open/close ("seam opens").
- [ ] **Step 5:** Verify-skill: opponent opens battle while I'm mid-drag → no teleport, drop lands correctly, layout flips after release; opponent End Battle mid-drag of my battle card → drag cancels cleanly. Commit `feat(battle): seam animation, FLIP glides, mid-drag safety`.

### Task 16: Fallout sweep + full E2E + ship prep

- [ ] **Step 1:** Spectator pass (band + status lines render, no buttons), Paragon layout in-browser check, Narrow-profile (resize to ~1366×768) band usability.
- [ ] **Step 2:** Full test suite `npx vitest run` + `npx tsc --noEmit`. Fix stragglers.
- [ ] **Step 3:** Update `prompt_context/context.md` (schema) and add a battle section pointer in `CLAUDE.md` Key References if warranted.
- [ ] **Step 4:** Push branch, open PR (base `origin/main`) with the spec linked; note the prod rollout pairing (module publish + Vercel deploy together — spec §11 Phase 1 note). Do NOT publish the prod module in this PR.
