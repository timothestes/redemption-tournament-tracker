# Imitate Lost Soul Ability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a right-click "Imitate..." ability to both `Lost Soul "Imitate" [III John 1:11]` cards. Player clicks the menu item, then clicks any Lost Soul in either Land of Bondage to imitate it. Card art swaps to the target's bespoke image when registered; otherwise a small text label overlay shows the target's simplified name. Cycle is repeatable; "Stop Imitating" reverts.

**Architecture:** New typed ability variant `imitate_lost_soul`. Two new SpacetimeDB reducers (`imitate_lost_soul`, `stop_imitating_lost_soul`) that mutate the existing `CardInstance.cardImgFile` column and a new `CardInstance.imitatingName` column. Symmetric goldfish reducer helpers. New reusable Konva targeting-mode props on `GameCardNode` + a thin `<TargetCardOverlay>` banner. CardContextMenu special-cases the variant to drive the targeting state instead of `executeCardAbility`.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, react-konva, Tailwind (DOM chrome only — Konva nodes use pixel props), SpacetimeDB 2.x, Vitest.

**Spec:** [docs/superpowers/specs/2026-05-18-imitate-lost-soul-ability-design.md](../specs/2026-05-18-imitate-lost-soul-ability-design.md)

---

## Phase 1 — Registry + types (foundation everything else depends on)

### Task 1: Add the `imitate_lost_soul` ability variant + image / original-img / name maps + helper to both registry copies

**Files:**
- Modify: `lib/cards/cardAbilities.ts`
- Modify: `spacetimedb/src/cardAbilities.ts`

- [ ] **Step 1.1: Extend the `CardAbility` union in `lib/cards/cardAbilities.ts`**

Find the union definition around line 21 and add the new variant at the end of the union (before `custom`):

```ts
export type CardAbility = AbilityBase & (
  | { type: 'spawn_token'; tokenName: string; count?: number; defaultZone?: ZoneId }
  // ... existing variants unchanged ...
  | { type: 'three_nails_reset' }
  | { type: 'imitate_lost_soul' }
  | { type: 'custom'; reducerName: string; label: string }
);
```

- [ ] **Step 1.2: Register both Imitate cards in `CARD_ABILITIES`**

Add to the registry object in `lib/cards/cardAbilities.ts` (anywhere in the object — alphabetical order is fine). **Preserve the literal double space in the AB variant** — `[III John 1:11]<space><space>[AB - RoJ]`:

```ts
'Lost Soul "Imitate" [III John 1:11]':              [{ type: 'imitate_lost_soul' }],
'Lost Soul "Imitate" [III John 1:11]  [AB - RoJ]':  [{ type: 'imitate_lost_soul' }],
```

- [ ] **Step 1.3: Add the `IMITATE_SOUL_IMAGES` registry to `lib/cards/cardAbilities.ts`**

Place after `SPECIAL_TOKEN_CARDS`. **Preserve the double space in the three AB-variant keys** (Gain, Humble, Imitate):

```ts
/**
 * Exact-cardName → image path map for Imitate Lost Soul art swaps.
 * Files live under public/imitate-souls/cards/ (see public/imitate-souls/README.md).
 * Multiple cardName variants can point at the same file when the card
 * has alternate-border or promo variants sharing the same art.
 */
export const IMITATE_SOUL_IMAGES: Record<string, string> = {
  'Lost Soul "Awake" [Ephesians 5:14 - TPC]':                          '/imitate-souls/cards/awake.jpg',
  'Lost Soul "Crowds" [Luke 5:15] [2016 - Local]':                     '/imitate-souls/cards/crowds_local.jpg',
  'Lost Soul "Crowds" [Luke 5:15] [2025 - Worker]':                    '/imitate-souls/cards/crowds_worker.jpg',
  'Lost Soul "Defiled" [Mark 7:21-22]':                                '/imitate-souls/cards/defiled.jpg',
  'Lost Soul "Destruction" [Hebrews 10:39]':                           '/imitate-souls/cards/destruction.jpg',
  'Lost Soul "Destruction" [Hebrews 10:39] [AB - CoW]':                '/imitate-souls/cards/destruction.jpg',
  'Lost Soul "Dull" [Hebrews 5:11]':                                   '/imitate-souls/cards/dull.jpg',
  'Lost Soul "Dull" [Hebrews 5:11] [AB - CoW]':                        '/imitate-souls/cards/dull.jpg',
  'Lost Soul "Forsaken" [Hebrews 10:25]':                              '/imitate-souls/cards/forsaken.jpg',
  'Lost Soul "Forsaken" [Hebrews 10:25] [AB - CoW]':                   '/imitate-souls/cards/forsaken.jpg',
  'Lost Soul "Gain" [Jude 1:16]':                                      '/imitate-souls/cards/gain.jpg',
  'Lost Soul "Gain" [Jude 1:16]  [AB - RoJ]':                          '/imitate-souls/cards/gain.jpg',
  'Lost Soul "Galileans" [Luke 13:2]':                                 '/imitate-souls/cards/galileans.jpg',
  'Lost Soul "Harvest" [John 4:35]':                                   '/imitate-souls/cards/harvest.jpg',
  'Lost Soul "Harvest" [John 4:35] [2023 - 2nd Place]':                '/imitate-souls/cards/harvest_2nd.jpg',
  'Lost Soul "Humble" [James 4:6 / Proverbs 3:34 - RoJ]':              '/imitate-souls/cards/humble.jpg',
  'Lost Soul "Humble" [James 4:6 / Proverbs 3:34]  [AB - RoJ]':        '/imitate-souls/cards/humble.jpg',
  'Lost Soul "Humble" [James 4:6 / Proverbs 3:34] [2022 - 3rd Place]': '/imitate-souls/cards/humble_3rd.jpg',
  'Lost Soul "Imitate" [III John 1:11]':                               '/imitate-souls/cards/imitate.jpg',
  'Lost Soul "Imitate" [III John 1:11]  [AB - RoJ]':                   '/imitate-souls/cards/imitate.jpg',
  'Lost Soul "Lawless" [Hebrews 12:8]':                                '/imitate-souls/cards/lawless.jpg',
  'Lost Soul "Lawless" [Hebrews 12:8] [2021 - 1st Place]':             '/imitate-souls/cards/lawless.jpg',
  'Lost Soul "Lawless" [Hebrews 12:8] [AB - CoW]':                     '/imitate-souls/cards/lawless.jpg',
  'Lost Soul "Open Hand" [Hebrews 4:13]':                              '/imitate-souls/cards/open_hand.jpg',
  'Lost Soul "Open Hand" [Hebrews 4:13] [AB - CoW]':                   '/imitate-souls/cards/open_hand.jpg',
  'Lost Soul "Rejoice" [Luke 15:6 - J]':                               '/imitate-souls/cards/rejoice.jpg',
  'Lost Soul "Retribution" [Acts 16:22]':                              '/imitate-souls/cards/retribution.jpg',
  'Lost Soul "Revealer" [John 3:20]':                                  '/imitate-souls/cards/revealer.jpg',
  'Lost Soul "Salty" [Matthew 5:13]':                                  '/imitate-souls/cards/salty.jpg',
  'Lost Soul "Shut Door" [Luke 13:25 - LR]':                           '/imitate-souls/cards/shut_door.jpg',
  'Lost Soul "Tempter" [II Timothy 3:6-7 - TPC]':                      '/imitate-souls/cards/tempter.jpg',
  'Lost Soul "The First" [Luke 13:30]':                                '/imitate-souls/cards/the_first.jpg',
  'Lost Soul "Undesirables" [Luke 14:13]':                             '/imitate-souls/cards/undesireables.jpg',
};
```

