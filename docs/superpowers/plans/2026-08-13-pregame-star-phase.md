# Pre-Game Star Phase + Lost Soul Activation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add REG Pre-Game Phase steps 2 (reveal star cards and use star abilities) and 3 (activate Lost Soul abilities) to online multiplayer, as ordered server-authoritative sub-phases between the first-player reveal and turn 1.

**Architecture:** `Game.pregamePhase` gains the values `'stars'` and `'souls'`, while `status` flips to `'playing'` as it does today — so every existing `status === 'playing'`-gated reducer keeps working and the disconnect grace is 5 minutes, not 30 seconds. Turn machinery (`end_turn`, `set_phase`, the round clock) is gated on `pregamePhase` instead. Three new tables carry the sub-phase state; no new `Game` columns, so the game row's BSATN shape is untouched. A non-blocking DOM rail over the Konva canvas drives selection and resolution.

**Tech Stack:** SpacetimeDB (TypeScript module), Next.js 15 App Router, React 19, Konva, vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-13-pregame-star-phase-design.md` (rev 2)

## Global Constraints

- **Worktree:** all work happens in `/Users/timestes/projects/rtt-star-phase` on branch `feat/pregame-star-phase`, using **absolute paths**. A sibling checkout exists at `/Users/timestes/projects/rtt-ability-reprints` — never read or touch it.
- **Never stage broadly.** `git add <specific files>` only — never `git add -A`, `.`, or `-a`.
- **Dev SpacetimeDB module only.** `.github/workflows/deploy-spacetimedb.yml` publishes `redemption-multiplayer-dev` for any non-`main` branch. Never publish `redemption-multiplayer`. Never merge this branch without a separate prod decision.
- **Read `spacetimedb/CLAUDE.md` before writing any SpacetimeDB code.** Indexes go in table OPTIONS (1st arg) and this repo uses `accessor:`, not `name:`. All u64 values are BigInt literals (`0n`). `.insert()` returns the row, not an id.
- **Test runner:** `npx vitest run <path>` from the worktree root. There is no `typecheck` script — use `npx tsc --noEmit`.
- **Never build while the dev server runs** (shared `.next`). Use `NEXT_DIST_DIR=.next-build npm run build` if a build is needed at all; prefer `npx tsc --noEmit`.
- **Star detection reads `CardInstance.specialAbility`**, never `findCard(cardName)` — Forge cards are absent from the public card index.
- **Registry edits touch both copies** (`lib/cards/cardAbilities.ts` and `spacetimedb/src/cardAbilities.ts`); the parity test in `lib/cards/__tests__/cardAbilities.test.ts` enforces it.

---

## File Structure

**Create**
| File | Responsibility |
|---|---|
| `lib/cards/starCards.ts` | Star-ability text detection. One regex, one predicate. |
| `lib/cards/__tests__/starCards.test.ts` | Pins the regex against generated card data. |
| `spacetimedb/src/pregameFlow.ts` | Pure sub-phase transition logic. No `ctx`, no DB — fully unit-testable. |
| `spacetimedb/__tests__/pregameFlow.test.ts` | Transition table tests. |
| `app/play/components/PregameRail.tsx` | The non-blocking star/soul rail. |

**Modify**
| File | Change |
|---|---|
| `lib/cards/cardAbilities.ts` | Add `'hand'` to `sourceZones` on 4 star-half entries. |
| `spacetimedb/src/cardAbilities.ts` | Mirror of the above. |
| `spacetimedb/src/schema.ts` | 3 new tables + schema export. |
| `spacetimedb/src/index.ts` | New reducers, `advancePregame`, `finishPregame`, per-ability `sourceZones` gate, turn gating, cleanup. |
| `app/play/hooks/useGameState.ts` | 2 subscriptions × 2 blocks, 3 reducer wrappers. |
| `app/play/components/TurnIndicator.tsx` | `pregameStep` prop + `activeKey` pill indirection. |
| `app/play/components/MultiplayerCanvas.tsx` | Mount `PregameRail`. |
| `app/play/[code]/client.tsx` | Pass `pregameStep` to `TurnIndicator`. |
| `app/play/spectate/[code]/client.tsx` | Spectator `pregameStep`. |
| `e2e/play/pregameStarPhase.spec.ts` | New e2e (create). |

---

## The card audit (derived, not assumed)

244 star cards; 37 have a registry entry; 21 already carry `'hand'`; **16 do not**. Of those 16, only **4** have a registry entry that encodes the card's **STAR** clause. The other 12 encode the card's in-play clause and must never be offered during the star phase.

**Add `'hand'` to these 4** — registry entry matches the STAR clause:

| Card | STAR text | Registry entry |
|---|---|---|
| `The Coming Prince` | "Look at the top card of a deck: You may underdeck it." | `look_at_own_deck top 1` + `underdeck_top_of_deck 1` |
| `Sign of Jonah` | "Look at the top or bottom 3 cards of deck: Take a good Dominant." | `look_at_own_deck top 3` |
| `The Thankful Leper (GoC)` | "Look at the top 10 cards of a deck." | `look_at_own_deck top 10` |
| `The Three Visitors` | "Look at the top 9 cards of deck: You may topdeck a human Hero." | `look_at_own_deck top 9` |

**Do NOT touch these 12** — registry entry encodes the in-play clause (EE/EC/GE/HERO/TOP/Artifact), not the STAR clause:

`Balaam's Prophecy`, `Destructive Sin (GoC)`, `Choked Seed (GoC)`, `Redeeming Branch`, `Strong Demon (GoC)`, `Shealtiel, the Heir / Shealtiel, the Exilarch (LoC)`, `Manna (PoC)`, `Out of Egypt`, `Ram, the Exalter / Ram, the Uplifted (LoC)`, `The Outcasts`, `Conspiring Herodians (GoC)`, `Foolish Builder (GoC)`.

---

### Task 1: Star detection

**Files:**
- Create: `lib/cards/starCards.ts`
- Test: `lib/cards/__tests__/starCards.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `STAR_ABILITY_RE: RegExp`, `isStarAbilityText(specialAbility: string | null | undefined): boolean`.

- [ ] **Step 1: Write the failing test**

Create `lib/cards/__tests__/starCards.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { isStarAbilityText, STAR_ABILITY_RE } from '@/lib/cards/starCards';
import { CARDS } from '@/lib/cards/lookup';

