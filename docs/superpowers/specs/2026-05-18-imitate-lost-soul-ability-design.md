# Imitate Lost Soul — Right-Click Ability

**Status:** Draft
**Date:** 2026-05-18
**Scope:** Goldfish + Multiplayer (SpacetimeDB)

## Summary

Add a right-click ability to the two `Lost Soul "Imitate" [III John 1:11]`
variants. Right-clicking the card in play and selecting "Imitate..." enters
a click-to-target mode where the player picks any Lost Soul in either
player's Land of Bondage. The Imitate card's art is swapped to the chosen
soul's bespoke art when available (under `public/imitate-souls/cards/`),
falling back to a text label overlay when no art exists. A second menu
item, "Stop Imitating", reverts the card to its canonical art and clears
the label. The cycle is repeatable.

## User flow

1. Player right-clicks their Imitate Lost Soul in Land of Bondage.
2. Context menu shows "Imitate..." at the top. If the card is currently
   imitating, "Stop Imitating" appears below it.
3. Clicking "Imitate..." closes the menu and enters target-selection mode:
   - The canvas dims everything except eligible Lost Souls (those in either
     Land of Bondage).
   - A banner reads "Click a Lost Soul to imitate · Esc to cancel".
4. Player clicks an eligible Lost Soul. Targeting mode exits.
5. The Imitate card mutates:
   - If the target's `cardName` is in `IMITATE_SOUL_IMAGES`: `cardImgFile`
     is replaced with the new art path; `imitatingName` is left empty.
   - Otherwise: `cardImgFile` is unchanged; `imitatingName` is set to the
     simplified name. The canvas renders a small text label overlay.
6. Player can right-click → "Imitate..." again to pick a different soul
   (cycle repeats), or right-click → "Stop Imitating" to revert.

## Architecture

Mirrors the existing custom-ability system documented in
`docs/superpowers/specs/2026-04-18-card-custom-abilities-design.md` and
the `add-card-ability` skill (Mode B1 — new reusable ability variant).

| Layer | File | Change |
|-------|------|--------|
| Schema (server) | `spacetimedb/src/schema.ts` | Add `imitatingName: t.string().default('')` to `CardInstance`. |
| Schema (client) | `app/shared/types/gameCard.ts` | Add `imitatingName?: string` to `GameCard`. |
| Ability registry | `lib/cards/cardAbilities.ts` + `spacetimedb/src/cardAbilities.ts` | New variant `imitate_lost_soul`. Register both Imitate cards. New exported map `IMITATE_SOUL_IMAGES`. Tiny `IMITATE_ORIGINAL_IMG` map for revert (server-side only — client uses `findCard()`). |
| Goldfish reducer | `app/goldfish/state/gameReducer.ts` | New helpers `imitateLostSoulInState` + `stopImitatingInState`. Wire into `EXECUTE_CARD_ABILITY` switch. New action types may be needed to carry `targetInstanceId`. |
| Server reducers | `spacetimedb/src/index.ts` | `execute_card_ability` switch handles `imitate_lost_soul` but the existing reducer signature only knows the source card. Either (a) extend `execute_card_ability` with an optional `targetInstanceId`, or (b) add dedicated `imitate_lost_soul` and `stop_imitating_lost_soul` reducers. **Decision: dedicated reducers** (see Reducer signatures below). |
| Context menu | `app/shared/components/CardContextMenu.tsx` | Render "Imitate..." for `imitate_lost_soul` abilities. Render "Stop Imitating" when `card.imitatingName !== ''`. |
| Targeting UI | New file: `app/shared/components/TargetCardOverlay.tsx` + new context `app/shared/components/TargetingContext.tsx` (or hook). | Generic overlay that takes a predicate `(card) => boolean` for eligibility and resolves a target instanceId. Reusable for future targeting abilities. |
| Canvas render | `app/goldfish/components/GoldfishCanvas.tsx` + `app/play/components/*` (multiplayer canvas) | When `card.imitatingName` is set, render a small label overlay on the card. When targeting mode is active, apply dim/highlight styling. |
| Chat log | `app/play/components/ChatPanel.tsx` | New `formatActionType` cases for `IMITATE_LOST_SOUL` and `STOP_IMITATING_LOST_SOUL` actions. |