Note the deliberate filename mismatch on the last entry: the cardName has the correct spelling `Undesirables`, but the image file is misspelled `undesireables.jpg` — keep both spellings exactly as shown.

- [ ] **Step 1.4: Add the `simplifyLostSoulName` helper to `lib/cards/cardAbilities.ts`**

Place after `IMITATE_SOUL_IMAGES`:

```ts
/**
 * Extracts a short label from a Lost Soul cardName for the imitation overlay.
 * Priority: quoted name → first parenthetical → cardName with "Lost Soul " prefix stripped.
 */
export function simplifyLostSoulName(cardName: string): string {
  const quoted = cardName.match(/"([^"]+)"/);
  if (quoted) return quoted[1];
  const paren = cardName.match(/\(([^)]+)\)/);
  if (paren) return paren[1];
  return cardName.replace(/^Lost Soul\s+/, '').trim();
}
```

- [ ] **Step 1.5: Add a case to `abilityLabel()` in `lib/cards/cardAbilities.ts`**

Find the `switch (a.type)` in `abilityLabel` and add before the `custom` case:

```ts
case 'imitate_lost_soul':
  return 'Imitate...';
```

- [ ] **Step 1.6: Mirror EVERY change in `spacetimedb/src/cardAbilities.ts`**

Copy the new union variant, both registry entries, the full `IMITATE_SOUL_IMAGES` map, the `simplifyLostSoulName` helper, and the `abilityLabel` case to `spacetimedb/src/cardAbilities.ts`. Parity tests will fail if anything drifts.

- [ ] **Step 1.7: Add `IMITATE_ORIGINAL_IMG` to `spacetimedb/src/cardAbilities.ts` ONLY**

Server can't call `findCard()`. Place after `IMITATE_SOUL_IMAGES`:

```ts
/**
 * Original (canonical) imgFile for each Imitate Lost Soul variant. Used by
 * stop_imitating_lost_soul to revert. Values match the imgFile field in
 * lib/cards/generated/cardData.ts. Parity test enforces this.
 */
export const IMITATE_ORIGINAL_IMG: Record<string, string> = {
  'Lost Soul "Imitate" [III John 1:11]':              '23-Lost-Soul-Imitate-R',
  'Lost Soul "Imitate" [III John 1:11]  [AB - RoJ]':  'RoJ_AB_N23-Lost-Soul-Imitate-R',
};
```

Do NOT add this to `lib/cards/cardAbilities.ts` — the client uses `findCard(cardName).imgFile` directly.

- [ ] **Step 1.8: Commit**

```bash
git add lib/cards/cardAbilities.ts spacetimedb/src/cardAbilities.ts
git commit -m "Register imitate_lost_soul ability + image/name maps

Adds the typed variant, both Imitate Lost Soul card entries, the exact-
cardName → image path map covering all variants of the 24 supplied JPGs,
the server-side IMITATE_ORIGINAL_IMG map for revert, and the
simplifyLostSoulName helper."
```

---

### Task 2: Extend parity + image-resolution tests

**Files:**
- Modify: `lib/cards/__tests__/cardAbilities.test.ts`

- [ ] **Step 2.1: Add test assertions for IMITATE_SOUL_IMAGES parity**

Append to the existing test file. The exact import style should mirror the existing parity tests at the top of the file. Add a new `describe` block:

```ts
import fs from 'node:fs';
import path from 'node:path';
import {
  IMITATE_SOUL_IMAGES as libImitateImages,
  CARD_ABILITIES as libCardAbilities,
  simplifyLostSoulName,
} from '@/lib/cards/cardAbilities';
import {
  IMITATE_SOUL_IMAGES as serverImitateImages,
  IMITATE_ORIGINAL_IMG,
} from '@/spacetimedb/src/cardAbilities';
import { findCard } from '@/lib/cards/lookup';

describe('IMITATE_SOUL_IMAGES parity + integrity', () => {
  it('lib and spacetimedb copies are identical', () => {
    expect(serverImitateImages).toEqual(libImitateImages);
  });

  it('every key resolves to a real card via findCard', () => {
    for (const cardName of Object.keys(libImitateImages)) {
      expect(findCard(cardName), `findCard(${JSON.stringify(cardName)})`).toBeTruthy();
    }
  });

  it('every value points to an existing file under public/imitate-souls/cards/', () => {
    for (const [cardName, imgPath] of Object.entries(libImitateImages)) {
      const absPath = path.join(process.cwd(), 'public', imgPath);
      expect(
        fs.existsSync(absPath),
        `${cardName} → ${imgPath} (resolved: ${absPath})`,
      ).toBe(true);
    }
  });

  it('both Imitate Lost Soul variants are registered with imitate_lost_soul', () => {
    const a = libCardAbilities['Lost Soul "Imitate" [III John 1:11]'];
    const b = libCardAbilities['Lost Soul "Imitate" [III John 1:11]  [AB - RoJ]'];
    expect(a, 'regular variant registered').toBeDefined();
    expect(b, 'AB variant registered (note literal double space)').toBeDefined();
    expect(a?.[0]?.type).toBe('imitate_lost_soul');
    expect(b?.[0]?.type).toBe('imitate_lost_soul');
  });

  it('IMITATE_ORIGINAL_IMG matches findCard().imgFile for each Imitate variant', () => {
    for (const [cardName, originalImg] of Object.entries(IMITATE_ORIGINAL_IMG)) {
      const card = findCard(cardName);
      expect(card, `findCard(${cardName})`).toBeTruthy();
      expect(card?.imgFile).toBe(originalImg);
    }
  });
});

describe('simplifyLostSoulName', () => {
  it('extracts the quoted name when present', () => {
    expect(simplifyLostSoulName('Lost Soul "Awake" [Ephesians 5:14 - TPC]')).toBe('Awake');
    expect(simplifyLostSoulName('Lost Soul "Open Hand" [Hebrews 4:13]')).toBe('Open Hand');
  });

  it('falls back to the parenthetical when no quoted name', () => {
    expect(simplifyLostSoulName('Lost Soul Acts 11:18 (NT Only)')).toBe('NT Only');
    expect(simplifyLostSoulName('Lost Soul Matthew 19:26 (First Round Protect)')).toBe('First Round Protect');
  });

  it('strips "Lost Soul " prefix when neither quoted nor parenthetical exists', () => {
    expect(simplifyLostSoulName('Lost Soul Romans 3:23')).toBe('Romans 3:23');
  });
});
```