describe('isStarAbilityText', () => {
  it('matches both printed star markers', () => {
    expect(isStarAbilityText('(Star) Look at the top card of a deck.')).toBe(true);
    expect(isStarAbilityText('STAR: Look at the top 10 cards of a deck.')).toBe(true);
  });

  it('is anchored — "star" elsewhere in the text does not match', () => {
    expect(isStarAbilityText('At the start of your turn, draw 1.')).toBe(false);
    expect(isStarAbilityText('Band to Aristarchus.')).toBe(false);
    expect(isStarAbilityText('Topdeck a good * card. STAR: not really')).toBe(false);
  });

  it('handles empty and absent text', () => {
    expect(isStarAbilityText('')).toBe(false);
    expect(isStarAbilityText(null)).toBe(false);
    expect(isStarAbilityText(undefined)).toBe(false);
  });

  it('matches exactly the 244 star cards in the pool', () => {
    const matched = CARDS.filter((c) => isStarAbilityText(c.specialAbility));
    expect(matched.length).toBe(244);
  });

  it('has no false negatives — every card whose text mentions a star marker is matched', () => {
    const markerish = CARDS.filter((c) =>
      /(\(star\)|star:)/i.test(c.specialAbility ?? ''),
    );
    for (const c of markerish) {
      expect(isStarAbilityText(c.specialAbility)).toBe(true);
    }
  });

  it('every match begins with a star marker', () => {
    for (const c of CARDS.filter((x) => isStarAbilityText(x.specialAbility))) {
      expect(c.specialAbility).toMatch(STAR_ABILITY_RE);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/cards/__tests__/starCards.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/cards/starCards"`.

- [ ] **Step 3: Write minimal implementation**

Create `lib/cards/starCards.ts`:

```ts
/**
 * Star-card detection.
 *
 * Every star card in the pool leads its special ability with `(Star)` or
 * `STAR:` — 244 cards, verified against the generated card data. The regex is
 * anchored so the words "start"/"starts"/"Aristarchus" can never match.
 *
 * Always test against a card row's OWN `specialAbility` text, never against
 * `findCard(cardName)`: Forge cards are absent from the public card index, so
 * a lookup-based gate silently reads false for them.
 *
 * Mirrored server-side in `spacetimedb/src/index.ts` (isStarAbilityText) —
 * keep the two in sync.
 */
export const STAR_ABILITY_RE = /^\s*(\(star\)|star:)/i;

export function isStarAbilityText(specialAbility: string | null | undefined): boolean {
  return STAR_ABILITY_RE.test(specialAbility ?? '');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/cards/__tests__/starCards.test.ts`
Expected: PASS, 6 tests.

If the 244 assertion fails, the card data has changed since the audit. Do **not** loosen the assertion — update the number and note the delta in the commit message.

- [ ] **Step 5: Commit**

```bash
cd /Users/timestes/projects/rtt-star-phase
git add lib/cards/starCards.ts lib/cards/__tests__/starCards.test.ts
git commit -m "feat(cards): star-ability detection helper"
```

---

### Task 2: Make the 4 star-half abilities fireable from hand

**Files:**
- Modify: `lib/cards/cardAbilities.ts`
- Modify: `spacetimedb/src/cardAbilities.ts`
- Test: `lib/cards/__tests__/cardAbilities.test.ts`

**Interfaces:**
- Consumes: `isStarAbilityText` (Task 1).
- Produces: nothing new; 4 registry entries gain `'hand'` in `sourceZones`.

`sourceZones` encodes **which zone an ability may be fired from** — not what the effect does. All four cards' registry entries encode their STAR clause, which is by definition used while the card is in hand.

- [ ] **Step 1: Write the failing test**

Append to `lib/cards/__tests__/cardAbilities.test.ts`:

```ts
describe('star abilities are fireable from hand', () => {
  const STAR_HALF_CARDS = [
    'The Coming Prince',
    'Sign of Jonah',
    'The Thankful Leper (GoC)',
    'The Three Visitors',
  ];

  // These 12 star cards have a registry entry that encodes the card's IN-PLAY
  // clause (EE/EC/GE/HERO/TOP/Artifact), not its STAR clause. Firing them from
  // hand during the pre-game star phase would resolve the wrong ability.
  const IN_PLAY_HALF_CARDS = [
    "Balaam's Prophecy",
    'Destructive Sin (GoC)',
    'Choked Seed (GoC)',
    'Redeeming Branch',
    'Strong Demon (GoC)',
    'Shealtiel, the Heir / Shealtiel, the Exilarch (LoC)',
    'Manna (PoC)',
    'Out of Egypt',
    'Ram, the Exalter / Ram, the Uplifted (LoC)',
    'The Outcasts',
    'Conspiring Herodians (GoC)',
    'Foolish Builder (GoC)',
  ];

  it.each(STAR_HALF_CARDS)('%s can fire from hand', (name) => {
    const abilities = CARD_ABILITIES[name];
    expect(abilities, `${name} missing from registry`).toBeDefined();
    for (const a of abilities) {
      expect(a.sourceZones ?? DEFAULT_ABILITY_SOURCE_ZONES).toContain('hand');
    }
  });

  it.each(IN_PLAY_HALF_CARDS)('%s stays in-play only', (name) => {
    const abilities = CARD_ABILITIES[name];
    expect(abilities, `${name} missing from registry`).toBeDefined();
    for (const a of abilities) {
      expect(a.sourceZones ?? DEFAULT_ABILITY_SOURCE_ZONES).not.toContain('hand');
    }
  });
});
```

Ensure `CARD_ABILITIES` and `DEFAULT_ABILITY_SOURCE_ZONES` are in the file's existing import list from `@/lib/cards/cardAbilities`; add them if absent.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/cards/__tests__/cardAbilities.test.ts -t "fireable from hand"`
Expected: FAIL — the 4 STAR_HALF_CARDS assertions fail (`expected [...] to contain 'hand'`). The 12 IN_PLAY assertions should already pass.

- [ ] **Step 3: Add `'hand'` to the 4 entries in both registry copies**

In **both** `lib/cards/cardAbilities.ts` and `spacetimedb/src/cardAbilities.ts`, add an explicit `sourceZones` to each ability object on these four keys. Use the same zone list the existing hand-legal entries use (e.g. `'Delivered'`), with `'hand'` first:

```ts
'The Coming Prince':      [{ type: 'look_at_own_deck', position: 'top', count: 1, sourceZones: ['hand', 'territory', 'land-of-bondage', 'land-of-redemption'] },
                           { type: 'underdeck_top_of_deck', count: 1, sourceZones: ['hand', 'territory', 'land-of-bondage', 'land-of-redemption'] }],
'Sign of Jonah':          [{ type: 'look_at_own_deck', position: 'top', count: 3, sourceZones: ['hand', 'territory', 'land-of-bondage', 'land-of-redemption'] }],
'The Thankful Leper (GoC)': [{ type: 'look_at_own_deck', position: 'top', count: 10, sourceZones: ['hand', 'territory', 'land-of-bondage', 'land-of-redemption'] }],
'The Three Visitors':     [{ type: 'look_at_own_deck', position: 'top', count: 9, sourceZones: ['hand', 'territory', 'land-of-bondage', 'land-of-redemption'] }],
```

Match each file's existing key spelling and alignment exactly — copy the current line and add the field rather than retyping the entry. Do not reformat neighbouring lines.

Add a short comment above the group in `lib/cards/cardAbilities.ts`:

```ts
// (Star) abilities are used from hand during the REG Pre-Game Phase, so their
// registered entry takes the hand override. Only entries encoding the card's
// STAR clause qualify — the 12 star cards whose entry encodes their in-play
// clause (Manna (PoC), The Outcasts, Redeeming Branch, …) deliberately do not.
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/cards/__tests__/cardAbilities.test.ts`
Expected: PASS — including the pre-existing lib↔spacetimedb parity test, which fails loudly if only one copy was edited.

- [ ] **Step 5: Commit**

```bash
cd /Users/timestes/projects/rtt-star-phase
git add lib/cards/cardAbilities.ts spacetimedb/src/cardAbilities.ts lib/cards/__tests__/cardAbilities.test.ts
git commit -m "feat(cards): star-half abilities fire from hand"
```

---

### Task 3: Server honours per-ability `sourceZones`

**Files:**
- Modify: `spacetimedb/src/index.ts` (around `:4720-4724` and `:4854`)

**Interfaces:**
- Consumes: nothing.
- Produces: `execute_card_ability` / `execute_card_ability_with_count` now respect an ability's own `sourceZones`.

`execute_card_ability` checks a flat `ABILITY_SOURCE_ZONES` list and never consults the ability's override, even though the registry carries the field. `Delivered` already declares `'hand'` and would still be rejected — it goes unnoticed only because every currently-hand-legal type is intercepted client-side. Task 2 adds 4 entries whose types (`look_at_own_deck`, `underdeck_top_of_deck`) are **not** all intercepted, making this reachable.

Do **not** add `'hand'` to the global `ABILITY_SOURCE_ZONES` — that would let any ability fire from hand.

- [ ] **Step 1: Move the zone check below the ability lookup in `execute_card_ability`**

Find the block at roughly `spacetimedb/src/index.ts:4719-4733`:

```ts
    if (!ABILITY_SOURCE_ZONES.includes(source.zone)) {
      throw new SenderError('Source card must be in play');
    }

    // Registry keys match cardName ...
    const abilities = getEffectiveAbilities(source);
    const ability = abilities[Number(abilityIndex)];
    if (!ability) throw new SenderError('No such ability');
```

Replace with:

```ts
    // Registry keys match cardName ...
    const abilities = getEffectiveAbilities(source);
    const ability = abilities[Number(abilityIndex)];
    if (!ability) throw new SenderError('No such ability');

    // Abilities fire from the "in play" zones by default; an entry may widen
    // that with its own sourceZones (e.g. (Star) abilities used from hand
    // during the Pre-Game Phase). Mirrors the client gate in CardContextMenu.
    const allowedZones = ability.sourceZones ?? ABILITY_SOURCE_ZONES;
    if (!allowedZones.includes(source.zone)) {
      throw new SenderError('Source card must be in play');
    }
```

Keep the surrounding comment lines that already document the registry-key rule.

- [ ] **Step 2: Apply the identical change in `execute_card_ability_with_count`**

Find the same flat check at roughly `:4854` and apply the same reordering, using that reducer's own ability-lookup variable names.

- [ ] **Step 3: Verify no other call site regressed**

Run: `cd /Users/timestes/projects/rtt-star-phase && rg -n "ABILITY_SOURCE_ZONES" spacetimedb/src/index.ts`
Expected: the `const` definition, plus the two edited sites now reading `ability.sourceZones ?? ABILITY_SOURCE_ZONES`, plus the untouched special-purpose gates in `resurrect_heroes`, `imitate_lost_soul`, and `matthew_draw_brigades`. Those three are not star paths — leave them.

- [ ] **Step 4: Type-check the module**

Run: `cd /Users/timestes/projects/rtt-star-phase/spacetimedb && npx tsc --noEmit -p tsconfig.json`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
cd /Users/timestes/projects/rtt-star-phase
git add spacetimedb/src/index.ts
git commit -m "fix(play): honour per-ability sourceZones in execute_card_ability"
```

---

### Task 4: Pure sub-phase transition logic

**Files:**
- Create: `spacetimedb/src/pregameFlow.ts`
- Test: `spacetimedb/__tests__/pregameFlow.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type Seat = 0 | 1`
  - `type PregameStep = 'stars' | 'souls'`
  - `interface PregameProgress { starsDone0: boolean; starsDone1: boolean; soulsDone0: boolean; soulsDone1: boolean }`
  - `interface PregameEligibility { hasStarInHand(seat: Seat): boolean; controlsActivatableSoul(seat: Seat): boolean }`
  - `type PregameAdvance = { kind: 'await'; step: PregameStep; activeSeat: Seat; progress: PregameProgress } | { kind: 'complete'; progress: PregameProgress }`
  - `function advancePregameFlow(step: PregameStep, firstSeat: Seat, progress: PregameProgress, eligibility: PregameEligibility): PregameAdvance`
  - `function markDone(progress: PregameProgress, step: PregameStep, seat: Seat): PregameProgress`

This module is pure — no `ctx`, no DB — so it lives outside `spacetimedb/src`'s runtime concerns and is unit-testable. It follows the existing `spacetimedb/src/battlePlacement.ts` + `spacetimedb/__tests__/battlePlacement.test.ts` pattern (the test lives outside `src` so its vitest import is never pulled into `spacetime publish`).

- [ ] **Step 1: Write the failing test**

Create `spacetimedb/__tests__/pregameFlow.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
// Lives outside spacetimedb/src (the module's tsconfig `include`) so its vitest
// import is never pulled into `spacetime publish`; root vitest still runs it
// via the **/__tests__/** glob.
import {
  advancePregameFlow,
  markDone,
  type PregameProgress,
  type PregameEligibility,
  type Seat,
} from '../src/pregameFlow';

const FRESH: PregameProgress = {
  starsDone0: false, starsDone1: false, soulsDone0: false, soulsDone1: false,
};

const eligibility = (
  stars: [boolean, boolean],
  souls: [boolean, boolean],
): PregameEligibility => ({
  hasStarInHand: (seat: Seat) => stars[seat],
  controlsActivatableSoul: (seat: Seat) => souls[seat],
});

describe('advancePregameFlow', () => {
  it('opens the star window for the first player when they hold a star', () => {
    const r = advancePregameFlow('stars', 1, FRESH, eligibility([true, true], [false, false]));
    expect(r).toEqual({
      kind: 'await', step: 'stars', activeSeat: 1,
      progress: FRESH,
    });
  });

  it('skips a seat with no stars and opens the other', () => {
    const r = advancePregameFlow('stars', 0, FRESH, eligibility([false, true], [false, false]));
    expect(r.kind).toBe('await');
    if (r.kind !== 'await') return;
    expect(r.step).toBe('stars');
    expect(r.activeSeat).toBe(1);
    expect(r.progress.starsDone0).toBe(true);
  });

  it('falls through to souls when neither player holds a star', () => {
    const r = advancePregameFlow('stars', 0, FRESH, eligibility([false, false], [true, false]));
    expect(r.kind).toBe('await');
    if (r.kind !== 'await') return;
    expect(r.step).toBe('souls');
    expect(r.activeSeat).toBe(0);
    expect(r.progress.starsDone0).toBe(true);
    expect(r.progress.starsDone1).toBe(true);
  });

  it('completes when neither player has stars or activatable souls', () => {
    const r = advancePregameFlow('stars', 0, FRESH, eligibility([false, false], [false, false]));
    expect(r.kind).toBe('complete');
    expect(r.progress).toEqual({
      starsDone0: true, starsDone1: true, soulsDone0: true, soulsDone1: true,
    });
  });

  it('honours REG order — the selected first player acts first in both steps', () => {
    const stars = advancePregameFlow('stars', 1, FRESH, eligibility([true, true], [true, true]));
    expect(stars.kind === 'await' && stars.activeSeat).toBe(1);

    const bothStarsDone = { ...FRESH, starsDone0: true, starsDone1: true };
    const souls = advancePregameFlow('souls', 1, bothStarsDone, eligibility([true, true], [true, true]));
    expect(souls.kind === 'await' && souls.activeSeat).toBe(1);
  });

  it('moves to the second seat once the first finishes stars', () => {
    const after = markDone(FRESH, 'stars', 0);
    const r = advancePregameFlow('stars', 0, after, eligibility([true, true], [false, false]));
    expect(r.kind === 'await' && r.activeSeat).toBe(1);
  });

  it('completes from the souls step when both seats are done', () => {
    const done = { starsDone0: true, starsDone1: true, soulsDone0: true, soulsDone1: false };
    const r = advancePregameFlow('souls', 0, done, eligibility([false, false], [true, false]));
    expect(r.kind).toBe('complete');
    expect(r.progress.soulsDone1).toBe(true);
  });

  it('never re-opens a window a seat already finished', () => {
    const done = { ...FRESH, starsDone0: true };
    const r = advancePregameFlow('stars', 0, done, eligibility([true, false], [false, false]));
    expect(r.kind).toBe('await');
    if (r.kind !== 'await') return;
    expect(r.step).toBe('souls');
  });
});

describe('markDone', () => {
  it('sets only the addressed flag and does not mutate its input', () => {
    const next = markDone(FRESH, 'souls', 1);
    expect(next.soulsDone1).toBe(true);
    expect(next.soulsDone0).toBe(false);
    expect(FRESH.soulsDone1).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/timestes/projects/rtt-star-phase && npx vitest run spacetimedb/__tests__/pregameFlow.test.ts`
Expected: FAIL — `Failed to resolve import "../src/pregameFlow"`.

- [ ] **Step 3: Write the implementation**

Create `spacetimedb/src/pregameFlow.ts`:

```ts
/**
 * REG Pre-Game Phase sub-step transitions (star reveals, then Lost Soul
 * activation). Pure — no ctx, no DB — so the ordering rules are unit-testable
 * and the click path, the auto-skip path, and the idle-timeout path all share
 * one implementation and cannot diverge.
 *
 * REG order: the selected first player acts first in BOTH steps, then the
 * other seat. A seat with nothing to do is skipped server-side.
 */

export type Seat = 0 | 1;
export type PregameStep = 'stars' | 'souls';

export interface PregameProgress {
  starsDone0: boolean;
  starsDone1: boolean;
  soulsDone0: boolean;
  soulsDone1: boolean;
}

export interface PregameEligibility {
  /** Does this seat hold at least one star card in hand? */
  hasStarInHand(seat: Seat): boolean;
  /** Does this seat control at least one Lost Soul with ability text? */
  controlsActivatableSoul(seat: Seat): boolean;
}

export type PregameAdvance =
  | { kind: 'await'; step: PregameStep; activeSeat: Seat; progress: PregameProgress }
  | { kind: 'complete'; progress: PregameProgress };

function isDone(progress: PregameProgress, step: PregameStep, seat: Seat): boolean {
  if (step === 'stars') return seat === 0 ? progress.starsDone0 : progress.starsDone1;
  return seat === 0 ? progress.soulsDone0 : progress.soulsDone1;
}

export function markDone(
  progress: PregameProgress,
  step: PregameStep,
  seat: Seat,
): PregameProgress {
  if (step === 'stars') {
    return seat === 0
      ? { ...progress, starsDone0: true }
      : { ...progress, starsDone1: true };
  }
  return seat === 0
    ? { ...progress, soulsDone0: true }
    : { ...progress, soulsDone1: true };
}

export function advancePregameFlow(
  step: PregameStep,
  firstSeat: Seat,
  progress: PregameProgress,
  eligibility: PregameEligibility,
): PregameAdvance {
  const otherSeat: Seat = firstSeat === 0 ? 1 : 0;
  const order: Seat[] = [firstSeat, otherSeat];
  let next = progress;

  if (step === 'stars') {
    for (const seat of order) {
      if (isDone(next, 'stars', seat)) continue;
      if (eligibility.hasStarInHand(seat)) {
        return { kind: 'await', step: 'stars', activeSeat: seat, progress: next };
      }
      next = markDone(next, 'stars', seat); // auto-skip: nothing to reveal
    }
  }

  for (const seat of order) {
    if (isDone(next, 'souls', seat)) continue;
    if (eligibility.controlsActivatableSoul(seat)) {
      return { kind: 'await', step: 'souls', activeSeat: seat, progress: next };
    }
    next = markDone(next, 'souls', seat); // auto-skip: nothing to activate
  }

  return { kind: 'complete', progress: next };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/timestes/projects/rtt-star-phase && npx vitest run spacetimedb/__tests__/pregameFlow.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
cd /Users/timestes/projects/rtt-star-phase
git add spacetimedb/src/pregameFlow.ts spacetimedb/__tests__/pregameFlow.test.ts
git commit -m "feat(play): pure pre-game sub-phase transition logic"
```

---

### Task 5: Schema — three new tables

**Files:**
- Modify: `spacetimedb/src/schema.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `PregameState`, `PregameStar`, `PregameIdleTimeout` tables + `setPregameIdleTimeoutReducer`.

- [ ] **Step 1: Add the tables**

Insert before the `// Schema export` block near the end of `spacetimedb/src/schema.ts`:

```ts
// ---------------------------------------------------------------------------
// 17. PregameState — one row per game, live only during the REG Pre-Game
//     Phase sub-steps ('stars' / 'souls'). Row absent = pre-game complete.
//     Deliberately a separate table, NOT Game columns: adding a column would
//     change the game row's BSATN shape and break deployed clients' game
//     subscriptions during the publish window (cf. ForgeGame above).
//
//     The current step is NOT stored here — Game.pregamePhase is the single
//     source of truth for it. This table holds only whose window is open and
//     the per-seat progress flags.
// ---------------------------------------------------------------------------
export const PregameState = table(
  { name: 'pregame_state', public: true },
  {
    gameId: t.u64().primaryKey(),
    activeSeat: t.u64(),          // 0 or 1 — seat whose window is open
    starsDone0: t.bool(),
    starsDone1: t.bool(),
    soulsDone0: t.bool(),
    soulsDone1: t.bool(),
  }
);

// ---------------------------------------------------------------------------
// 18. PregameStar — one row per star card a player revealed, in the order they
//     chose to resolve them. Public: revealing is REG's cost for using a star
//     ability, so opponents and spectators must see the set. These rows (not
//     CardInstance.revealExpiresAt) back the opponent's view, because the
//     phase is untimed and the per-card reveal expires after 30s.
// ---------------------------------------------------------------------------
export const PregameStar = table(
  {
    name: 'pregame_star',
    public: true,
    indexes: [
      { accessor: 'pregame_star_game_id', algorithm: 'btree' as const, columns: ['gameId'] },
    ],
  },
  {
    id: t.u64().primaryKey().autoInc(),
    gameId: t.u64(),
    seat: t.u64(),
    cardInstanceId: t.u64(),
    slot: t.u64(),                // 0-based resolution order
    resolved: t.bool(),
  }
);

// ---------------------------------------------------------------------------
// 19. PregameIdleTimeout (scheduled table)
//     The Pre-Game Phase is deliberately untimed, so this is a long backstop
//     only: it force-completes the active seat's sub-step so an idle or
//     departed player cannot hang the game.
// ---------------------------------------------------------------------------

let _handlePregameIdleTimeout: any;
export const setPregameIdleTimeoutReducer = (reducer: any) => {
  _handlePregameIdleTimeout = reducer;
};

export const PregameIdleTimeout = table(
  {
    name: 'pregame_idle_timeout',
    public: true,
    scheduled: () => _handlePregameIdleTimeout,
    indexes: [
      { accessor: 'pregame_idle_timeout_game_id', algorithm: 'btree' as const, columns: ['gameId'] },
    ],
  },
  {
    scheduledId: t.u64().primaryKey().autoInc(),
    scheduledAt: t.scheduleAt(),
    gameId: t.u64(),
  }
);
```

- [ ] **Step 2: Register them in the schema export**

In the `const spacetimedb = schema({ ... })` call at the end of the file, add three entries after `CleanupSchedule`:

```ts
  CleanupSchedule,
  PregameState,
  PregameStar,
  PregameIdleTimeout,
});
```

- [ ] **Step 3: Update the `pregamePhase` comment**

At `spacetimedb/src/schema.ts:30`, change:

```ts
    pregamePhase: t.string(),     // "" | "rolling" | "choosing" | "revealing"
```

to:

```ts
    pregamePhase: t.string(),     // "" | "rolling" | "choosing" | "revealing" | "stars" | "souls"
                                  // 'stars'/'souls' run with status='playing' — see pregameFlow.ts
```

- [ ] **Step 4: Type-check**

Run: `cd /Users/timestes/projects/rtt-star-phase/spacetimedb && npx tsc --noEmit -p tsconfig.json`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
cd /Users/timestes/projects/rtt-star-phase
git add spacetimedb/src/schema.ts
git commit -m "feat(play): pre-game star phase tables"
```

---

### Task 6: Server — enter the star phase, advance it, finish it

**Files:**
- Modify: `spacetimedb/src/index.ts`

**Interfaces:**
- Consumes: `advancePregameFlow`, `markDone`, `PregameProgress`, `Seat` (Task 4); `PregameState`, `PregameStar`, `PregameIdleTimeout`, `setPregameIdleTimeoutReducer` (Task 5).
- Produces:
  - `isStarAbilityText(text: string): boolean` (module-local mirror)
  - `schedulePregameIdleTimeout(ctx: any, gameId: bigint): void`
  - `advancePregame(ctx: any, gameId: bigint): void`
  - `finishPregame(ctx: any, gameId: bigint): void`
  - `handle_pregame_idle_timeout` reducer

- [ ] **Step 1: Add imports and the star-text mirror**

At the top of `spacetimedb/src/index.ts`, extend the existing `./schema` import with `PregameState, PregameStar, PregameIdleTimeout, setPregameIdleTimeoutReducer`, and add:

```ts
import {
  advancePregameFlow,
  markDone,
  type PregameProgress,
  type PregameStep,
  type Seat,
} from './pregameFlow';
```

Next to `ABILITY_SOURCE_ZONES` (around `:37`), add:

```ts
// Star cards lead their special ability with "(Star)" or "STAR:". Mirrors
// lib/cards/starCards.ts — keep the two in sync. Read a CardInstance row's own
// specialAbility, never a card-index lookup.
//
// NOTE: Forge cards blank specialAbility on the public row (the leak spine in
// app/forge/lib/playSerialize.ts), so forge star cards are invisible here and
// the star step auto-skips for them. Known limitation, see the design doc.
const STAR_ABILITY_RE = /^\s*(\(star\)|star:)/i;
function isStarAbilityText(text: string): boolean {
  return STAR_ABILITY_RE.test(text ?? '');
}

const PREGAME_IDLE_MICROS = 180_000_000n; // 3 minutes
```

- [ ] **Step 2: Add the helpers below the existing `scheduleRevealTimeout`**

Insert after `scheduleRevealTimeout` (around `:1072`):

```ts
// Arm the pre-game idle backstop. Deletes any prior row for this game first —
// insert-only re-arming would accumulate rows and let a stale one fire 180s
// after a player's FIRST click, skipping a seat that acted seconds ago (the
// row carries only gameId, so stale and live rows are indistinguishable at
// fire time). Mirrors scheduleRevealTimeout.
function schedulePregameIdleTimeout(ctx: any, gameId: bigint): void {
  for (const timeout of ctx.db.PregameIdleTimeout.pregame_idle_timeout_game_id.filter(gameId)) {
    ctx.db.PregameIdleTimeout.scheduledId.delete(timeout.scheduledId);
  }
  ctx.db.PregameIdleTimeout.insert({
    scheduledId: 0n,
    scheduledAt: ScheduleAt.time(ctx.timestamp.microsSinceUnixEpoch + PREGAME_IDLE_MICROS),
    gameId,
  });
}

function seatHoldsStarInHand(ctx: any, gameId: bigint, seat: Seat): boolean {
  const player = [...ctx.db.Player.player_game_id.filter(gameId)]
    .find((p: any) => p.seat === BigInt(seat));
  if (!player) return false;
  for (const card of ctx.db.CardInstance.card_instance_game_id.filter(gameId)) {
    if (card.ownerId === player.id && card.zone === 'hand' && isStarAbilityText(card.specialAbility)) {
      return true;
    }
  }
  return false;
}

function seatControlsActivatableSoul(ctx: any, gameId: bigint, seat: Seat): boolean {
  const player = [...ctx.db.Player.player_game_id.filter(gameId)]
    .find((p: any) => p.seat === BigInt(seat));
  if (!player) return false;
  for (const card of ctx.db.CardInstance.card_instance_game_id.filter(gameId)) {
    if (
      card.ownerId === player.id &&
      card.zone === 'land-of-bondage' &&
      isLostSoulRow(card) &&
      (card.specialAbility ?? '') !== ''
    ) {
      return true;
    }
  }
  return false;
}

function readPregameProgress(state: any): PregameProgress {
  return {
    starsDone0: state.starsDone0,
    starsDone1: state.starsDone1,
    soulsDone0: state.soulsDone0,
    soulsDone1: state.soulsDone1,
  };
}

// The single place the pre-game cursor moves. Always re-reads the Game row —
// callers may hold a stale snapshot (cf. checkAndApplyWin). Writes
// Game.pregamePhase in lock-step with the progress flags, in this transaction.
function advancePregame(ctx: any, gameId: bigint): void {
  const game = ctx.db.Game.id.find(gameId);
  if (!game) return;
  const state = ctx.db.PregameState.gameId.find(gameId);
  if (!state) return;

  const step: PregameStep = game.pregamePhase === 'souls' ? 'souls' : 'stars';
  const firstSeat: Seat = game.currentTurn === 0n ? 0 : 1;

  const result = advancePregameFlow(step, firstSeat, readPregameProgress(state), {
    hasStarInHand: (seat) => seatHoldsStarInHand(ctx, gameId, seat),
    controlsActivatableSoul: (seat) => seatControlsActivatableSoul(ctx, gameId, seat),
  });

  if (result.kind === 'complete') {
    ctx.db.PregameState.gameId.update({
      ...state,
      ...result.progress,
    });
    finishPregame(ctx, gameId);
    return;
  }

  ctx.db.PregameState.gameId.update({
    ...state,
    ...result.progress,
    activeSeat: BigInt(result.activeSeat),
  });
  if (game.pregamePhase !== result.step) {
    const latest = ctx.db.Game.id.find(gameId);
    if (latest) ctx.db.Game.id.update({ ...latest, pregamePhase: result.step });
  }
  schedulePregameIdleTimeout(ctx, gameId);
}

// Ends the REG Pre-Game Phase and begins turn 1. Takes a gameId and re-reads,
// because advancePregame may have just written pregamePhase — a caller
// snapshot would revert it.
function finishPregame(ctx: any, gameId: bigint): void {
  const game = ctx.db.Game.id.find(gameId);
  if (!game) return;

  for (const row of ctx.db.PregameStar.pregame_star_game_id.filter(gameId)) {
    ctx.db.PregameStar.id.delete(row.id);
  }
  ctx.db.PregameState.gameId.delete(gameId);
  for (const timeout of ctx.db.PregameIdleTimeout.pregame_idle_timeout_game_id.filter(gameId)) {
    ctx.db.PregameIdleTimeout.scheduledId.delete(timeout.scheduledId);
  }

  const chosenSeat = game.currentTurn;
  let chosenName = 'Player ' + (Number(chosenSeat) + 1);
  let firstPlayerId = 0n;
  for (const p of [...ctx.db.Player.player_game_id.filter(gameId)]) {
    if (p.seat === chosenSeat) { chosenName = p.displayName; firstPlayerId = p.id; }
  }

  ctx.db.Game.id.update({
    ...game,
    pregamePhase: '',
    playingStartedAtMicros: ctx.timestamp.microsSinceUnixEpoch,
  });

  logAction(ctx, gameId, firstPlayerId, 'GAME_STARTED',
    JSON.stringify({ chosenSeat: chosenSeat.toString(), chosenName }),
    1n, 'draw');
}
```

If a helper named `isLostSoulRow` does not already exist in `index.ts`, search for the existing Lost Soul predicate (the codebase checks `cardType === 'LS' || cardType === 'Lost Soul' || cardName.toLowerCase().startsWith('lost soul')`) and reuse it by its actual name; if there is none, add that predicate as `isLostSoulRow` next to the other helpers.

- [ ] **Step 3: Rewire `startGameFromReveal` to enter the star phase**

`startGameFromReveal` (around `:1079`) currently sets `status: 'playing'`, `pregamePhase: ''`, `playingStartedAtMicros`, and logs `GAME_STARTED`. Change its `ctx.db.Game.id.update` call to set `pregamePhase: 'stars'` and leave `playingStartedAtMicros: 0n`, and **delete** its `logAction(... 'GAME_STARTED' ...)` call (it moves to `finishPregame`). Then append, before the function closes:

```ts
  ctx.db.PregameState.insert({
    gameId,
    activeSeat: chosenSeat,
    starsDone0: false,
    starsDone1: false,
    soulsDone0: false,
    soulsDone1: false,
  });

  logAction(ctx, gameId, winnerPlayerId, 'PREGAME_STAR_PHASE',
    JSON.stringify({ firstSeat: chosenSeat.toString() }), 1n, 'draw');

  // Cascades through both auto-skips; may complete the pre-game outright when
  // neither player has a star card or an ability-bearing Lost Soul.
  advancePregame(ctx, gameId);
```

Keep every other line of the function — `status: 'playing'`, `currentPhase: 'draw'`, `turnNumber: 1n`, `pregameReady0/1: true`, and the Paragon `initializeSoulDeck` fallback — exactly as they are.

- [ ] **Step 4: Add the idle-timeout reducer and wire it**

Add near the other scheduled handlers (after `handle_reveal_timeout`):

```ts
// ---------------------------------------------------------------------------
// Scheduled reducer: handle_pregame_idle_timeout
// The Pre-Game Phase is untimed by design; this only stops an idle or departed
// player from hanging the game. Force-completes the active seat's sub-step.
// ---------------------------------------------------------------------------
export const handle_pregame_idle_timeout = spacetimedb.reducer(
  { arg: PregameIdleTimeout.rowType },
  (ctx, { arg }) => {
    const game = ctx.db.Game.id.find(arg.gameId);
    if (!game) return;
    if (game.status !== 'playing') return;
    if (game.pregamePhase !== 'stars' && game.pregamePhase !== 'souls') return;

    const state = ctx.db.PregameState.gameId.find(arg.gameId);
    if (!state) return;

    const step: PregameStep = game.pregamePhase === 'souls' ? 'souls' : 'stars';
    const seat: Seat = state.activeSeat === 0n ? 0 : 1;

    ctx.db.PregameState.gameId.update({
      ...state,
      ...markDone(readPregameProgress(state), step, seat),
    });

    logAction(ctx, arg.gameId, 0n, 'PREGAME_IDLE_SKIP',
      JSON.stringify({ seat: seat.toString(), step }), game.turnNumber, game.currentPhase);

    advancePregame(ctx, arg.gameId);
  }
);
setPregameIdleTimeoutReducer(handle_pregame_idle_timeout);
```

The `setPregameIdleTimeoutReducer` call is required — without it the scheduled binding resolves to `undefined` and the backstop silently never fires. Compare `setRevealTimeoutReducer(handle_reveal_timeout)` around `:2019`.

- [ ] **Step 5: Type-check**

Run: `cd /Users/timestes/projects/rtt-star-phase/spacetimedb && npx tsc --noEmit -p tsconfig.json`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
cd /Users/timestes/projects/rtt-star-phase
git add spacetimedb/src/index.ts
git commit -m "feat(play): enter, advance, and finish the pre-game star phase"
```

---

### Task 7: Server — the three player-facing reducers

**Files:**
- Modify: `spacetimedb/src/index.ts`

**Interfaces:**
- Consumes: everything from Task 6.
- Produces: reducers `pregame_submit_stars`, `pregame_resolve_star`, `pregame_finish_souls`.

- [ ] **Step 1: Add a shared guard**

Add above the new reducers:

```ts
// Shared validation for the REG Pre-Game Phase sub-steps. Returns the acting
// player, whose seat must be the one whose window is open.
function assertPregameActor(ctx: any, gameId: bigint, expectedPhase: PregameStep) {
  const game = ctx.db.Game.id.find(gameId);
  if (!game) throw new SenderError('Game not found');
  if (game.status !== 'playing') throw new SenderError('Game is not in playing state');
  if (game.pregamePhase !== expectedPhase) {
    throw new SenderError('Not in the ' + expectedPhase + ' phase');
  }
  const state = ctx.db.PregameState.gameId.find(gameId);
  if (!state) throw new SenderError('Pre-game state not found');
  const player = findPlayerBySender(ctx, gameId);
  if (player.seat !== state.activeSeat) throw new SenderError('Not your pre-game window');
  return { game, state, player };
}
```

- [ ] **Step 2: Add `pregame_submit_stars`**

```ts
// ---------------------------------------------------------------------------
// Reducer: pregame_submit_stars
// REG: "players may reveal any number of star cards from their hand to use the
// star ability." The whole set is revealed at once, then resolved one at a
// time in the order chosen. An empty list is the explicit "no stars" answer.
// ---------------------------------------------------------------------------
const MAX_PREGAME_STARS = 16; // hand limit — no legal submission exceeds it

export const pregame_submit_stars = spacetimedb.reducer(
  { gameId: t.u64(), cardInstanceIds: t.string() },
  (ctx, { gameId, cardInstanceIds }) => {
    const { state, player } = assertPregameActor(ctx, gameId, 'stars');

    const already = [...ctx.db.PregameStar.pregame_star_game_id.filter(gameId)]
      .filter((r: any) => r.seat === player.seat);
    if (already.length > 0) throw new SenderError('Stars already submitted');

    let ids: string[];
    try {
      const parsed = JSON.parse(cardInstanceIds);
      if (!Array.isArray(parsed)) throw new Error('not an array');
      ids = parsed.map((v: any) => String(v));
    } catch {
      throw new SenderError('Invalid star selection');
    }
    if (ids.length > MAX_PREGAME_STARS) throw new SenderError('Too many stars selected');
    if (new Set(ids).size !== ids.length) throw new SenderError('Duplicate star selected');

    const names: string[] = [];
    for (let i = 0; i < ids.length; i++) {
      let instanceId: bigint;
      try {
        instanceId = BigInt(ids[i]);
      } catch {
        throw new SenderError('Invalid star selection');
      }
      const card = ctx.db.CardInstance.id.find(instanceId);
      if (!card) throw new SenderError('Card not found');
      if (card.gameId !== gameId) throw new SenderError('Card not in this game');
      if (card.ownerId !== player.id) throw new SenderError('Not your card');
      if (card.zone !== 'hand') throw new SenderError('Star cards must be revealed from hand');
      if (!isStarAbilityText(card.specialAbility)) throw new SenderError('Not a star card');

      ctx.db.PregameStar.insert({
        id: 0n,
        gameId,
        seat: player.seat,
        cardInstanceId: instanceId,
        slot: BigInt(i),
        resolved: false,
      });

      // Also flag the card with the standard hand reveal so it lights up in the
      // normal treatment. The opponent's authoritative view is the PregameStar
      // rows above — this 30s flag is allowed to expire mid-phase.
      ctx.db.CardInstance.id.update({
        ...card,
        revealExpiresAt: ctx.timestamp.microsSinceUnixEpoch + 30_000_000n,
        revealStartedAt: ctx.timestamp.microsSinceUnixEpoch,
      });
      names.push(card.cardName);
    }

    if (ids.length === 0) {
      ctx.db.PregameState.gameId.update({
        ...state,
        ...markDone(readPregameProgress(state), 'stars', state.activeSeat === 0n ? 0 : 1),
      });
      logAction(ctx, gameId, player.id, 'PREGAME_STARS_NONE',
        JSON.stringify({ seat: player.seat.toString() }), 1n, 'draw');
      advancePregame(ctx, gameId);
      return;
    }

    logAction(ctx, gameId, player.id, 'PREGAME_STARS_REVEALED',
      JSON.stringify({ seat: player.seat.toString(), names }), 1n, 'draw');
    schedulePregameIdleTimeout(ctx, gameId);
  }
);
```

Check the exact field names for the per-card reveal against the `reveal_card_in_hand` reducer (around `:6485`) before writing the `CardInstance` update — use whatever that reducer sets, verbatim.

- [ ] **Step 3: Add `pregame_resolve_star`**

```ts
// ---------------------------------------------------------------------------
// Reducer: pregame_resolve_star
// Stars resolve in the order the player chose. Order is enforced here, not
// merely presented in the UI.
// ---------------------------------------------------------------------------
export const pregame_resolve_star = spacetimedb.reducer(
  { gameId: t.u64(), starId: t.u64() },
  (ctx, { gameId, starId }) => {
    const { state, player } = assertPregameActor(ctx, gameId, 'stars');

    const mine = [...ctx.db.PregameStar.pregame_star_game_id.filter(gameId)]
      .filter((r: any) => r.seat === player.seat && !r.resolved)
      .sort((a: any, b: any) => (a.slot < b.slot ? -1 : a.slot > b.slot ? 1 : 0));
    if (mine.length === 0) throw new SenderError('No stars left to resolve');

    const target = mine[0];
    if (target.id !== starId) throw new SenderError('Stars must resolve in the chosen order');

    ctx.db.PregameStar.id.update({ ...target, resolved: true });

    const card = ctx.db.CardInstance.id.find(target.cardInstanceId);
    logAction(ctx, gameId, player.id, 'PREGAME_STAR_RESOLVED',
      JSON.stringify({ seat: player.seat.toString(), name: card ? card.cardName : '' }),
      1n, 'draw');

    if (mine.length === 1) {
      ctx.db.PregameState.gameId.update({
        ...state,
        ...markDone(readPregameProgress(state), 'stars', state.activeSeat === 0n ? 0 : 1),
      });
      advancePregame(ctx, gameId);
      return;
    }
    schedulePregameIdleTimeout(ctx, gameId);
  }
);
```

- [ ] **Step 4: Add `pregame_finish_souls`**

```ts
// ---------------------------------------------------------------------------
// Reducer: pregame_finish_souls
// REG step 3 — a single acknowledgement per player. Activation itself happens
// through the normal right-click menu ('land-of-bondage' is already an ability
// source zone); this only closes the window.
// ---------------------------------------------------------------------------
export const pregame_finish_souls = spacetimedb.reducer(
  { gameId: t.u64() },
  (ctx, { gameId }) => {
    const { state, player } = assertPregameActor(ctx, gameId, 'souls');

    ctx.db.PregameState.gameId.update({
      ...state,
      ...markDone(readPregameProgress(state), 'souls', state.activeSeat === 0n ? 0 : 1),
    });

    logAction(ctx, gameId, player.id, 'PREGAME_SOULS_DONE',
      JSON.stringify({ seat: player.seat.toString() }), 1n, 'draw');

    advancePregame(ctx, gameId);
  }
);
```

- [ ] **Step 5: Type-check**

Run: `cd /Users/timestes/projects/rtt-star-phase/spacetimedb && npx tsc --noEmit -p tsconfig.json`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
cd /Users/timestes/projects/rtt-star-phase
git add spacetimedb/src/index.ts
git commit -m "feat(play): pregame star submit/resolve and soul acknowledgement reducers"
```

---

### Task 8: Server — gate turn machinery and reap orphan rows

**Files:**
- Modify: `spacetimedb/src/index.ts` (`set_phase` ~`:2119`, `end_turn` ~`:2171`, `resign_game` ~`:1838`, `handle_disconnect_timeout` ~`:1926`, `cleanup_stale_games` ~`:2088`)

**Interfaces:**
- Consumes: Task 6 helpers.
- Produces: `clearPregameRows(ctx: any, gameId: bigint): void`.

The game is `status: 'playing'` during the pre-game, so `end_turn` and `set_phase` would otherwise be callable before turn 1 begins.

- [ ] **Step 1: Block the turn reducers during the pre-game**

In **both** `set_phase` and `end_turn`, immediately after the existing `status !== 'playing'` check, add:

```ts
    if (game.pregamePhase !== '') {
      throw new SenderError('The Pre-Game Phase is still in progress');
    }
```

- [ ] **Step 2: Add the row reaper**

Next to the other pre-game helpers:

```ts
// Games are never deleted — the concede paths only set status:'finished' — so
// finishPregame never runs for an abandoned pre-game. All three pre-game
// tables are public, so orphan rows would sit in every client's table cache.
function clearPregameRows(ctx: any, gameId: bigint): void {
  for (const row of ctx.db.PregameStar.pregame_star_game_id.filter(gameId)) {
    ctx.db.PregameStar.id.delete(row.id);
  }
  ctx.db.PregameState.gameId.delete(gameId);
  for (const timeout of ctx.db.PregameIdleTimeout.pregame_idle_timeout_game_id.filter(gameId)) {
    ctx.db.PregameIdleTimeout.scheduledId.delete(timeout.scheduledId);
  }
}
```

- [ ] **Step 3: Call it on every path that ends a game**

Add `clearPregameRows(ctx, gameId);` immediately before or after the `status: 'finished'` update in `resign_game` and in `handle_disconnect_timeout`. In `cleanup_stale_games`, add it alongside the existing `CardInstance` deletion loop, using that loop's game-id variable.

- [ ] **Step 4: Verify every finish path is covered**

Run: `cd /Users/timestes/projects/rtt-star-phase && rg -n "status: 'finished'" spacetimedb/src/index.ts`
For each hit, confirm it either calls `clearPregameRows` or is unreachable during a pre-game (e.g. a win-condition path that requires turn ≥ 1). Note the reasoning for any you skip in the commit message.

- [ ] **Step 5: Type-check and commit**

Run: `cd /Users/timestes/projects/rtt-star-phase/spacetimedb && npx tsc --noEmit -p tsconfig.json`
Expected: no errors.

```bash
cd /Users/timestes/projects/rtt-star-phase
git add spacetimedb/src/index.ts
git commit -m "feat(play): gate turn reducers during pre-game and reap its rows"
```

---

### Task 9: Publish to dev and regenerate bindings

**Files:**
- Modify: `lib/spacetimedb/module_bindings/**` (generated — do not hand-edit)

**Interfaces:**
- Consumes: Tasks 5-8.
- Produces: `tables.PregameState`, `tables.PregameStar`, and the three new reducers in the generated client bindings.

- [ ] **Step 1: Publish to the dev module**

```bash
cd /Users/timestes/projects/rtt-star-phase
echo "y" | spacetime publish redemption-multiplayer-dev --module-path "$(pwd)/spacetimedb" --no-config --server maincloud
```

Expected: `Updated database with name: redemption-multiplayer-dev`.

**Never publish `redemption-multiplayer`** (production).

If publish fails with a schema error, the new tables need a clear:

```bash
echo "y" | spacetime publish redemption-multiplayer-dev --clear-database -y --module-path "$(pwd)/spacetimedb" --no-config --server maincloud
```

**A `--clear` wipes `forge_config` and breaks Forge playtest seat auth.** Immediately re-seed it by calling `set_forge_server_identity` and verify with `spacetime sql redemption-multiplayer-dev "SELECT * FROM forge_config"` — do not leave this step for later.

- [ ] **Step 2: Verify the module is live, not just published**

```bash
spacetime sql redemption-multiplayer-dev "SELECT * FROM pregame_state"
```

Expected: an empty result set with column headers — **not** a "no such table" error and not a panic. A publish that succeeds but panics on client connect is the known incremental-publish index gotcha; if that happens, use the `--clear` path above.

- [ ] **Step 3: Regenerate the client bindings**

```bash
cd /Users/timestes/projects/rtt-star-phase
spacetime generate --lang typescript --out-dir "$(pwd)/lib/spacetimedb/module_bindings" --project-path "$(pwd)/spacetimedb"
```

- [ ] **Step 4: Confirm the new surface exists**

```bash
cd /Users/timestes/projects/rtt-star-phase
rg -l "pregame_state|pregameState" lib/spacetimedb/module_bindings/ | head
rg -n "pregameSubmitStars|pregameResolveStar|pregameFinishSouls" lib/spacetimedb/module_bindings/index.ts
```

Expected: table files for both new state tables, and all three reducer names present.

- [ ] **Step 5: Commit**

```bash
cd /Users/timestes/projects/rtt-star-phase
git add lib/spacetimedb/module_bindings
git commit -m "chore(play): regenerate bindings for pre-game star phase"
```

---

### Task 10: Client data wiring

**Files:**
- Modify: `app/play/hooks/useGameState.ts`

**Interfaces:**
- Consumes: Task 9 bindings.
- Produces on the `useGameState` return value:
  - `pregameState: { activeSeat: bigint; starsDone0: boolean; starsDone1: boolean; soulsDone0: boolean; soulsDone1: boolean } | null`
  - `pregameStars: Array<{ id: bigint; seat: bigint; cardInstanceId: bigint; slot: bigint; resolved: boolean }>`
  - `pregameSubmitStars: (cardInstanceIds: bigint[]) => void`
  - `pregameResolveStar: (starId: bigint) => void`
  - `pregameFinishSouls: () => void`

- [ ] **Step 1: Subscribe in the player block**

In the player subscription block (around `:195-236`), alongside the existing `tables.CardInstance` subscription, add:

```ts
  const [pregameStateRows] = useTable(tables.PregameState.where((r) => r.gameId.eq(gameId)));
  const [pregameStarRows] = useTable(tables.PregameStar.where((r) => r.gameId.eq(gameId)));
```

The `.where` must be on the hook, not only in subscription SQL — otherwise stale rows leak from the shared refcounted cache.

- [ ] **Step 2: Mirror it in the spectator block**

The spectator block around `:1098-1123` carries the comment "mirror every subscription in useGameState". Add the same two `useTable` calls there, using that block's `gameId` variable, and expose them on the spectator return value under the same names. Skipping this leaves the spectator rail permanently empty.

- [ ] **Step 3: Add the reducer wrappers**

Next to `pregameChooseFirst` / `pregameAcknowledgeFirst` (around `:802-808`):

```ts
  const pregameSubmitStars = useCallback((cardInstanceIds: bigint[]) => {
    conn?.reducers.pregameSubmitStars({
      gameId,
      cardInstanceIds: JSON.stringify(cardInstanceIds.map((id) => id.toString())),
    });
  }, [conn, gameId]);

  const pregameResolveStar = useCallback((starId: bigint) => {
    conn?.reducers.pregameResolveStar({ gameId, starId });
  }, [conn, gameId]);

  const pregameFinishSouls = useCallback(() => {
    conn?.reducers.pregameFinishSouls({ gameId });
  }, [conn, gameId]);
```

BigInt values must be stringified before `JSON.stringify` — serializing a raw BigInt throws.

- [ ] **Step 4: Export everything**

Add `pregameState`, `pregameStars`, `pregameSubmitStars`, `pregameResolveStar`, `pregameFinishSouls` to the hook's TypeScript interface (near `:143`) and to its return object (near `:1040`). Derive `pregameState` as `pregameStateRows[0] ?? null` and `pregameStars` as the rows sorted by `slot`.

- [ ] **Step 5: Type-check and commit**

Run: `cd /Users/timestes/projects/rtt-star-phase && npx tsc --noEmit`
Expected: no errors.

```bash
cd /Users/timestes/projects/rtt-star-phase
git add app/play/hooks/useGameState.ts
git commit -m "feat(play): subscribe to pre-game star state and expose its reducers"
```

---

### Task 11: `TurnIndicator` pre-game header

**Files:**
- Modify: `app/play/components/TurnIndicator.tsx`

**Interfaces:**
- Consumes: nothing.
- Produces: new optional prop `pregameStep?: 'stars' | 'souls'`.

- [ ] **Step 1: Add the prop**

In `TurnIndicatorProps` (around `:113`):

```ts
  /** When set, the phase row is replaced by the REG Pre-Game Phase treatment.
   *  'stars' = star reveals, 'souls' = Lost Soul activation. Undefined during
   *  normal play. */
  pregameStep?: 'stars' | 'souls';
```

Destructure it in the component signature with no default.

- [ ] **Step 2: Add the pre-game chip list and drive the pill from an `activeKey`**

Above the component, next to `PHASE_LABELS`:

```ts
// REG Pre-Game Phase sub-steps. Kept separate from PHASE_ORDER/PHASE_LABELS so
// the normal turn phases are untouched.
const PREGAME_STEPS = ['stars', 'souls'] as const;
const PREGAME_LABELS: Record<string, string> = {
  stars: 'Stars',
  souls: 'Lost Souls',
};
```

Inside the component, after `currentPhase` is computed:

```ts
  // The sliding pill measures whichever row is rendered. During the pre-game
  // that's the two-chip row, otherwise the five-phase row.
  const activeKey: string = pregameStep ?? currentPhase;
```

Then replace `currentPhase` with `activeKey` in **both** measurement effects (the `useLayoutEffect` at `:243-249` and the resize/font `useEffect` at `:251-270`), including their dependency arrays. Leave every other use of `currentPhase` alone.

- [ ] **Step 3: Render the pre-game row**

Wrap the existing `PHASE_ORDER.map(...)` block (around `:638-679`) so the pre-game row renders instead when `pregameStep` is set. Keep the sliding pill and underline elements above it exactly as they are — they read `activeBounds` and need no change.

```tsx
          {pregameStep ? (
            <>
              <span
                style={{
                  position: 'absolute',
                  top: -2,
                  left: '50%',
                  transform: 'translateX(-50%)',
                  fontFamily: 'var(--font-cinzel), Georgia, serif',
                  fontSize: FZ.caption,
                  letterSpacing: '0.12em',
                  textTransform: 'uppercase',
                  color: 'rgba(232, 213, 163, 0.55)',
                  whiteSpace: 'nowrap',
                  pointerEvents: 'none',
                }}
              >
                Pre-Game Phase
              </span>
              {PREGAME_STEPS.map((step) => {
                const isActive = step === pregameStep;
                return (
                  <span
                    key={step}
                    ref={(el) => { buttonRefs.current[step] = el as any; }}
                    style={{
                      position: 'relative',
                      padding: '4px 10px',
                      marginTop: 8,
                      fontFamily: 'var(--font-cinzel), Georgia, serif',
                      fontSize: FZ.ui,
                      letterSpacing: '0.07em',
                      textTransform: 'uppercase',
                      color: isActive ? '#e8d5a3' : 'rgba(232, 213, 163, 0.35)',
                      transition: 'color 0.24s ease-out',
                      whiteSpace: 'nowrap',
                      zIndex: 1,
                    }}
                  >
                    {PREGAME_LABELS[step]}
                  </span>
                );
              })}
            </>
          ) : (
            PHASE_ORDER.map((phase) => {
              /* ...existing button code, unchanged... */
            })
          )}
```

If the label plus chip row does not fit the fixed 48px bar (`client.tsx:1443`), drop the `marginTop: 8` and render a single line reading `Pre-Game · Stars` rather than growing the bar.

- [ ] **Step 4: Hide the turn controls during the pre-game**

Wrap the next-phase arrow button (around `:683-702`) and the End Turn button (around `:705`) so neither renders when `pregameStep` is set — e.g. change the End Turn guard from `{!readOnly && <button` to `{!readOnly && !pregameStep && <button`, and wrap the arrow in `{!pregameStep && (...)}`. They are already inert, but leaving them visible is a false affordance.

- [ ] **Step 5: Type-check and commit**

Run: `cd /Users/timestes/projects/rtt-star-phase && npx tsc --noEmit`
Expected: no errors.

```bash
cd /Users/timestes/projects/rtt-star-phase
git add app/play/components/TurnIndicator.tsx
git commit -m "feat(play): PRE-GAME PHASE header treatment"
```

---

### Task 12: `PregameRail` component

**Files:**
- Create: `app/play/components/PregameRail.tsx`

**Interfaces:**
- Consumes: `getEffectiveAbilities`, `abilityLabel`, `DEFAULT_ABILITY_SOURCE_ZONES` from `@/lib/cards/cardAbilities`; `isStarAbilityText` from `@/lib/cards/starCards`.
- Produces: default-exported `PregameRail` taking:

```ts
interface PregameRailProps {
  step: 'stars' | 'souls';
  isMyWindow: boolean;
  opponentName: string;
  /** Star cards in my hand, for the selection chips. */
  handStars: Array<{ instanceId: bigint; cardName: string; specialAbility: string; imitatingName?: string }>;
  /** Submitted stars for the active seat, ascending by slot. */
  queue: Array<{ starId: bigint; cardInstanceId: bigint; resolved: boolean; cardName: string; specialAbility: string; imitatingName?: string }>;
  /** Lost Souls I control that carry ability text. */
  activatableSouls: Array<{ instanceId: bigint; cardName: string }>;
  /** True when I have submitted my star selection this window. */
  hasSubmitted: boolean;
  autoRouteLostSouls: boolean;
  onSubmitStars: (ids: bigint[]) => void;
  onResolveStar: (starId: bigint) => void;
  onFinishSouls: () => void;
  onExecuteAbility: (instanceId: bigint, abilityIndex: number) => void;
  onHighlightCard: (instanceId: bigint) => void;
}
```

**Critical:** ability buttons must **map the unfiltered** `getEffectiveAbilities` array and *disable* out-of-zone entries — never `.filter()` then `.map()`. Both the client dispatcher and the server's `execute_card_ability` index the full list, so filtering first dispatches the wrong ability. This mirrors `CardContextMenu.tsx:267-345`.

- [ ] **Step 1: Write the component**

Create `app/play/components/PregameRail.tsx`:

```tsx
'use client';

import { useState } from 'react';
import {
  getEffectiveAbilities,
  abilityLabel,
  DEFAULT_ABILITY_SOURCE_ZONES,
} from '@/lib/cards/cardAbilities';

// Sits below ZoneBrowseModal's overlay (z 500) so a deck/reserve browse opened
// from a star ability is never covered, and above the canvas. BattleResolutionUI
// uses 600, which would float over that modal — deliberately not copied.
const RAIL_Z = 450;

const PANEL: React.CSSProperties = {
  pointerEvents: 'auto',
  background: 'rgba(10, 8, 5, 0.94)',
  border: '1px solid rgba(196, 149, 90, 0.45)',
  borderRadius: 6,
  boxShadow: '0 6px 20px rgba(0, 0, 0, 0.6)',
  color: '#e8d5a3',
  fontFamily: 'var(--font-cinzel), Georgia, serif',
  padding: '10px 12px',
  maxWidth: 'min(560px, 46vw)',
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
};

const CHIP = (selected: boolean): React.CSSProperties => ({
  pointerEvents: 'auto',
  cursor: 'pointer',
  padding: '3px 8px',
  borderRadius: 12,
  fontSize: 11,
  whiteSpace: 'nowrap',
  border: `1px solid ${selected ? '#c4955a' : 'rgba(196, 149, 90, 0.35)'}`,
  background: selected ? 'rgba(196, 149, 90, 0.22)' : 'transparent',
  color: selected ? '#e8d5a3' : 'rgba(232, 213, 163, 0.6)',
});

const ACTION: React.CSSProperties = {
  pointerEvents: 'auto',
  cursor: 'pointer',
  padding: '5px 12px',
  borderRadius: 4,
  fontSize: 11,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  border: '1px solid #c4955a',
  background: 'rgba(196, 149, 90, 0.18)',
  color: '#e8d5a3',
};

export default function PregameRail({
  step, isMyWindow, opponentName, handStars, queue, activatableSouls,
  hasSubmitted, autoRouteLostSouls,
  onSubmitStars, onResolveStar, onFinishSouls, onExecuteAbility, onHighlightCard,
}: PregameRailProps) {
  const [selection, setSelection] = useState<bigint[]>([]);

  const toggle = (id: bigint) =>
    setSelection((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );

  // The whole wrapper is click-through; only chips and buttons opt back in.
  // Konva hit-tests on its own canvas, so this never blocks board interaction.
  const wrapper = (children: React.ReactNode) => (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: RAIL_Z }}>
      <div style={{ position: 'absolute', left: 12, bottom: 12, ...PANEL }}>{children}</div>
    </div>
  );

  const heading = (text: string) => (
    <div style={{ fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase',
                  color: 'rgba(232, 213, 163, 0.55)' }}>
      {text}
    </div>
  );

  if (!isMyWindow) {
    return wrapper(
      <>
        {heading('Pre-Game Phase')}
        <div style={{ fontSize: 12 }}>
          {step === 'stars'
            ? `Waiting for ${opponentName} to reveal stars…`
            : `Waiting for ${opponentName} to activate Lost Souls…`}
        </div>
        {queue.length > 0 && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {queue.map((s) => (
              <span key={s.starId.toString()} style={CHIP(!s.resolved)}>
                {s.resolved ? '✓ ' : ''}{s.cardName}
              </span>
            ))}
          </div>
        )}
      </>,
    );
  }

  if (step === 'souls') {
    return wrapper(
      <>
        {heading('Pre-Game Phase · Lost Souls')}
        {activatableSouls.length === 0 ? (
          <div style={{ fontSize: 12 }}>
            {autoRouteLostSouls
              ? 'No Lost Souls with abilities to activate.'
              : 'Auto-routing is off — any Lost Souls you drew are still in your hand.'}
          </div>
        ) : (
          <>
            <div style={{ fontSize: 12 }}>
              Activate abilities on the Lost Souls you control, then finish.
              Right-click a soul for its abilities.
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {activatableSouls.map((s) => (
                <span key={s.instanceId.toString()} style={CHIP(false)}
                      onClick={() => onHighlightCard(s.instanceId)}>
                  {s.cardName}
                </span>
              ))}
            </div>
          </>
        )}
        <button style={ACTION} onClick={onFinishSouls}>Done</button>
      </>,
    );
  }

  if (!hasSubmitted) {
    return wrapper(
      <>
        {heading('Pre-Game Phase · Stars')}
        {handStars.length === 0 ? (
          <div style={{ fontSize: 12 }}>No star cards in hand.</div>
        ) : (
          <>
            <div style={{ fontSize: 12 }}>
              Choose the star cards to reveal. They resolve in the order you pick them.
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', overflowX: 'auto' }}>
              {handStars.map((c) => {
                const order = selection.indexOf(c.instanceId);
                return (
                  <span key={c.instanceId.toString()} style={CHIP(order >= 0)}
                        onClick={() => toggle(c.instanceId)}>
                    {order >= 0 ? `${order + 1}. ` : ''}{c.cardName}
                  </span>
                );
              })}
            </div>
          </>
        )}
        <div style={{ display: 'flex', gap: 8 }}>
          {selection.length > 0 && (
            <button style={ACTION} onClick={() => onSubmitStars(selection)}>
              Reveal {selection.length} star{selection.length === 1 ? '' : 's'}
            </button>
          )}
          <button style={ACTION} onClick={() => onSubmitStars([])}>No stars</button>
        </div>
      </>,
    );
  }

  const current = queue.find((s) => !s.resolved);
  if (!current) return wrapper(<>{heading('Pre-Game Phase · Stars')}<div style={{ fontSize: 12 }}>Resolving…</div></>);

  // Map the UNFILTERED ability list and disable out-of-zone entries. Both the
  // client dispatcher and the server index the full array, so filtering first
  // would dispatch the wrong ability. Mirrors CardContextMenu.
  const abilities = getEffectiveAbilities({
    cardName: current.cardName,
    imitatingName: current.imitatingName,
  });

  return wrapper(
    <>
      {heading('Pre-Game Phase · Stars')}
      <div style={{ fontSize: 13, color: '#e8d5a3' }}>{current.cardName}</div>
      <div style={{ fontSize: 11, color: 'rgba(232, 213, 163, 0.75)', lineHeight: 1.4 }}>
        {current.specialAbility}
      </div>
      {abilities.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {abilities.map((ability, index) => {
            const allowed = ability.sourceZones ?? DEFAULT_ABILITY_SOURCE_ZONES;
            const disabled = !allowed.includes('hand');
            return (
              <button
                key={index}
                disabled={disabled}
                title={disabled ? 'This ability cannot be used from hand' : undefined}
                style={{ ...ACTION, opacity: disabled ? 0.4 : 1,
                         cursor: disabled ? 'not-allowed' : 'pointer' }}
                onClick={() => !disabled && onExecuteAbility(current.cardInstanceId, index)}
              >
                {abilityLabel(ability)}
              </button>
            );
          })}
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <button style={ACTION} onClick={() => onResolveStar(current.starId)}>Resolved →</button>
        <span style={{ fontSize: 10, color: 'rgba(232, 213, 163, 0.5)' }}>
          {queue.filter((s) => s.resolved).length + 1} of {queue.length}
        </span>
      </div>
    </>,
  );
}
```

Move the `PregameRailProps` interface above the component. If `abilityLabel` is not an exported name in `lib/cards/cardAbilities.ts`, use whatever `CardContextMenu.tsx` imports for the same purpose.

- [ ] **Step 2: Type-check**

Run: `cd /Users/timestes/projects/rtt-star-phase && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd /Users/timestes/projects/rtt-star-phase
git add app/play/components/PregameRail.tsx
git commit -m "feat(play): non-blocking pre-game star/soul rail"
```

---

### Task 13: Mount the rail and wire the header

**Files:**
- Modify: `app/play/components/MultiplayerCanvas.tsx`
- Modify: `app/play/[code]/client.tsx`
- Modify: `app/play/spectate/[code]/client.tsx`

**Interfaces:**
- Consumes: Tasks 10-12.
- Produces: the rail rendered during `pregamePhase === 'stars' | 'souls'`, and `pregameStep` reaching `TurnIndicator`.

- [ ] **Step 1: Mount the rail in `MultiplayerCanvas`**

Import `PregameRail` alongside the existing `BattleResolutionUI` import (`:68`) and `isStarAbilityText` from `@/lib/cards/starCards`. Next to the `BattleResolutionUI` mount (around `:8417`), add:

```tsx
      {/* REG Pre-Game Phase rail (star reveals, then Lost Soul activation).
          Mounted here, not client.tsx, because it needs canvas geometry — the
          same reason BattleResolutionUI lives here. Wrapper is
          pointer-events:none so the board stays fully interactive. */}
      {pregameStep && !isSpectator && (
        <PregameRail
          step={pregameStep}
          isMyWindow={myPregameWindow}
          opponentName={gameState.opponentPlayer?.displayName || 'Opponent'}
          handStars={myHandStars}
          queue={activeStarQueue}
          activatableSouls={myActivatableSouls}
          hasSubmitted={myStarsSubmitted}
          autoRouteLostSouls={gameState.myPlayer?.autoRouteLostSouls ?? true}
          onSubmitStars={gameState.pregameSubmitStars}
          onResolveStar={gameState.pregameResolveStar}
          onFinishSouls={gameState.pregameFinishSouls}
          onExecuteAbility={(instanceId, abilityIndex) =>
            gameState.executeCardAbility(instanceId, abilityIndex)}
          onHighlightCard={(instanceId) => setHighlightedCardId(instanceId)}
        />
      )}
```

Derive the values above it, near the other `gameState`-derived memos:

```tsx
  const pregameStep: 'stars' | 'souls' | undefined =
    gameState.game?.pregamePhase === 'stars' ? 'stars'
    : gameState.game?.pregamePhase === 'souls' ? 'souls'
    : undefined;

  const myPregameWindow =
    !!gameState.pregameState && !!gameState.myPlayer &&
    gameState.pregameState.activeSeat === gameState.myPlayer.seat;

  const myHandStars = useMemo(() => (myCards['hand'] ?? [])
    .filter((c: any) => isStarAbilityText(c.specialAbility))
    .map((c: any) => ({
      instanceId: BigInt(c.instanceId), cardName: c.cardName,
      specialAbility: c.specialAbility, imitatingName: c.imitatingName,
    })), [myCards]);

  const myActivatableSouls = useMemo(() => (myCards['land-of-bondage'] ?? [])
    .filter((c: any) => (c.specialAbility ?? '') !== '')
    .map((c: any) => ({ instanceId: BigInt(c.instanceId), cardName: c.cardName })),
    [myCards]);

  const activeStarQueue = useMemo(() => {
    const seat = gameState.pregameState?.activeSeat;
    if (seat === undefined) return [];
    return (gameState.pregameStars ?? [])
      .filter((s: any) => s.seat === seat)
      .map((s: any) => {
        const card = findAnyCardById(s.cardInstanceId);
        return {
          starId: s.id, cardInstanceId: s.cardInstanceId, resolved: s.resolved,
          cardName: card?.cardName ?? '', specialAbility: card?.specialAbility ?? '',
          imitatingName: card?.imitatingName,
        };
      });
  }, [gameState.pregameState, gameState.pregameStars, findAnyCardById]);
```

Use whatever the component's existing zone-grouped card variable is actually called (`myCards` in the snippet) and whatever highlight setter already exists; if there is no highlight state, make `onHighlightCard` a no-op and note it in the commit message rather than inventing new state.

- [ ] **Step 2: Pass `pregameStep` to `TurnIndicator` in the play client**

In `app/play/[code]/client.tsx`, derive once near the other lifecycle derivations (around `:1179`):

```tsx
  const pregameStep: 'stars' | 'souls' | undefined =
    gameState.game?.pregamePhase === 'stars' ? 'stars'
    : gameState.game?.pregamePhase === 'souls' ? 'souls'
    : undefined;
```

Add `pregameStep={pregameStep}` to the `TurnIndicator` in the **playing** branch (around `:1826`). The pre-game now runs with `status: 'playing'`, so that is the branch it renders through — and it already mounts `GameToolbar`, which the phase needs for Search Deck and Shuffle. Leave the ceremony and awaiting-start branches alone.

- [ ] **Step 3: Pass `pregameStep` in the spectator client**

In `app/play/spectate/[code]/client.tsx`, derive the same value and pass it to the spectator's `TurnIndicator`. Leave the `:510` and `:550` gates alone — with `status: 'playing'` they already route spectators to the board and no longer show the ceremony overlay.

- [ ] **Step 4: Verify nothing else keys off the old assumption**

```bash
cd /Users/timestes/projects/rtt-star-phase
rg -n "pregamePhase" app/ lib/ e2e/ --glob '!**/module_bindings/**'
```

For each hit, confirm it still behaves correctly now that `'stars'`/`'souls'` exist and run with `status: 'playing'`. Fix any that treat a non-empty `pregamePhase` as "not started".

- [ ] **Step 5: Type-check and commit**

Run: `cd /Users/timestes/projects/rtt-star-phase && npx tsc --noEmit`
Expected: no errors.

```bash
cd /Users/timestes/projects/rtt-star-phase
git add app/play/components/MultiplayerCanvas.tsx "app/play/[code]/client.tsx" "app/play/spectate/[code]/client.tsx"
git commit -m "feat(play): mount the pre-game rail and pre-game header"
```

---

### Task 14: End-to-end verification

**Files:**
- Create: `e2e/play/pregameStarPhase.spec.ts`
- Modify: `e2e/spectatorSeed.ts` (comment only)

**Interfaces:**
- Consumes: everything.
- Produces: a regression test for the two failures most likely to recur.

- [ ] **Step 1: Pin the existing seed's assumption**

Add above the card list in `e2e/spectatorSeed.ts` (around `:17`):

```ts
// NOTE: none of these cards has a (Star)/STAR: ability and none is a Lost Soul,
// so the REG Pre-Game Phase auto-skips both sub-steps and the game reaches turn 1
// without extra clicks. If you add a star card or a Lost Soul here, the pregame
// will pause for input and bothReachPlaying() will hang.
```

- [ ] **Step 2: Write the e2e**

Create `e2e/play/pregameStarPhase.spec.ts` following the existing two-client pattern in `e2e/spectator/` (reuse its auth-cookie minting and `playHelpers`). It must seed a deck containing at least one known star card — `Sign of Jonah` is a good choice, since Task 2 makes its ability hand-legal — and assert, in order:

1. After the first-player reveal, the header reads `PRE-GAME PHASE` and the rail offers `Reveal 1 star` / `No stars`.
2. The board is still interactive while the rail is mounted: perform a **real click-drag** on a hand card (not `dispatchEvent` — a dispatched event does not prove clickability, per the portaled-dialog precedent) and assert the card moved.
3. `GameToolbar` is present — assert the Search Deck control is visible.
4. Selecting the star and clicking `Reveal 1 star` puts the card in the resolve state, and its ability button is **enabled** (this is the Task 2 + Task 3 path end-to-end).
5. A **topdeck action succeeds** during the phase — this is the regression that the first design draft would have shipped, where `move_card_to_top_of_deck` throws `'Game is not in playing state'`.
6. `Resolved →` then the opponent's `No stars` reaches turn 1 with an interactive board.

- [ ] **Step 3: Run it**

Run: `cd /Users/timestes/projects/rtt-star-phase && npx playwright test e2e/play/pregameStarPhase.spec.ts`
Expected: PASS. Note that the suite has known pre-existing rot — if unrelated specs fail, do not fix them here; report them.

- [ ] **Step 4: Manual verification on the dev module**

Two browsers against `redemption-multiplayer-dev`:
- A **T1 game** with a star card: header reads `PRE-GAME PHASE`; rail does not block dragging; open Search Deck **while the rail is up** and confirm the rail renders *behind* the modal (the z-450 fix); resolve a star; reach turn 1.
- A **Paragon game**: the star step runs if the deck has stars, the soul step auto-skips, and the rail does not cover the Soul Deck pile.
- A **disconnect check**: during the star phase, close one tab for ~60 seconds and confirm the game is still alive on reopen (the 5-minute grace, not the old 30-second one).

- [ ] **Step 5: Commit**

```bash
cd /Users/timestes/projects/rtt-star-phase
git add e2e/play/pregameStarPhase.spec.ts e2e/spectatorSeed.ts
git commit -m "test(play): e2e for the pre-game star phase"
```

---

### Task 15: Open the pull request

- [ ] **Step 1: Full check**

```bash
cd /Users/timestes/projects/rtt-star-phase
npx vitest run
npx tsc --noEmit
```

Expected: both clean. Report any pre-existing failures rather than fixing them here.

- [ ] **Step 2: Push and open the PR**

```bash
cd /Users/timestes/projects/rtt-star-phase
git push -u origin feat/pregame-star-phase
```

Open the PR against `main` with a body that states:

- What it adds (REG Pre-Game Phase steps 2 and 3).
- **`status` now flips to `'playing'` at the reveal**, with turn machinery gated on `pregamePhase` — and why (≈20 reducers, including topdeck, are `status`-gated).
- **The round clock now starts when the pre-game ends**, not at the reveal.
- **`execute_card_ability` now honours per-ability `sourceZones`** — a behaviour change that makes `Delivered` and 22 other pre-existing hand-legal entries actually fireable from hand, as their registry entries always intended.
- **4 star cards gained `'hand'`** (The Coming Prince, Sign of Jonah, The Thankful Leper (GoC), The Three Visitors), with the 12 excluded in-play-half cards listed and the reasoning stated.
- **Forge star cards are out of scope** — their `specialAbility` is blanked on the public STDB row, so the star step auto-skips in Forge games.
- **Do not merge without a paired prod plan:** merging publishes the prod module, which needs a Vercel deploy carrying the regenerated bindings, scheduled together, with open sessions needing a refresh.

- [ ] **Step 3: Report the PR URL**

---

## Self-Review

**Spec coverage:** §3 state machine → Tasks 5, 6, 8. §4 schema → Task 5. §5 detection → Task 1 (Forge limitation documented in Task 6 Step 1). §6 reducers → Tasks 6, 7, 8. §6.1 reveal durability → Task 7 Step 2 (rows back the view). §7.1 index parity → Task 12. §7.3 registry → Task 2. §7.4 server sourceZones → Task 3. §8 soul step → Tasks 6, 7, 12. §9.1 header → Task 11. §9.2 rail → Tasks 12, 13. §9.3/9.4 clients → Task 13. §9.5 wiring → Task 10. §10 edge cases → Tasks 6, 8, 12. §11 testing → Tasks 1, 2, 4, 14. §12 deployment → Tasks 9, 15.

**Naming consistency:** `advancePregameFlow` / `markDone` / `PregameProgress` / `PregameEligibility` / `Seat` / `PregameStep` are defined in Task 4 and used with those exact names in Tasks 6-7. `advancePregame`, `finishPregame`, `schedulePregameIdleTimeout`, `clearPregameRows`, `readPregameProgress`, `isStarAbilityText` are defined in Tasks 6/8 and used consistently. `pregameSubmitStars` / `pregameResolveStar` / `pregameFinishSouls` are defined in Task 10 and consumed in Task 13. `pregameStep` is the prop name in Tasks 11, 12, 13.

**Known soft spots**, flagged rather than hidden: Task 6 Step 2 depends on a Lost Soul predicate whose exact name must be confirmed in `index.ts`; Task 7 Step 2 depends on the exact reveal field names in `reveal_card_in_hand`; Task 13 Step 1 depends on the canvas's actual zone-grouped card variable and highlight setter. Each names the file to check and what to do if the assumption does not hold.