## Image and name registry

A new exported map in BOTH `lib/cards/cardAbilities.ts` and
`spacetimedb/src/cardAbilities.ts`, keyed by exact `GameCard.cardName`:

```ts
export const IMITATE_SOUL_IMAGES: Record<string, string> = {
  // Awake (single variant)
  'Lost Soul "Awake" [Ephesians 5:14 - TPC]':              '/imitate-souls/cards/awake.jpg',

  // Crowds (two variants → two images)
  'Lost Soul "Crowds" [Luke 5:15] [2016 - Local]':         '/imitate-souls/cards/crowds_local.jpg',
  'Lost Soul "Crowds" [Luke 5:15] [2025 - Worker]':        '/imitate-souls/cards/crowds_worker.jpg',

  // Defiled
  'Lost Soul "Defiled" [Mark 7:21-22]':                    '/imitate-souls/cards/defiled.jpg',

  // Destruction (both variants → same image)
  'Lost Soul "Destruction" [Hebrews 10:39]':               '/imitate-souls/cards/destruction.jpg',
  'Lost Soul "Destruction" [Hebrews 10:39] [AB - CoW]':    '/imitate-souls/cards/destruction.jpg',

  // Dull
  'Lost Soul "Dull" [Hebrews 5:11]':                       '/imitate-souls/cards/dull.jpg',
  'Lost Soul "Dull" [Hebrews 5:11] [AB - CoW]':            '/imitate-souls/cards/dull.jpg',

  // Forsaken
  'Lost Soul "Forsaken" [Hebrews 10:25]':                  '/imitate-souls/cards/forsaken.jpg',
  'Lost Soul "Forsaken" [Hebrews 10:25] [AB - CoW]':       '/imitate-souls/cards/forsaken.jpg',

  // Gain
  'Lost Soul "Gain" [Jude 1:16]':                          '/imitate-souls/cards/gain.jpg',
  'Lost Soul "Gain" [Jude 1:16]  [AB - RoJ]':              '/imitate-souls/cards/gain.jpg',

  // Galileans
  'Lost Soul "Galileans" [Luke 13:2]':                     '/imitate-souls/cards/galileans.jpg',

  // Harvest (two variants → two images)
  'Lost Soul "Harvest" [John 4:35]':                       '/imitate-souls/cards/harvest.jpg',
  'Lost Soul "Harvest" [John 4:35] [2023 - 2nd Place]':    '/imitate-souls/cards/harvest_2nd.jpg',

  // Humble (three variants — base & AB → humble.jpg, 2022 promo → humble_3rd.jpg)
  'Lost Soul "Humble" [James 4:6 / Proverbs 3:34 - RoJ]':  '/imitate-souls/cards/humble.jpg',
  'Lost Soul "Humble" [James 4:6 / Proverbs 3:34]  [AB - RoJ]': '/imitate-souls/cards/humble.jpg',
  'Lost Soul "Humble" [James 4:6 / Proverbs 3:34] [2022 - 3rd Place]': '/imitate-souls/cards/humble_3rd.jpg',

  // Imitate — yes, an Imitate soul can imitate another Imitate soul (silly but
  // gameplay-legal). Maps to imitate.jpg so it doesn't accidentally fall back.
  'Lost Soul "Imitate" [III John 1:11]':                   '/imitate-souls/cards/imitate.jpg',
  'Lost Soul "Imitate" [III John 1:11]  [AB - RoJ]':       '/imitate-souls/cards/imitate.jpg',

  // Lawless (three variants → one image)
  'Lost Soul "Lawless" [Hebrews 12:8]':                    '/imitate-souls/cards/lawless.jpg',
  'Lost Soul "Lawless" [Hebrews 12:8] [2021 - 1st Place]': '/imitate-souls/cards/lawless.jpg',
  'Lost Soul "Lawless" [Hebrews 12:8] [AB - CoW]':         '/imitate-souls/cards/lawless.jpg',

  // Open Hand
  'Lost Soul "Open Hand" [Hebrews 4:13]':                  '/imitate-souls/cards/open_hand.jpg',
  'Lost Soul "Open Hand" [Hebrews 4:13] [AB - CoW]':       '/imitate-souls/cards/open_hand.jpg',

  // Rejoice
  'Lost Soul "Rejoice" [Luke 15:6 - J]':                   '/imitate-souls/cards/rejoice.jpg',

  // Retribution
  'Lost Soul "Retribution" [Acts 16:22]':                  '/imitate-souls/cards/retribution.jpg',

  // Revealer (named, John 3:20 — distinct from generic Romans 3:23 Revealer)
  'Lost Soul "Revealer" [John 3:20]':                      '/imitate-souls/cards/revealer.jpg',

  // Salty
  'Lost Soul "Salty" [Matthew 5:13]':                      '/imitate-souls/cards/salty.jpg',

  // Shut Door (named, LR — distinct from generic Luke 13:25 Shut Door)
  'Lost Soul "Shut Door" [Luke 13:25 - LR]':               '/imitate-souls/cards/shut_door.jpg',

  // Tempter
  'Lost Soul "Tempter" [II Timothy 3:6-7 - TPC]':          '/imitate-souls/cards/tempter.jpg',

  // The First
  'Lost Soul "The First" [Luke 13:30]':                    '/imitate-souls/cards/the_first.jpg',

  // Undesirables (image filename is misspelled "undesireables" — keep as-is)
  'Lost Soul "Undesirables" [Luke 14:13]':                 '/imitate-souls/cards/undesireables.jpg',
};
```