- [ ] **Step 2.2: Run the test file and verify all assertions pass**

```bash
npx vitest run lib/cards/__tests__/cardAbilities.test.ts
```

Expected: all tests pass. If a file-existence assertion fails, the registry has a typo'd path; cross-check against `ls public/imitate-souls/cards/`.

- [ ] **Step 2.3: Commit**

```bash
git add lib/cards/__tests__/cardAbilities.test.ts
git commit -m "Test IMITATE_SOUL_IMAGES parity, file existence, registry, and simplifyLostSoulName"
```

---

### Task 3: Add `imitatingName` field to SpacetimeDB schema

**Files:**
- Modify: `spacetimedb/src/schema.ts` (CardInstance table, around line 143)

- [ ] **Step 3.1: Add the column**

In `spacetimedb/src/schema.ts`, find the `CardInstance` table definition (around line 90). After the existing `outlineColor: t.string().default('')` column (line ~143), add:

```ts
// Set by imitate_lost_soul to the simplifyLostSoulName(target.cardName)
// value when this card is currently imitating another Lost Soul. Empty
// string when not imitating. The card's cardImgFile is also mutated when
// the target has registered art; otherwise GameCardNode renders this
// value as a label overlay (fallback-only). Cleared by
// stop_imitating_lost_soul.
imitatingName: t.string().default(''),
```

- [ ] **Step 3.2: Commit the schema change (publish happens in Task 7)**

```bash
git add spacetimedb/src/schema.ts
git commit -m "Add imitatingName column to CardInstance"
```

---

### Task 4: Add client `GameCard.imitatingName` field + new ActionType entries

**Files:**
- Modify: `app/shared/types/gameCard.ts`

- [ ] **Step 4.1: Add the optional field to `GameCard`**

In `app/shared/types/gameCard.ts`, find the `GameCard` interface (around line 59) and add this field after `outlineColor`:

```ts
  /** Name of the Lost Soul this card is currently imitating (set by the
   *  imitate_lost_soul reducer). Empty string or undefined when not
   *  imitating. The label overlay in GameCardNode renders this value
   *  only when no art swap occurred (fallback-only). */
  imitatingName?: string;
```

- [ ] **Step 4.2: Add the new ActionType entries**

In the same file, find the `ActionType` union (around line 100) and add the two new entries at the end (before the closing `;`):

```ts
  | 'IMITATE_LOST_SOUL'
  | 'STOP_IMITATING_LOST_SOUL';
```

- [ ] **Step 4.3: Add `targetInstanceId` to GameAction payload**

In the same file, find the `GameAction.payload` interface (around line 136) and add an optional field:

```ts
    /** Instance id of a target card chosen via the targeting overlay
     *  (currently only used by IMITATE_LOST_SOUL). */
    targetInstanceId?: string;
```

- [ ] **Step 4.4: Commit**

```bash
git add app/shared/types/gameCard.ts
git commit -m "Add GameCard.imitatingName, two new ActionType entries, and targetInstanceId payload"
```

---

## Phase 2 — Server reducers + module publish

### Task 5: Add `imitate_lost_soul` and `stop_imitating_lost_soul` SpacetimeDB reducers

**Files:**
- Modify: `spacetimedb/src/index.ts`

- [ ] **Step 5.1: Import the new registries**

In `spacetimedb/src/index.ts`, find the existing imports from `./cardAbilities` (search for `getAbilitiesForCard`). Add `IMITATE_SOUL_IMAGES`, `IMITATE_ORIGINAL_IMG`, and `simplifyLostSoulName` to the import list:

```ts
import {
  getAbilitiesForCard,
  // ...existing imports...
  IMITATE_SOUL_IMAGES,
  IMITATE_ORIGINAL_IMG,
  simplifyLostSoulName,
} from './cardAbilities';
```

- [ ] **Step 5.2: Add an exhaustive stub to the `execute_card_ability` switch**

In the switch statement at `spacetimedb/src/index.ts:~3298` (inside `execute_card_ability`), add a new case (place it next to the other client-dispatched stubs around line 3345-3348, between `three_nails_reset` and `reserve_opponent_deck`):

```ts
      case 'imitate_lost_soul':
        throw new SenderError('imitate_lost_soul is dispatched directly by the client');
```

- [ ] **Step 5.3: Add the `imitate_lost_soul` reducer**

Append after the existing `execute_card_ability` reducer (around line 3363). Read `spacetimedb/CLAUDE.md` first if anything in this snippet is unclear; pay special attention to (a) the spread-update pattern, (b) BigInt literals, (c) PascalCase table accessors used in this codebase:

```ts
// ---------------------------------------------------------------------------
// Reducer: imitate_lost_soul
//
// Swaps the source Imitate Lost Soul's cardImgFile to the target's bespoke
// art when registered in IMITATE_SOUL_IMAGES; always sets imitatingName so
// GameCardNode can render a label overlay when no art was swapped. The
// source must be an Imitate variant (per IMITATE_ORIGINAL_IMG keys); the
// target must be a Lost Soul currently in a Land of Bondage.
// ---------------------------------------------------------------------------
export const imitate_lost_soul = spacetimedb.reducer(
  {
    gameId: t.u64(),
    sourceInstanceId: t.u64(),
    targetInstanceId: t.u64(),
  },
  (ctx, { gameId, sourceInstanceId, targetInstanceId }) => {
    const player = findPlayerBySender(ctx, gameId);

    const source = ctx.db.CardInstance.id.find(sourceInstanceId);
    if (!source) throw new SenderError('Source card not found');
    if (source.gameId !== gameId) throw new SenderError('Source not in this game');
    if (source.ownerId !== player.id) throw new SenderError('Not your card');
    if (!(source.cardName in IMITATE_ORIGINAL_IMG)) {
      throw new SenderError('Source is not an Imitate Lost Soul');
    }
    const ABILITY_SOURCE_ZONES = ['territory', 'land-of-bondage', 'land-of-redemption'];
    if (!ABILITY_SOURCE_ZONES.includes(source.zone)) {
      throw new SenderError('Source card must be in play');
    }

    const target = ctx.db.CardInstance.id.find(targetInstanceId);
    if (!target) throw new SenderError('Target card not found');
    if (target.gameId !== gameId) throw new SenderError('Target not in this game');
    if (target.cardType !== 'Lost Soul') throw new SenderError('Target must be a Lost Soul');
    if (target.zone !== 'land-of-bondage') {
      throw new SenderError('Target must be in a Land of Bondage');
    }

    const registered = IMITATE_SOUL_IMAGES[target.cardName];
    const newImg = registered ?? source.cardImgFile;
    const newLabel = simplifyLostSoulName(target.cardName);

    ctx.db.CardInstance.id.update({
      ...source,
      cardImgFile: newImg,
      imitatingName: newLabel,
    });

    const game = ctx.db.Game.id.find(gameId);
    if (game) {
      logAction(
        ctx,
        gameId,
        player.id,
        'IMITATE_LOST_SOUL',
        JSON.stringify({
          targetCardName: target.cardName,
          label: newLabel,
          hasArt: !!registered,
        }),
        game.turnNumber,
        game.currentPhase,
      );
    }
  },
);
```

- [ ] **Step 5.4: Add the `stop_imitating_lost_soul` reducer**

Append immediately after the `imitate_lost_soul` reducer:

```ts
// ---------------------------------------------------------------------------
// Reducer: stop_imitating_lost_soul
//
// Reverts an Imitate Lost Soul's cardImgFile to the canonical value from
// IMITATE_ORIGINAL_IMG and clears imitatingName. Safe to call when the card
// is not currently imitating (idempotent: rewrites with the same values).
// ---------------------------------------------------------------------------
export const stop_imitating_lost_soul = spacetimedb.reducer(
  { gameId: t.u64(), sourceInstanceId: t.u64() },
  (ctx, { gameId, sourceInstanceId }) => {
    const player = findPlayerBySender(ctx, gameId);

    const source = ctx.db.CardInstance.id.find(sourceInstanceId);
    if (!source) throw new SenderError('Source card not found');
    if (source.gameId !== gameId) throw new SenderError('Source not in this game');
    if (source.ownerId !== player.id) throw new SenderError('Not your card');

    const original = IMITATE_ORIGINAL_IMG[source.cardName];
    if (!original) throw new SenderError('Source is not an Imitate Lost Soul');

    ctx.db.CardInstance.id.update({
      ...source,
      cardImgFile: original,
      imitatingName: '',
    });

    const game = ctx.db.Game.id.find(gameId);
    if (game) {
      logAction(
        ctx,
        gameId,
        player.id,
        'STOP_IMITATING_LOST_SOUL',
        '{}',
        game.turnNumber,
        game.currentPhase,
      );
    }
  },
);
```

- [ ] **Step 5.5: Verify the file still type-checks**

```bash
npx tsc --noEmit -p spacetimedb/tsconfig.json
```

Expected: no errors. If the exhaustiveness check on `execute_card_ability` complains, ensure the new case was added.

- [ ] **Step 5.6: Commit**

```bash
git add spacetimedb/src/index.ts
git commit -m "Add imitate_lost_soul and stop_imitating_lost_soul reducers"
```

---

### Task 6: Publish the SpacetimeDB module + regenerate client bindings

**Files:**
- Modify: `lib/spacetimedb/module_bindings/*` (generated)

- [ ] **Step 6.1: Invoke the spacetimedb-deploy skill**

Use the skill exactly as described in its own SKILL.md — it publishes dev + prod and regenerates bindings. The schema change is an in-place column add with a default, so **NO** `--clear-database` flag is needed. Data is preserved.

- [ ] **Step 6.2: Verify the generated bindings include the new reducers**

```bash
grep -l "imitateLostSoul\|stopImitatingLostSoul" lib/spacetimedb/module_bindings/
```

Expected: at least one file matches (`index.ts` re-exports, plus the per-reducer files like `imitate_lost_soul_reducer.ts`).

- [ ] **Step 6.3: Commit the regenerated bindings**

```bash
git add lib/spacetimedb/module_bindings/
git commit -m "Regenerate bindings for imitate_lost_soul + stop_imitating_lost_soul"
```

---

## Phase 3 — Goldfish reducer + tests

### Task 7: Add goldfish action handlers + helper functions

**Files:**
- Modify: `app/goldfish/state/gameReducer.ts`

- [ ] **Step 7.1: Import the new registries**

In `app/goldfish/state/gameReducer.ts`, find the existing import from `@/lib/cards/cardAbilities` (search for `getAbilitiesForCard`). Extend it:

```ts
import {
  getAbilitiesForCard,
  // ...existing imports...
  IMITATE_SOUL_IMAGES,
  simplifyLostSoulName,
} from '@/lib/cards/cardAbilities';
import { findCard } from '@/lib/cards/lookup';
```

(If `findCard` is already imported at the top of the file, skip the second import.)

- [ ] **Step 7.2: Add the `imitateLostSoulInState` helper**

Place near `spawnTokenInState` (around line 40):

```ts
function imitateLostSoulInState(
  state: GameState,
  sourceInstanceId: string,
  targetInstanceId: string,
  history: GameState[],
): GameState {
  // Locate source and target across all zones.
  let source: GameCard | undefined;
  let target: GameCard | undefined;
  for (const zone of Object.values(state.zones)) {
    for (const c of zone) {
      if (c.instanceId === sourceInstanceId) source = c;
      else if (c.instanceId === targetInstanceId) target = c;
    }
  }
  if (!source || !target) return state;

  // Validate source is an Imitate Soul and in play.
  if (!source.cardName.startsWith('Lost Soul "Imitate"')) return state;
  const ABILITY_SOURCE_ZONES: ZoneId[] = ['territory', 'land-of-bondage', 'land-of-redemption'];
  if (!ABILITY_SOURCE_ZONES.includes(source.zone)) return state;

  // Validate target is a Lost Soul in LoB. Use isLostSoul() helper.
  if (!isLostSoul(target)) return state;
  if (target.zone !== 'land-of-bondage') return state;

  const newImg = IMITATE_SOUL_IMAGES[target.cardName] ?? source.cardImgFile;
  const newLabel = simplifyLostSoulName(target.cardName);

  // Build updated zones — mutate the source card in place.
  const zones = cloneZones(state.zones);
  for (const zoneKey of Object.keys(zones) as ZoneId[]) {
    const idx = zones[zoneKey].findIndex(c => c.instanceId === sourceInstanceId);
    if (idx !== -1) {
      zones[zoneKey] = [...zones[zoneKey]];
      zones[zoneKey][idx] = {
        ...zones[zoneKey][idx],
        cardImgFile: newImg,
        imitatingName: newLabel,
      };
      break;
    }
  }

  return { ...state, zones, history };
}
```

- [ ] **Step 7.3: Add the `stopImitatingInState` helper**

Append after `imitateLostSoulInState`:

```ts
function stopImitatingInState(
  state: GameState,
  sourceInstanceId: string,
  history: GameState[],
): GameState {
  let source: GameCard | undefined;
  for (const zone of Object.values(state.zones)) {
    const found = zone.find(c => c.instanceId === sourceInstanceId);
    if (found) { source = found; break; }
  }
  if (!source) return state;
  if (!source.cardName.startsWith('Lost Soul "Imitate"')) return state;

  // Restore canonical imgFile from cardData.
  const canonical = findCard(source.cardName)?.imgFile;
  if (!canonical) return state;

  const zones = cloneZones(state.zones);
  for (const zoneKey of Object.keys(zones) as ZoneId[]) {
    const idx = zones[zoneKey].findIndex(c => c.instanceId === sourceInstanceId);
    if (idx !== -1) {
      zones[zoneKey] = [...zones[zoneKey]];
      zones[zoneKey][idx] = {
        ...zones[zoneKey][idx],
        cardImgFile: canonical,
        imitatingName: '',
      };
      break;
    }
  }

  return { ...state, zones, history };
}
```

- [ ] **Step 7.4: Add exhaustive stub to `EXECUTE_CARD_ABILITY` switch**