The map is intentionally exact-cardName-keyed (no fuzzy matching) for two
reasons: it's the same key shape used by `CARD_ABILITIES`, and it lets us
deliberately steer ambiguous names like "Revealer" and "Shut Door" to the
right art rather than the generic verse-only sibling.

**Whitespace warning.** Three keys contain a literal **double space** that
must be preserved byte-for-byte (the source carddata has the two spaces
between the verse bracket and the AB bracket):

```
'Lost Soul "Gain" [Jude 1:16]  [AB - RoJ]'
'Lost Soul "Humble" [James 4:6 / Proverbs 3:34]  [AB - RoJ]'
'Lost Soul "Imitate" [III John 1:11]  [AB - RoJ]'
```

One accidental normalize-spaces pass silently breaks registration.

The corresponding `IMITATE_ORIGINAL_IMG` server-side map for revert:

```ts
// spacetimedb/src/cardAbilities.ts only
export const IMITATE_ORIGINAL_IMG: Record<string, string> = {
  'Lost Soul "Imitate" [III John 1:11]':              '23-Lost-Soul-Imitate-R',
  'Lost Soul "Imitate" [III John 1:11]  [AB - RoJ]':  'RoJ_AB_N23-Lost-Soul-Imitate-R',
};
```

Client-side revert uses `findCard(source.cardName).imgFile` directly — no
duplicate needed.

## Simplified-name helper

A pure helper in `lib/cards/cardAbilities.ts` (duplicated in the
spacetimedb copy):

```ts
/**
 * Extracts a short display string from a Lost Soul cardName for the
 * "imitating: X" overlay label.
 *
 * Priority:
 *   1. Quoted name → e.g. `Lost Soul "Awake" [...]` → `Awake`
 *   2. First parenthetical → `Lost Soul Luke 13:25 (Shut Door)` → `Shut Door`
 *   3. Stripped fallback → drop `Lost Soul ` prefix, trim
 */
export function simplifyLostSoulName(cardName: string): string {
  const quoted = cardName.match(/"([^"]+)"/);
  if (quoted) return quoted[1];
  const paren = cardName.match(/\(([^)]+)\)/);
  if (paren) return paren[1];
  return cardName.replace(/^Lost Soul\s+/, '').trim();
}
```

The reducer **always** sets `imitatingName` to the simplified name when
imitating, regardless of whether art exists. This makes `imitatingName`
the single source of truth for "is currently imitating", which the menu
and revert logic key off of.

The label, however, is fallback-only: `GameCardNode` only renders the
label when `imitatingName !== ''` **AND** `cardImgFile` still equals the
canonical Imitate imgFile (i.e. no art swap happened). The label-gating
check uses `findCard(card.cardName)?.imgFile` (cheap, pure lookup) so the
canvas doesn't need a separate "had art" boolean.