In the switch at `app/goldfish/state/gameReducer.ts:~1106`, add a new case after the existing `three_nails_reset` case (line ~1139), before the `default` case:

```ts
        case 'imitate_lost_soul':
          // Targeting variant — dispatched via the dedicated IMITATE_LOST_SOUL
          // action which carries a target. No-op here.
          return state;
```

- [ ] **Step 7.5: Add the two new action cases to the top-level reducer switch**

In the same file, find the top-level `switch (action.type)` (the one that contains `case 'EXECUTE_CARD_ABILITY'` at line 1080). Add these two cases nearby:

```ts
    case 'IMITATE_LOST_SOUL': {
      const { cardInstanceId, targetInstanceId } = action.payload;
      if (!cardInstanceId || !targetInstanceId) return state;
      return imitateLostSoulInState(state, cardInstanceId, targetInstanceId, history);
    }

    case 'STOP_IMITATING_LOST_SOUL': {
      const { cardInstanceId } = action.payload;
      if (!cardInstanceId) return state;
      return stopImitatingInState(state, cardInstanceId, history);
    }
```

- [ ] **Step 7.6: Verify the file type-checks**

```bash
npx tsc --noEmit
```

Expected: no errors. Any `_exhaustive: never` failure means the new variant isn't accounted for somewhere — check that step 7.4 was applied.

- [ ] **Step 7.7: Commit**

```bash
git add app/goldfish/state/gameReducer.ts
git commit -m "Goldfish: handle IMITATE_LOST_SOUL and STOP_IMITATING_LOST_SOUL actions"
```

---

### Task 8: Add goldfish action creators

**Files:**
- Modify: `app/goldfish/state/gameActions.ts`

- [ ] **Step 8.1: Add the two new action creators**

Find the existing `executeCardAbility` creator (around line 123) and add two more methods on the same object:

```ts
  imitateLostSoul(sourceInstanceId: string, targetInstanceId: string): GameAction {
    return createAction('IMITATE_LOST_SOUL', {
      cardInstanceId: sourceInstanceId,
      targetInstanceId,
    });
  },

  stopImitatingLostSoul(sourceInstanceId: string): GameAction {
    return createAction('STOP_IMITATING_LOST_SOUL', {
      cardInstanceId: sourceInstanceId,
    });
  },
```

- [ ] **Step 8.2: Commit**

```bash
git add app/goldfish/state/gameActions.ts
git commit -m "Goldfish: add action creators for imitate / stop-imitating"
```

---

### Task 9: Goldfish reducer unit tests

**Files:**
- Modify: `app/goldfish/state/__tests__/gameReducer.customAbilities.test.ts`

- [ ] **Step 9.1: Add a test block for the imitate flow**

Append to the existing test file. The existing tests show the helper pattern for constructing a `GameState` and dispatching actions — follow that pattern. Add a new `describe` block:

```ts
describe('imitate_lost_soul', () => {
  // Helper — assumes the existing tests have a similar makeState helper;
  // adapt to that helper's signature. If not, build inline.
  function buildState(cards: Partial<GameCard>[]): GameState {
    // ...follow the pattern in the existing tests in this file...
  }

  it('swaps cardImgFile and sets imitatingName when target has registered art', () => {
    const source: Partial<GameCard> = {
      instanceId: 'src',
      cardName: 'Lost Soul "Imitate" [III John 1:11]',
      cardImgFile: '23-Lost-Soul-Imitate-R',
      type: 'Lost Soul',
      zone: 'land-of-bondage',
      ownerId: 'player1',
    };
    const target: Partial<GameCard> = {
      instanceId: 'tgt',
      cardName: 'Lost Soul "Awake" [Ephesians 5:14 - TPC]',
      cardImgFile: 'awake-original',
      type: 'Lost Soul',
      zone: 'land-of-bondage',
      ownerId: 'player1',
    };
    const initial = buildState([source, target]);
    const next = gameReducer(initial, gameActions.imitateLostSoul('src', 'tgt'));
    const updatedSource = next.zones['land-of-bondage'].find(c => c.instanceId === 'src')!;
    expect(updatedSource.cardImgFile).toBe('/imitate-souls/cards/awake.jpg');
    expect(updatedSource.imitatingName).toBe('Awake');
  });

  it('leaves cardImgFile unchanged and sets imitatingName when target has no registered art', () => {
    const source: Partial<GameCard> = {
      instanceId: 'src',
      cardName: 'Lost Soul "Imitate" [III John 1:11]',
      cardImgFile: '23-Lost-Soul-Imitate-R',
      type: 'Lost Soul',
      zone: 'land-of-bondage',
      ownerId: 'player1',
    };
    const target: Partial<GameCard> = {
      instanceId: 'tgt',
      cardName: 'Lost Soul Matthew 19:23 (Speed Bump)',
      cardImgFile: 'speed-bump-original',
      type: 'Lost Soul',
      zone: 'land-of-bondage',
      ownerId: 'player1',
    };
    const initial = buildState([source, target]);
    const next = gameReducer(initial, gameActions.imitateLostSoul('src', 'tgt'));
    const updatedSource = next.zones['land-of-bondage'].find(c => c.instanceId === 'src')!;
    expect(updatedSource.cardImgFile).toBe('23-Lost-Soul-Imitate-R');
    expect(updatedSource.imitatingName).toBe('Speed Bump');
  });

  it('stop_imitating reverts cardImgFile and clears imitatingName', () => {
    const source: Partial<GameCard> = {
      instanceId: 'src',
      cardName: 'Lost Soul "Imitate" [III John 1:11]',
      cardImgFile: '/imitate-souls/cards/awake.jpg',
      imitatingName: 'Awake',
      type: 'Lost Soul',
      zone: 'land-of-bondage',
      ownerId: 'player1',
    };
    const initial = buildState([source]);
    const next = gameReducer(initial, gameActions.stopImitatingLostSoul('src'));
    const updatedSource = next.zones['land-of-bondage'].find(c => c.instanceId === 'src')!;
    expect(updatedSource.cardImgFile).toBe('23-Lost-Soul-Imitate-R');
    expect(updatedSource.imitatingName).toBe('');
  });

  it('rejects non-Lost-Soul target', () => {
    const source: Partial<GameCard> = {
      instanceId: 'src',
      cardName: 'Lost Soul "Imitate" [III John 1:11]',
      cardImgFile: '23-Lost-Soul-Imitate-R',
      type: 'Lost Soul',
      zone: 'land-of-bondage',
      ownerId: 'player1',
    };
    const target: Partial<GameCard> = {
      instanceId: 'tgt',
      cardName: 'Mayhem',
      type: 'Evil Card',
      zone: 'land-of-bondage',
      ownerId: 'player1',
    };
    const initial = buildState([source, target]);
    const next = gameReducer(initial, gameActions.imitateLostSoul('src', 'tgt'));
    expect(next).toBe(initial);
  });

  it('rejects target outside Land of Bondage', () => {
    const source: Partial<GameCard> = {
      instanceId: 'src',
      cardName: 'Lost Soul "Imitate" [III John 1:11]',
      cardImgFile: '23-Lost-Soul-Imitate-R',
      type: 'Lost Soul',
      zone: 'land-of-bondage',
      ownerId: 'player1',
    };
    const target: Partial<GameCard> = {
      instanceId: 'tgt',
      cardName: 'Lost Soul "Awake" [Ephesians 5:14 - TPC]',
      type: 'Lost Soul',
      zone: 'deck',
      ownerId: 'player1',
    };
    const initial = buildState([source, target]);
    const next = gameReducer(initial, gameActions.imitateLostSoul('src', 'tgt'));
    expect(next).toBe(initial);
  });

  it('rejects when source is not an Imitate Lost Soul', () => {
    const notImitate: Partial<GameCard> = {
      instanceId: 'src',
      cardName: 'Lost Soul "Awake" [Ephesians 5:14 - TPC]',
      type: 'Lost Soul',
      zone: 'land-of-bondage',
      ownerId: 'player1',
    };
    const target: Partial<GameCard> = {
      instanceId: 'tgt',
      cardName: 'Lost Soul "Forsaken" [Hebrews 10:25]',
      type: 'Lost Soul',
      zone: 'land-of-bondage',
      ownerId: 'player1',
    };
    const initial = buildState([notImitate, target]);
    const next = gameReducer(initial, gameActions.imitateLostSoul('src', 'tgt'));
    expect(next).toBe(initial);
  });

  it('re-imitate overwrites prior imitation', () => {
    const source: Partial<GameCard> = {
      instanceId: 'src',
      cardName: 'Lost Soul "Imitate" [III John 1:11]',
      cardImgFile: '/imitate-souls/cards/awake.jpg',
      imitatingName: 'Awake',
      type: 'Lost Soul',
      zone: 'land-of-bondage',
      ownerId: 'player1',
    };
    const target: Partial<GameCard> = {
      instanceId: 'tgt',
      cardName: 'Lost Soul "Forsaken" [Hebrews 10:25]',
      type: 'Lost Soul',
      zone: 'land-of-bondage',
      ownerId: 'player1',
    };
    const initial = buildState([source, target]);
    const next = gameReducer(initial, gameActions.imitateLostSoul('src', 'tgt'));
    const updatedSource = next.zones['land-of-bondage'].find(c => c.instanceId === 'src')!;
    expect(updatedSource.cardImgFile).toBe('/imitate-souls/cards/forsaken.jpg');
    expect(updatedSource.imitatingName).toBe('Forsaken');
  });
});
```

If the existing test file's `buildState` / helper differs from this skeleton, adapt to its conventions. The assertions themselves should not change.

- [ ] **Step 9.2: Run the tests**

```bash
npx vitest run app/goldfish/state/__tests__/gameReducer.customAbilities.test.ts
```

Expected: all 7 new tests pass.

- [ ] **Step 9.3: Commit**

```bash
git add app/goldfish/state/__tests__/gameReducer.customAbilities.test.ts
git commit -m "Test goldfish imitate_lost_soul happy paths + rejections"
```

---

## Phase 4 — Client UI: Konva rendering + targeting

### Task 10: Extend `GameCardNode` with `isDimmed`, `targetingMode`, and the label overlay

**Files:**
- Modify: `app/shared/components/GameCardNode.tsx`

- [ ] **Step 10.1: Extend the props interface**

Find `GameCardNodeProps` (line ~51). Add three optional props before the closing brace:

```ts
  /** When true, render the card at reduced opacity (used during targeting). */
  isDimmed?: boolean;
  /** When set, the card is part of a targeting selection. `isEligible` controls
   *  whether the card is selectable; `onSelect` is called on click/tap. */
  targetingMode?: {
    isEligible: boolean;
    onSelect: () => void;
  };
```

- [ ] **Step 10.2: Destructure the new props**

In the function signature destructure block (line ~83), add `isDimmed`, `targetingMode` to the destructured props.

- [ ] **Step 10.3: Add a `findCard` import**

At the top of the file:

```ts
import { findCard } from '@/lib/cards/lookup';
```

- [ ] **Step 10.4: Add a constant for the label height**

Near the top of the component or alongside other size constants:

```ts
const IMITATE_LABEL_HEIGHT = 18;
```

- [ ] **Step 10.5: Apply opacity to the top-level `<Group>`**

Find the top-level `<Group>` element that wraps the entire card. Add an `opacity` prop:

```tsx
<Group
  // ...existing props...
  opacity={isDimmed ? 0.3 : 1}
  // ...
>
```

- [ ] **Step 10.6: Route click/tap through targeting when active**

Find the existing `onClick` / `onTap` handlers on the inner `<Group>` that holds the card image (around line 199, where `onTap` is wired). Wrap the existing handlers so they short-circuit during targeting:

```tsx
onClick={(e) => {
  if (targetingMode) {
    e.cancelBubble = true;
    if (targetingMode.isEligible) targetingMode.onSelect();
    return;  // swallow click in all targeting cases (eligible OR ineligible)
  }
  // ...existing onClick logic, unchanged...
}}
onTap={(e) => {
  if (targetingMode) {
    e.cancelBubble = true;
    if (targetingMode.isEligible) targetingMode.onSelect();
    return;
  }
  // ...existing onTap logic, unchanged...
}}
```

`e.cancelBubble = true` is the Konva event-cancellation idiom (Konva does NOT use DOM `stopPropagation`).

- [ ] **Step 10.7: Render the imitatingName label overlay**

Inside the top-level `<Group>`, after the card image is rendered (after the `<KonvaImage>` element), add the conditional label render:

```tsx
{(() => {
  const showImitateLabel =
    !!card.imitatingName &&
    card.cardImgFile === findCard(card.cardName)?.imgFile;
  if (!showImitateLabel) return null;
  return (
    <>
      <Rect
        x={0}
        y={cardHeight - IMITATE_LABEL_HEIGHT}
        width={cardWidth}
        height={IMITATE_LABEL_HEIGHT}
        fill="rgba(0, 0, 0, 0.7)"
      />
      <Text
        x={0}
        y={cardHeight - IMITATE_LABEL_HEIGHT}
        width={cardWidth}
        height={IMITATE_LABEL_HEIGHT}
        text={card.imitatingName!}
        fill="#ffffff"
        fontSize={11}
        fontStyle="500"
        align="center"
        verticalAlign="middle"
        wrap="none"
        ellipsis
      />
    </>
  );
})()}
```

- [ ] **Step 10.8: Verify the file type-checks**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 10.9: Commit**

```bash
git add app/shared/components/GameCardNode.tsx
git commit -m "GameCardNode: add targeting/dimmed props and Konva imitate-label overlay"
```

---

### Task 11: Create the `TargetCardOverlay` banner component

**Files:**
- Create: `app/shared/components/TargetCardOverlay.tsx`

- [ ] **Step 11.1: Create the component**