## Schema change

**SpacetimeDB CardInstance** — add one column:

```ts
// spacetimedb/src/schema.ts → CardInstance columns
imitatingName: t.string().default(''),
```

Default `''` makes the migration safe — pre-existing rows behave as
"not imitating". No data migration needed beyond the schema publish.

**Client GameCard** — add the matching field:

```ts
// app/shared/types/gameCard.ts
export interface GameCard {
  // ...existing fields...
  imitatingName?: string;  // '' or undefined = not imitating
}
```

Optional on the client so existing serialized states (if any) continue to
parse. The reducer reads `card.imitatingName || ''` for any comparison.

## Ability variant

Add to the union in BOTH registry files:

```ts
export type CardAbility = AbilityBase & (
  | { type: 'spawn_token'; ... }
  // ...existing variants...
  | { type: 'imitate_lost_soul' }
);
```

The variant carries no fields — the target instanceId is supplied at
dispatch time, not registry time.

Registry entries:

```ts
// CARD_ABILITIES — both registry files
'Lost Soul "Imitate" [III John 1:11]':              [{ type: 'imitate_lost_soul' }],
'Lost Soul "Imitate" [III John 1:11]  [AB - RoJ]':  [{ type: 'imitate_lost_soul' }],
```

Source zones default to the standard set
(`territory`, `land-of-bondage`, `land-of-redemption`). Lost Souls live in
LoB once "played" so the default works without an override.

`abilityLabel()` case:

```ts
case 'imitate_lost_soul':
  return 'Imitate...';
```

## Reducer signatures

The existing `execute_card_ability` reducer takes
`(gameId, cardInstanceId, abilityIndex)` — no slot for a target. We have
three options, and the design picks the third:

| Option | Pros | Cons |
|--------|------|------|
| Extend `execute_card_ability` with optional `targetInstanceId: bigint?` | Single dispatch path | Pollutes the signature for one variant; couples ability shapes to the dispatch arg list |
| `type: 'custom'` with dedicated reducers | No union change | Loses exhaustive switch checks; harder to discover |
| **Dedicated reducers** `imitate_lost_soul` + `stop_imitating_lost_soul` | Tight, typed args; client wraps both with thin helpers in `useGameState` | Two extra reducers in `index.ts`; menu UI has to special-case the variant to route correctly |

**Decision: dedicated reducers.** The client wrapper in `useGameState`
inspects the variant client-side (already does for `custom`) and routes
`imitate_lost_soul` to a different code path that first runs the
targeting overlay, then calls the dedicated reducer.

### `imitate_lost_soul(gameId, sourceInstanceId, targetInstanceId)` (server)

```ts
export const imitate_lost_soul = spacetimedb.reducer(
  {
    gameId: t.u64(),
    sourceInstanceId: t.u64(),
    targetInstanceId: t.u64(),
  },
  (ctx, { gameId, sourceInstanceId, targetInstanceId }) => {
    // Validate ownership + zones
    const player = findPlayerBySender(ctx, gameId);
    const source = ctx.db.CardInstance.id.find(sourceInstanceId);
    if (!source || source.gameId !== gameId) throw new SenderError('Source not found');
    if (source.ownerId !== player.id) throw new SenderError('Not your card');
    if (!IMITATE_ORIGINAL_IMG[source.cardName]) {
      throw new SenderError('Source is not an Imitate Lost Soul');
    }
    const ABILITY_SOURCE_ZONES = ['territory', 'land-of-bondage', 'land-of-redemption'];
    if (!ABILITY_SOURCE_ZONES.includes(source.zone)) {
      throw new SenderError('Source must be in play');
    }

    // Validate target
    const target = ctx.db.CardInstance.id.find(targetInstanceId);
    if (!target || target.gameId !== gameId) throw new SenderError('Target not found');
    if (target.cardType !== 'Lost Soul') throw new SenderError('Target must be a Lost Soul');
    if (target.zone !== 'land-of-bondage') throw new SenderError('Target must be in a Land of Bondage');

    // Compute new state. imitatingName is ALWAYS set when imitating —
    // it's the single source of truth for "is currently imitating".
    // The label-gating in GameCardNode handles the fallback-only display.
    const newImg = IMITATE_SOUL_IMAGES[target.cardName] ?? source.cardImgFile;
    const newLabel = simplifyLostSoulName(target.cardName);

    // Commit (spread to avoid nulling other fields — see spacetimedb/CLAUDE.md)
    ctx.db.CardInstance.id.update({
      ...source,
      cardImgFile: newImg,
      imitatingName: newLabel,
    });

    // Log
    const game = ctx.db.Game.id.find(gameId);
    if (game) {
      logAction(
        ctx, gameId, player.id, 'IMITATE_LOST_SOUL',
        JSON.stringify({ targetCardName: target.cardName, label: newLabel, hasArt: newImg !== source.cardImgFile }),
        game.turnNumber, game.currentPhase,
      );
    }
  },
);
```

### `stop_imitating_lost_soul(gameId, sourceInstanceId)` (server)

```ts
export const stop_imitating_lost_soul = spacetimedb.reducer(
  { gameId: t.u64(), sourceInstanceId: t.u64() },
  (ctx, { gameId, sourceInstanceId }) => {
    const player = findPlayerBySender(ctx, gameId);
    const source = ctx.db.CardInstance.id.find(sourceInstanceId);
    if (!source || source.gameId !== gameId) throw new SenderError('Source not found');
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
        ctx, gameId, player.id, 'STOP_IMITATING_LOST_SOUL', '{}',
        game.turnNumber, game.currentPhase,
      );
    }
  },
);
```

### Goldfish equivalents

Mirror helpers `imitateLostSoulInState(state, sourceId, targetId)` and
`stopImitatingInState(state, sourceId)` in
`app/goldfish/state/gameReducer.ts`. Same validate → build → commit
pattern. Revert uses `findCard(source.cardName).imgFile` directly (no need
for a separate ORIGINAL_IMG map client-side).

Two new action types added to the `ActionType` union in
`app/shared/types/gameCard.ts`:

```ts
| 'IMITATE_LOST_SOUL'
| 'STOP_IMITATING_LOST_SOUL'
```

The matching `GameAction.payload` shape needs no new fields — existing
`cardInstanceId` (source) and a new optional `targetInstanceId` (already
fits as `warriorInstanceId` does today, or add an explicit
`targetInstanceId?: string`).

### Dispatch routing changes (CRITICAL)

The existing dispatch flow is: `CardContextMenu` calls
`actions.executeCardAbility?.(card.instanceId, index)` unconditionally
for every ability (`CardContextMenu.tsx:~290`), which routes to the
generic `execute_card_ability` server reducer + `EXECUTE_CARD_ABILITY`
goldfish action. `imitate_lost_soul` bypasses this path entirely because
it needs a target. Four edits to wire it correctly:

1. **CardContextMenu special-case.** In the `abilities.map()` loop,
   branch on `ability.type`. When `'imitate_lost_soul'`, the button's
   `onClick` calls `setTargeting({...})` (see Targeting flow). Other
   types are unchanged.

2. **Goldfish exhaustive stub.** Add to the
   `EXECUTE_CARD_ABILITY` inner switch in
   `app/goldfish/state/gameReducer.ts`:
   ```ts
   case 'imitate_lost_soul':
     // Targeting variant — dispatched via IMITATE_LOST_SOUL with a target.
     return state;
   ```
   This is for exhaustiveness only. The real path goes through new
   `IMITATE_LOST_SOUL` and `STOP_IMITATING_LOST_SOUL` actions.

3. **Server exhaustive stub.** Add to the `execute_card_ability`
   switch in `spacetimedb/src/index.ts` (precedent:
   `three_nails_reset` at `index.ts:~3345`):
   ```ts
   case 'imitate_lost_soul':
     throw new SenderError('imitate_lost_soul is dispatched directly by the client');
   ```