```tsx
'use client';

import { useEffect } from 'react';

export interface TargetCardOverlayProps {
  prompt: string;
  onCancel: () => void;
}

/**
 * Banner overlay shown while the canvas is in "click a card to target" mode.
 * Dimming and per-card click interception happen inside GameCardNode (Konva
 * primitives); this component is pure DOM chrome for the prompt + cancel UX.
 */
export function TargetCardOverlay({ prompt, onCancel }: TargetCardOverlayProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return (
    <div
      style={{
        position: 'fixed',
        top: 16,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 50,
        background: 'rgba(0, 0, 0, 0.85)',
        color: '#fff',
        padding: '10px 16px',
        borderRadius: 8,
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        fontSize: 14,
        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
        pointerEvents: 'auto',
      }}
    >
      <span>{prompt}</span>
      <span style={{ opacity: 0.6, fontSize: 12 }}>Esc to cancel</span>
      <button
        onClick={onCancel}
        style={{
          background: 'rgba(255, 255, 255, 0.15)',
          color: '#fff',
          border: 'none',
          padding: '4px 10px',
          borderRadius: 4,
          fontSize: 12,
          cursor: 'pointer',
        }}
      >
        Cancel
      </button>
    </div>
  );
}
```

- [ ] **Step 11.2: Commit**

```bash
git add app/shared/components/TargetCardOverlay.tsx
git commit -m "Add TargetCardOverlay banner component"
```

---

### Task 12: Wire targeting state into `GoldfishCanvas`

**Files:**
- Modify: `app/goldfish/components/GoldfishCanvas.tsx`

- [ ] **Step 12.1: Add the targeting state**

Near the other `useState` declarations at the top of the component, add:

```ts
import { TargetCardOverlay } from '@/app/shared/components/TargetCardOverlay';

// Inside the component:
type TargetingRequest = {
  prompt: string;
  isEligible: (card: GameCard) => boolean;
  onSelect: (targetInstanceId: string) => void;
  onCancel: () => void;
};
const [targeting, setTargeting] = useState<TargetingRequest | null>(null);
```

- [ ] **Step 12.2: Expose `setTargeting` to descendants**

CardContextMenu is rendered from within this canvas (or a child component). The simplest wiring: pass `setTargeting` as an additional prop on the CardContextMenu render, or attach it to the existing `actions` object as `actions.beginTargeting = setTargeting`. Choose whichever matches the existing pattern in this file — the goal is to make `setTargeting` callable from inside CardContextMenu.

- [ ] **Step 12.3: Pass `isDimmed` and `targetingMode` props to every `GameCardNode`**

Find every `<GameCardNode ... />` render site in this file (search for `<GameCardNode`). Add to each:

```tsx
<GameCardNode
  // ...existing props...
  isDimmed={!!targeting && !targeting.isEligible(card)}
  targetingMode={
    targeting
      ? {
          isEligible: targeting.isEligible(card),
          onSelect: () => {
            targeting.onSelect(card.instanceId);
            setTargeting(null);
          },
        }
      : undefined
  }
/>
```

- [ ] **Step 12.4: Render the overlay banner**

At the JSX root of the canvas (outside the `<Stage>`, alongside other modals), add:

```tsx
{targeting && (
  <TargetCardOverlay
    prompt={targeting.prompt}
    onCancel={() => {
      targeting.onCancel();
      setTargeting(null);
    }}
  />
)}
```

- [ ] **Step 12.5: Type-check**

```bash
npx tsc --noEmit
```

- [ ] **Step 12.6: Commit**

```bash
git add app/goldfish/components/GoldfishCanvas.tsx
git commit -m "Goldfish canvas: wire targeting state, dim+route per-card, render banner"
```

---

### Task 13: Mirror the same wiring in `MultiplayerCanvas`

**Files:**
- Modify: `app/play/components/MultiplayerCanvas.tsx`

- [ ] **Step 13.1: Repeat Steps 12.1–12.6 in `MultiplayerCanvas.tsx`**

Same structure: add `targeting` state, expose `setTargeting`, pass `isDimmed`/`targetingMode` to every `<GameCardNode>` render site, render `<TargetCardOverlay>` at the JSX root.

- [ ] **Step 13.2: Type-check + commit**

```bash
npx tsc --noEmit
git add app/play/components/MultiplayerCanvas.tsx
git commit -m "Multiplayer canvas: wire targeting state, dim+route per-card, render banner"
```

---

## Phase 5 — Wire menu + multiplayer actions

### Task 14: Add multiplayer `useGameState` wrappers

**Files:**
- Modify: `app/play/hooks/useGameState.ts`

- [ ] **Step 14.1: Extend the `GameActions` interface**

Find the `GameActions` interface (around line 120, where `executeCardAbility` is declared). Add:

```ts
  imitateLostSoul: (sourceInstanceId: string, targetInstanceId: string) => void;
  stopImitatingLostSoul: (sourceInstanceId: string) => void;
```

- [ ] **Step 14.2: Add the wrappers**

Find the `executeCardAbility = useCallback(...)` definition around line 646. Add two siblings:

```ts
  const imitateLostSoul = useCallback(
    (sourceInstanceId: string, targetInstanceId: string) => {
      conn?.reducers.imitateLostSoul({
        gameId,
        sourceInstanceId: BigInt(sourceInstanceId),
        targetInstanceId: BigInt(targetInstanceId),
      });
    },
    [conn, gameId],
  );

  const stopImitatingLostSoul = useCallback(
    (sourceInstanceId: string) => {
      conn?.reducers.stopImitatingLostSoul({
        gameId,
        sourceInstanceId: BigInt(sourceInstanceId),
      });
    },
    [conn, gameId],
  );
```

- [ ] **Step 14.3: Include them in the returned actions object**

Find the actions-object return (around line 882, where `executeCardAbility` is listed). Add the two new entries.

- [ ] **Step 14.4: Type-check + commit**

```bash
npx tsc --noEmit
git add app/play/hooks/useGameState.ts
git commit -m "Multiplayer: imitateLostSoul + stopImitatingLostSoul wrappers"
```

---

### Task 15: Special-case the menu for `imitate_lost_soul` + render "Stop Imitating"

**Files:**
- Modify: `app/shared/components/CardContextMenu.tsx`

- [ ] **Step 15.1: Add a click branch for `imitate_lost_soul` inside the abilities `.map()`**

In the `<button onClick={...}>` at line 288–292, branch on `ability.type`:

```tsx
onClick={() => {
  if (disabled) return;
  if (ability.type === 'imitate_lost_soul') {
    actions.beginTargeting?.({
      prompt: 'Click a Lost Soul to imitate',
      isEligible: (c) => isLostSoul(c) && c.zone === 'land-of-bondage',
      onSelect: (targetId) => {
        actions.imitateLostSoul?.(card.instanceId, targetId);
      },
      onCancel: () => {},
    });
  } else {
    actions.executeCardAbility?.(card.instanceId, index);
  }
  onClose();
}}
```

`isLostSoul` is already imported in this file (line ~15). `beginTargeting` is the action exposed by the canvas (Task 12.2 / 13.1). `imitateLostSoul` is the new action (Tasks 8 + 14).

- [ ] **Step 15.2: Add the "Stop Imitating" button after the `.map()`**