4. **`useGameState` wrappers.** This codebase has **no existing
   `type: 'custom'` client-routing branch** — the comment at
   `app/play/hooks/useGameState.ts:~648` notes that "v1 registry has no
   custom entries; when the first custom ability ships, branch here."
   This feature ships the first such ability, so add two new wrappers
   alongside the existing `executeCardAbility`:

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

   Both go on the `GameActions` interface alongside `executeCardAbility`.
   The goldfish equivalent (`gameActions.ts`) gets parallel
   action-creator helpers that dispatch `IMITATE_LOST_SOUL` and
   `STOP_IMITATING_LOST_SOUL`.

## Targeting flow (client)

**The canvas is Konva (`react-konva`), not DOM.** Cards render as
`<Group>` + `<Rect>` + `<KonvaImage>` primitives inside a `<Stage>` (see
`GoldfishCanvas.tsx`, `MultiplayerCanvas.tsx`, `GameCardNode.tsx`).
`data-*` attributes do not exist; DOM-level `onClickCapture` will not see
card clicks. All design choices below reflect this.

### State shape

Targeting is a single piece of state owned by the canvas component (or
hoisted to its parent if multiple canvases need to share it):

```ts
type TargetingRequest = {
  prompt: string;                                  // banner text
  isEligible: (card: GameCard) => boolean;         // predicate
  onSelect: (targetInstanceId: string) => void;
  onCancel: () => void;
};

const [targeting, setTargeting] = useState<TargetingRequest | null>(null);
```

This mirrors the existing modal idiom in this codebase
(`DeckSearchModal`, `DeckExchangeModal`, `OpponentBrowseModal` etc. — all
use `useState<X | null>` + conditional JSX + `onClose` callbacks). No
React context, no imperative promise API.

### Banner overlay

`<TargetCardOverlay>` is a sibling component rendered alongside the
`<Stage>` (or as a fixed-position div over it — it's pure UI chrome, can
be DOM):

```tsx
{targeting && (
  <TargetCardOverlay
    prompt={targeting.prompt}
    onCancel={() => { targeting.onCancel(); setTargeting(null); }}
  />
)}
```

It renders a fixed-position banner with the prompt, an "Esc to cancel"
hint, AND a visible "Cancel" button (touch users have no Escape key —
`GameCardNode` already wires `onTap`, so the rest of the targeting flow
works on touch; only the cancel affordance needs the button).

Escape key cancellation: `useEffect(() => { document.addEventListener('keydown', ...); return () => document.removeEventListener(...); }, [targeting])` on the canvas, gated by `targeting !== null`.

### Card-click interception (Konva)

Two equally clean options for routing card clicks during targeting:

1. **Prop drilling.** `GameCardNode` accepts a new optional prop
   `targetingMode?: { isEligible: boolean; onSelect: () => void }`. The
   canvas's existing per-card render passes
   `targetingMode={targeting ? { isEligible: targeting.isEligible(card), onSelect: () => targeting.onSelect(card.instanceId) } : undefined}`.
   Inside `GameCardNode`, `handleClick`/`handleTap` checks
   `targetingMode` first and routes to `onSelect()` if eligible, swallows
   otherwise.
2. **Stage-level listener.** `stageRef.current.on('click', ...)`. Walk
   `e.target` up to its enclosing `Group` and read a custom Konva attr
   (`card.setAttr('cardInstanceId', ...)` set when the card mounts).

**Decision: option 1 (prop drilling).** It matches how Konva click
handling already works in `GameCardNode`, doesn't require introducing
custom Konva attrs, and keeps targeting state colocated with the canvas
that owns it. The extra prop adds ~3 lines per card-render site.

### Dimming (Konva)

Pass an `isDimmed` prop to `GameCardNode`:

```tsx
<GameCardNode
  card={card}
  isDimmed={targeting !== null && !targeting.isEligible(card)}
  targetingMode={targeting ? { ... } : undefined}
  // ...
/>
```

Inside `GameCardNode`, apply `opacity={isDimmed ? 0.3 : 1}` to the
top-level `<Group>`. No CSS, no z-index. Konva handles compositing.

### Menu → targeting hand-off

In `CardContextMenu.tsx`, the "Imitate..." button calls:

```ts
setTargeting({
  prompt: 'Click a Lost Soul to imitate',
  isEligible: (c) => isLostSoul(c) && c.zone === 'land-of-bondage',
  onSelect: (targetId) => {
    actions.imitateLostSoul(card.instanceId, targetId);
    setTargeting(null);
  },
  onCancel: () => setTargeting(null),
});
```

`isLostSoul` is the existing helper (`app/goldfish/state/gameReducer.ts:19`,
also in `CardContextMenu.tsx:15`); it handles the `LS` / `Lost Soul` /
contains-`lost soul` variants and reads `card.type` (the client field is
`type`, not `cardType`). Reuse, don't duplicate the equality check.

`setTargeting` is exposed via a prop or by hoisting the state to a
canvas-level provider. Since `CardContextMenu` is rendered as a child of
the canvas, prop drilling one callback is fine.

## Label overlay rendering (Konva)

When `card.imitatingName !== ''`, render the label as Konva primitives
**inside `GameCardNode`'s existing `<Group>`** — not as a separate React
component, not as a JSX `<div>`. JSX outside Konva primitives inside a
`<Stage>` is silently dropped by `react-konva`.

```tsx
// Inside GameCardNode's <Group>, after the card <Image>:
const showImitateLabel =
  !!card.imitatingName &&
  card.cardImgFile === findCard(card.cardName)?.imgFile;  // fallback-only

{showImitateLabel && (
  <>
    <Rect
      x={0}
      y={cardHeight - LABEL_HEIGHT}
      width={cardWidth}
      height={LABEL_HEIGHT}
      fill="rgba(0, 0, 0, 0.7)"
    />
    <Text
      x={0}
      y={cardHeight - LABEL_HEIGHT}
      width={cardWidth}
      height={LABEL_HEIGHT}
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
)}
```

Constants (`LABEL_HEIGHT ≈ 18px` at default card scale) live alongside
existing `GameCardNode` size constants. No Tailwind classes — Konva
takes pixel-typed props directly. Both goldfish and multiplayer canvases
get the label for free because both render cards through `GameCardNode`.

## Menu rendering

`CardContextMenu.tsx` currently renders each ability as a plain
`<button style={itemStyle}>...</button>` and unconditionally calls
`actions.executeCardAbility?.(card.instanceId, index)` (line ~290). The
`<MenuItem>` component referenced in earlier drafts does not exist —
follow the existing pattern.

Two edits to that file:

1. **Special-case the dispatch.** In the abilities `.map()`, branch on
   `ability.type`. When it's `'imitate_lost_soul'`, the click handler
   calls `setTargeting({ ... })` (see Targeting flow section) instead of
   `actions.executeCardAbility`. All other ability types continue to
   route through `executeCardAbility` unchanged.

2. **Render "Stop Imitating" as a sibling button.** After the
   `.map()`, conditionally render a second `<button style={itemStyle}>`
   when the card is currently imitating:

```tsx
{(card.imitatingName ?? '') !== '' && (
  <button
    style={itemStyle}
    onClick={() => { actions.stopImitatingLostSoul?.(card.instanceId); onClose(); }}
  >
    Stop Imitating
  </button>
)}
```

The single source of truth for "is currently imitating" is
`(card.imitatingName ?? '') !== ''`. Avoid a secondary `cardImgFile` vs
canonical comparison — `imitatingName` is set on every imitation
(whether art-swap or label-fallback path) and cleared on revert, so it's
the cleanest test.

## Edge cases

| Case | Behavior |
|------|----------|
| Target is the Imitate card itself | Allowed — `IMITATE_SOUL_IMAGES` includes both Imitate variants → `imitate.jpg`. No-op effect but doesn't crash. |
| Target Lost Soul not in `IMITATE_SOUL_IMAGES` | Set `imitatingName` to simplified name; do NOT mutate `cardImgFile`. Label renders. |
| Re-imitate while already imitating | Reducer overwrites both fields — new target's data fully replaces. No stacking. |
| Card moves out of Land of Bondage | **Open question.** Outline color clears on zone change; should imitation also? Default: NO — imitation persists across zones until explicit revert. (Lost Souls rarely leave LoB except via specific abilities, and persistence matches the "I imitate X this turn" intent.) |
| Escape during targeting | Targeting mode exits; no mutation. |
| Click on ineligible card during targeting | Click is swallowed; targeting stays active. |
| Two Imitate Souls in play, both imitating different things | Independent — each card's `imitatingName` + `cardImgFile` are per-instance. |
| Imitate card returns to soul-deck/discard then back to LoB | Field persists (server stores it). If we later add zone-change clearing, this needs explicit logic; for V1 it persists. |
| Multiplayer opponent's Imitate card | Opponent sees the swapped art + label in real time via SpacetimeDB subscription. Validation in the reducer enforces that the *acting* sender must own the source — opponents can't toggle each other's imitations. |