Immediately after the closing `})}` of the abilities `.map()` (around line 299), but still inside the outer `{hasAbilities && (<>...</>)}` block, add a sibling button:

```tsx
{(card.imitatingName ?? '') !== '' && (
  <button
    style={itemStyle}
    onClick={() => {
      actions.stopImitatingLostSoul?.(card.instanceId);
      onClose();
    }}
    onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--gf-hover)'; }}
    onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
  >
    Stop Imitating
  </button>
)}
```

Note: this button shows whenever the card has `imitatingName` set, regardless of which type the ability is. That's intentional — only Imitate Souls have the variant registered, so `hasAbilities` is already true for them.

- [ ] **Step 15.3: Extend the `GameActions` type used by this menu**

Find the `actions` prop type definition (search for `actions:` in this file). Add the new optional methods:

```ts
  imitateLostSoul?: (sourceInstanceId: string, targetInstanceId: string) => void;
  stopImitatingLostSoul?: (sourceInstanceId: string) => void;
  beginTargeting?: (req: {
    prompt: string;
    isEligible: (card: GameCard) => boolean;
    onSelect: (targetInstanceId: string) => void;
    onCancel: () => void;
  }) => void;
```

(The shared GameActions interface lives in `app/play/hooks/useGameState.ts`. Goldfish has its own actions structure — both must expose these methods for the menu to work in both contexts.)

- [ ] **Step 15.4: Verify in the browser that both menu items appear**

Start the dev server. Open goldfish with a deck containing both Imitate Lost Soul variants. Draw one to LoB. Right-click it. Confirm "Imitate..." is the first menu item. Don't click it yet (next phase tests the full flow).

```bash
npm run dev
```

Expected: menu shows "Imitate..." for the Imitate card. Other cards (e.g. a regular Lost Soul) show no "Imitate..." or "Stop Imitating" item.

- [ ] **Step 15.5: Type-check + commit**

```bash
npx tsc --noEmit
git add app/shared/components/CardContextMenu.tsx
git commit -m "CardContextMenu: route imitate_lost_soul to targeting, add Stop Imitating button"
```

---

## Phase 6 — Chat log + manual QA

### Task 16: ChatPanel renderers for the two new action types

**Files:**
- Modify: `app/play/components/ChatPanel.tsx`

- [ ] **Step 16.1: Add the two new cases to `formatActionType`**

Find `formatActionType` (line ~141). Add cases that match the pattern of existing handlers (search for `case 'SPAWN_TOKEN'` for an analogue):

```tsx
case 'IMITATE_LOST_SOUL': {
  try {
    const { targetCardName, label, hasArt } = JSON.parse(payload ?? '{}');
    const short = label || targetCardName;
    return (
      <span>
        imitated <strong>{short}</strong>
        {hasArt ? '' : ' (no art)'}
      </span>
    );
  } catch {
    return <span>imitated a Lost Soul</span>;
  }
}

case 'STOP_IMITATING_LOST_SOUL':
  return <span>stopped imitating</span>;
```

- [ ] **Step 16.2: Commit**

```bash
git add app/play/components/ChatPanel.tsx
git commit -m "ChatPanel: render IMITATE_LOST_SOUL / STOP_IMITATING_LOST_SOUL action log"
```

---

### Task 17: Manual QA — goldfish

**Files:** none (verification only)

- [ ] **Step 17.1: Start the dev server**

```bash
npm run dev
```

- [ ] **Step 17.2: Goldfish — golden path with art**

Load a deck containing both Imitate Lost Souls AND at least one named NT soul that has art (e.g. `Lost Soul "Awake"`, `Lost Soul "Forsaken"`). Cycle Imitate Souls to LoB by drawing. Cycle the named soul to LoB.

Right-click an Imitate Soul. The menu shows "Imitate..." as the first item.

Click "Imitate...". The banner appears at the top of the canvas ("Click a Lost Soul to imitate · Esc to cancel · Cancel"). All non-LoB Lost Souls and non-Lost-Soul cards are dimmed. Cards in LoB that are NOT Lost Souls are dimmed.

Click the Awake / Forsaken / etc. card. The banner disappears. The Imitate Soul's art swaps to the corresponding image from `/imitate-souls/cards/`. No label overlay appears.

Right-click the (now visually swapped) Imitate Soul. The menu shows "Imitate..." AND "Stop Imitating".

Click "Stop Imitating". The art reverts to the original Imitate art. The "Stop Imitating" item is no longer shown.

- [ ] **Step 17.3: Goldfish — fallback path (no art)**

Repeat with a generic verse-only NT soul that has NO art in `IMITATE_SOUL_IMAGES` (e.g. `Lost Soul Matthew 19:23 (Speed Bump)` if present in deck, or any other generic NT soul).

Right-click Imitate → "Imitate..." → click the verse-only soul. The banner disappears. The Imitate Soul's ART does NOT change, but a small black bar with white text appears at the bottom showing the simplified name (e.g. "Speed Bump"). Right-click → "Stop Imitating" → label disappears.

- [ ] **Step 17.4: Goldfish — Escape and Cancel**

Trigger targeting. Press Escape. Banner disappears, no state change. Trigger again. Click the "Cancel" button in the banner. Same outcome.

- [ ] **Step 17.5: Goldfish — re-imitate cycle**

While currently imitating Awake (image swapped), right-click → "Imitate..." → click a different soul (e.g. Forsaken). Confirm the image updates to the new target's art. No state from the previous imitation persists.

---

### Task 18: Manual QA — multiplayer

**Files:** none (verification only)

- [ ] **Step 18.1: Open two browsers**

Open two browser windows (one regular, one incognito). Sign in as two different users. Start a multiplayer game between them.

- [ ] **Step 18.2: Verify the swap syncs both ways**

In browser A, draw an Imitate Lost Soul to LoB. Have browser B draw a named NT soul (e.g. Awake) to its LoB. In browser A, right-click the Imitate Soul → "Imitate..." → click browser B's Awake.

Confirm in browser A: art swaps. Confirm in browser B: A's Imitate Soul renders with the swapped art too.

- [ ] **Step 18.3: Verify ownership enforcement**

In browser B, right-click browser A's Imitate Soul. The "Imitate..." menu item should be **disabled** (per the existing `isOwnedByLocalPlayer` gate at CardContextMenu line 272). If it's not disabled, that's a regression — flag it.

- [ ] **Step 18.4: Verify chat log entries appear in both browsers**

Both browsers should show "Player X imitated **Awake**" in the chat log. After Stop Imitating, both should show "Player X stopped imitating".

---

## Verification checklist

- [ ] Parity tests pass: `npx vitest run lib/cards/__tests__/cardAbilities.test.ts`
- [ ] Goldfish reducer tests pass: `npx vitest run app/goldfish/state/__tests__/gameReducer.customAbilities.test.ts`
- [ ] Full type-check passes: `npx tsc --noEmit`
- [ ] SpacetimeDB module publishes successfully and bindings regenerated
- [ ] Manual goldfish QA (Task 17) — all five sub-steps pass
- [ ] Manual multiplayer QA (Task 18) — all four sub-steps pass