## Chat log

Two new action-type entries in `ChatPanel.tsx → formatActionType()`:

```ts
case 'IMITATE_LOST_SOUL': {
  const { targetCardName, label, hasArt } = JSON.parse(payload);
  const short = label || simplifyLostSoulName(targetCardName);
  return (
    <span>imitated <strong>{short}</strong>{hasArt ? '' : ' (no art)'}</span>
  );
}
case 'STOP_IMITATING_LOST_SOUL':
  return <span>stopped imitating</span>;
```

## Testing

- **Registry parity tests** (`lib/cards/__tests__/cardAbilities.test.ts`)
  — extend with explicit assertions:
  - `expect(spacetimebDbCopy.IMITATE_SOUL_IMAGES).toEqual(IMITATE_SOUL_IMAGES)`.
  - For every key in `IMITATE_SOUL_IMAGES`: `findCard(key)` returns truthy.
  - For every value: `fs.existsSync(path.join('public', value))` (or
    equivalent) — image file actually exists.
  - Both `Lost Soul "Imitate" [III John 1:11]` AND the AB variant appear
    in `CARD_ABILITIES` with `type: 'imitate_lost_soul'` in both copies.
  - For both Imitate variants in `IMITATE_ORIGINAL_IMG` (server file):
    `IMITATE_ORIGINAL_IMG[name] === findCard(name)?.imgFile` (drift
    detection between the hardcoded original-img map and the carddata).
- **`simplifyLostSoulName` unit tests**: covering quoted, parenthesized,
  and fallback cases — at minimum one per row of the txt list, plus an
  edge case like `Lost Soul "Has \"escaped\" quotes"` (probably none in
  carddata but worth one assertion).
- **Goldfish reducer tests**
  (`app/goldfish/state/__tests__/gameReducer.customAbilities.test.ts`):
  - Happy path: imitate a soul with art → cardImgFile changes, imitatingName empty.
  - Happy path: imitate a soul without art → cardImgFile unchanged, imitatingName set.
  - Stop imitating: clears imitatingName, restores cardImgFile from
    `findCard()`.
  - Validation: rejects non-Lost-Soul targets, non-LoB targets, foreign
    source ownership.
  - Re-imitate replaces existing state.
- **Targeting overlay tests**: unit-test `TargetingContext` resolves on
  click, rejects on Escape, rejects on click of ineligible card.
- **Manual QA**:
  - Open goldfish, draw an Imitate Soul to LoB, right-click → "Imitate..."
    → click another Lost Soul in LoB. Art swaps. Label absent if art
    exists; label present if no art.
  - Right-click again → "Stop Imitating" → reverts.
  - Two browser multiplayer: same flow, observe live sync.

## Out of scope

- Mechanically enforcing the imitated soul's special ability (the user's
  decision was "image only — cosmetic"). Players will manually trigger
  any rules effect via the original ability menus.
- Imitate cards in zones other than Land of Bondage. Source-zone
  allowlist excludes hand/deck/reserve/discard/banish/paragon/soul-deck.
- Auto-revert on zone change. Persist for V1; revisit if user reports
  surprising behavior.
- Animations on the swap. The image just changes in place.
- Targeting overlay on touch / mobile. Cursor-targeted UI is the V1
  assumption; mobile gets the same overlay but tap-to-select.
- Generalizing the registry to non-Lost-Soul imitation (e.g. cards that
  copy heroes). If/when that comes up, the overlay is reusable but the
  registry split would need rethinking.

## Open questions

None blocking. The zone-change-revert behavior in the edge-cases table
is the one judgement call worth flagging during implementation; default
is "persist" but easy to flip later.
