# Paragon Drawer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the sidebar "Paragon" zone in goldfish and multiplayer with a toggleable bottom drawer (pull-tab → full-card overlay) that shows the paragon at its native landscape aspect, scales to N players via tabs.

**Architecture:** A single shared DOM-overlay component (`ParagonDrawer.tsx`) mounted from both goldfish and multiplayer clients. Paragon data is a **string name**, not a card instance — goldfish reads it from `GameState.paragonName`, multiplayer reads it from a new `paragon: string` field on the SpacetimeDB `Player` row. The zone layout code drops its `isParagon` branch; sidebars are always 5 zones.

**Tech Stack:** Next.js, React, TypeScript, SpacetimeDB (schema + reducers), Konva/react-konva (unchanged), vitest.

**Spec:** `docs/superpowers/specs/2026-04-17-paragon-drawer-design.md`

---

## Pre-flight

- [ ] **Read the spec.** `docs/superpowers/specs/2026-04-17-paragon-drawer-design.md`.
- [ ] **Read the SpacetimeDB rules.** `spacetimedb/CLAUDE.md` — schema rules, reducer patterns, bindings regen workflow. **Required** before touching the schema.
- [ ] **Confirm the dev server is not running.** If it is, stop it. You'll restart it during manual verification.

---

## Task 1: SpacetimeDB schema — add `paragon` to `Player`

Add a `paragon` string field to the `Player` table so each player's paragon name is visible to the other player. Update the `create_game` and `join_game` reducers to accept and store it.

**Files:**
- Modify: `spacetimedb/src/schema.ts`
- Modify: `spacetimedb/src/index.ts`

- [ ] **Step 1: Add `paragon` column to the `Player` table.**

In `spacetimedb/src/schema.ts`, add a `paragon: t.string()` field to the columns object for `Player` (after `displayName`). Default to empty string (callers pass `''` when no paragon).

```ts
// Inside the Player table columns
identity: t.identity(),
seat: t.u64(),
deckId: t.string(),
displayName: t.string(),
paragon: t.string(),          // NEW — empty string when deck has no paragon
supabaseUserId: t.string(),
// ...rest unchanged
```

- [ ] **Step 2: Accept `paragon` in `create_game` reducer.**

In `spacetimedb/src/index.ts`, add `paragon: t.string()` to the reducer params schema for `create_game`, destructure it in the handler, and include it in the `Player.insert({ ... })` call.

```ts
export const create_game = spacetimedb.reducer(
  {
    code: t.string(),
    deckId: t.string(),
    displayName: t.string(),
    format: t.string(),
    supabaseUserId: t.string(),
    deckData: t.string(),
    isPublic: t.bool(),
    lobbyMessage: t.string(),
    paragon: t.string(),        // NEW
  },
  (ctx, { code, deckId, displayName, format, supabaseUserId, deckData, isPublic, lobbyMessage, paragon }) => {
    // ...existing code unchanged until Player.insert...

    const player = ctx.db.Player.insert({
      id: 0n,
      gameId: game.id,
      identity: ctx.sender,
      seat: 0n,
      deckId,
      displayName,
      paragon,                  // NEW
      supabaseUserId,
      isConnected: true,
      autoRouteLostSouls: true,
      handRevealed: false,
      reserveRevealed: false,
      pendingDeckData: deckData,
      revealedCards: '',
    });

    // ...rest unchanged
  }
);
```

- [ ] **Step 3: Accept `paragon` in `join_game` reducer.**

Same pattern — add `paragon: t.string()` to params and include in the `Player.insert`:

```ts
export const join_game = spacetimedb.reducer(
  {
    code: t.string(),
    deckId: t.string(),
    displayName: t.string(),
    supabaseUserId: t.string(),
    deckData: t.string(),
    paragon: t.string(),        // NEW
  },
  (ctx, { code, deckId, displayName, supabaseUserId, deckData, paragon }) => {
    // ...existing code unchanged until Player.insert...

    const player = ctx.db.Player.insert({
      id: 0n,
      gameId: game.id,
      identity: ctx.sender,
      seat: 1n,
      deckId,
      displayName,
      paragon,                  // NEW
      supabaseUserId,
      isConnected: true,
      autoRouteLostSouls: true,
      handRevealed: false,
      reserveRevealed: false,
      pendingDeckData: deckData,
      revealedCards: '',
    });

    // ...rest unchanged
  }
);
```

- [ ] **Step 4: Check for other `Player.insert` call sites.**

Run: `grep -n "Player.insert" spacetimedb/src/index.ts`

Any other insertion sites (e.g., rematch flows) must also include `paragon`. If found, add the same field. If only the two above, proceed.

- [ ] **Step 5: Publish the module and regenerate bindings.**

Use the **`spacetimedb-deploy` skill** (listed in available skills) — it handles publish + generate in one step. Do not run the commands manually. The skill takes care of bindings location and the `--clear` decision.

After the skill completes, the TypeScript client bindings will include `paragon` on `Player` and on the `createGame` / `joinGame` reducer payloads. Without this step the next tasks will have type errors.

- [ ] **Step 6: Commit.**

```bash
git add spacetimedb/src/schema.ts spacetimedb/src/index.ts
# Also stage any regenerated binding files the deploy skill modified
git add -u
git commit -m "feat(stdb): add paragon field to Player row and create_game/join_game reducers"
```

---

## Task 2: Client call sites — pass `paragon` into reducers

Update the two client call sites that invoke `create_game` / `join_game` to include the paragon name from the selected deck.

**Files:**
- Modify: `app/play/components/GameLobby.tsx`

- [ ] **Step 1: Locate the reducer calls.**

Run: `grep -n "create_game\|join_game\|createGame\|joinGame" app/play/components/GameLobby.tsx`

There are three invocations (one create, two join variants). Each has a reducer-args object passed to the SpaceTime connection.

- [ ] **Step 2: Add `paragon` to every reducer call.**

For each call, include `paragon: selectedDeck.paragon || ''`. Example snippet (apply the same pattern to each call):

```ts
conn.reducers.createGame({
  code,
  deckId: selectedDeck.id,
  displayName,
  format: selectedDeck.format || 'Type 1',
  supabaseUserId: userId,
  deckData: JSON.stringify(deckData),
  isPublic: !isPrivate,
  lobbyMessage: '',
  paragon: selectedDeck.paragon || '',   // NEW
});
```

And for joins:

```ts
conn.reducers.joinGame({
  code,
  deckId: selectedDeck.id,
  displayName,
  supabaseUserId: userId,
  deckData: JSON.stringify(deckData),
  paragon: selectedDeck.paragon || '',   // NEW
});
```

- [ ] **Step 3: Check for any other callers in the app.**

Run: `grep -rn "reducers\.createGame\|reducers\.joinGame" app/`

If additional callers exist (e.g., rematch flows), add `paragon` to them the same way.

- [ ] **Step 4: Type-check.**

Run: `npx tsc --noEmit 2>&1 | grep -E "(GameLobby|createGame|joinGame|paragon)" | head -20`
Expected: no errors referencing paragon, createGame, or joinGame.

- [ ] **Step 5: Commit.**

```bash
git add app/play/components/GameLobby.tsx
git commit -m "feat(play): pass paragon name when creating/joining games"
```

---

## Task 3: Shared types and helper (with tests)

Create the `ParagonEntry` type and `buildParagonEntries` helper used by the drawer. This is the one pure piece of logic with unit tests.

**Files:**
- Create: `app/shared/types/paragonEntry.ts`
- Create: `app/shared/utils/paragonEntries.ts`
- Test:   `app/shared/utils/__tests__/paragonEntries.test.ts`

- [ ] **Step 1: Write the failing test.**

Create `app/shared/utils/__tests__/paragonEntries.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildParagonEntries } from '../paragonEntries';

describe('buildParagonEntries', () => {
  it('returns empty array when no players have paragons', () => {
    const result = buildParagonEntries({
      players: [
        { id: 'p1', displayName: 'Alice', paragonName: null, isSelf: true },
        { id: 'p2', displayName: 'Bob', paragonName: null, isSelf: false },
      ],
    });
    expect(result).toEqual([]);
  });

  it('filters out players with null paragonName', () => {
    const result = buildParagonEntries({
      players: [
        { id: 'p1', displayName: 'Alice', paragonName: 'David', isSelf: true },
        { id: 'p2', displayName: 'Bob', paragonName: null, isSelf: false },
      ],
    });
    expect(result).toHaveLength(1);
    expect(result[0].playerId).toBe('p1');
  });

  it('renames the local player displayName to "You"', () => {
    const result = buildParagonEntries({
      players: [
        { id: 'p1', displayName: 'Alice', paragonName: 'David', isSelf: true },
        { id: 'p2', displayName: 'Bob', paragonName: 'Esther', isSelf: false },
      ],
    });
    expect(result[0].displayName).toBe('You');
    expect(result[1].displayName).toBe('Bob');
  });

  it('builds the paragon image URL using the public/paragons convention', () => {
    const result = buildParagonEntries({
      players: [{ id: 'p1', displayName: 'Alice', paragonName: 'David', isSelf: true }],
    });
    expect(result[0].imageUrl).toBe('/paragons/Paragon David.png');
    expect(result[0].paragonName).toBe('David');
  });

  it('preserves input player order', () => {
    const result = buildParagonEntries({
      players: [
        { id: 'p2', displayName: 'Bob', paragonName: 'Esther', isSelf: false },
        { id: 'p1', displayName: 'Alice', paragonName: 'David', isSelf: true },
      ],
    });
    expect(result.map((e) => e.playerId)).toEqual(['p2', 'p1']);
  });

  it('treats empty string paragonName as absent', () => {
    const result = buildParagonEntries({
      players: [
        { id: 'p1', displayName: 'Alice', paragonName: '', isSelf: true },
      ],
    });
    expect(result).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails.**

Run: `npx vitest run app/shared/utils/__tests__/paragonEntries.test.ts`
Expected: FAIL — cannot resolve `../paragonEntries`.

- [ ] **Step 3: Create the type file.**

Create `app/shared/types/paragonEntry.ts`:

```ts
export interface ParagonEntry {
  playerId: string;
  displayName: string;   // "You" for self, otherwise the player's displayName
  paragonName: string;   // e.g. "David"
  imageUrl: string;      // /paragons/Paragon ${paragonName}.png
  isSelf: boolean;
}
```

- [ ] **Step 4: Create the helper.**

Create `app/shared/utils/paragonEntries.ts`:

```ts
import type { ParagonEntry } from '../types/paragonEntry';

interface ParagonEntriesInput {
  players: Array<{
    id: string;
    displayName: string;
    paragonName: string | null;
    isSelf: boolean;
  }>;
}

export function buildParagonEntries(input: ParagonEntriesInput): ParagonEntry[] {
  return input.players
    .filter((p) => p.paragonName && p.paragonName.length > 0)
    .map((p) => ({
      playerId: p.id,
      displayName: p.isSelf ? 'You' : p.displayName,
      paragonName: p.paragonName!,
      imageUrl: `/paragons/Paragon ${p.paragonName}.png`,
      isSelf: p.isSelf,
    }));
}
```

- [ ] **Step 5: Run the tests to confirm they pass.**

Run: `npx vitest run app/shared/utils/__tests__/paragonEntries.test.ts`
Expected: all 6 tests PASS.

- [ ] **Step 6: Commit.**

```bash
git add app/shared/types/paragonEntry.ts app/shared/utils/paragonEntries.ts app/shared/utils/__tests__/paragonEntries.test.ts
git commit -m "feat(shared): add ParagonEntry type and buildParagonEntries helper with tests"
```

---

## Task 4: `ParagonDrawer` component

The DOM-overlay drawer with pull-tab and open states. No unit tests (UI/visual). Manual verification happens in Task 8.

**Files:**
- Create: `app/shared/components/ParagonDrawer.tsx`

- [ ] **Step 1: Write the component.**

Create `app/shared/components/ParagonDrawer.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';
import type { ParagonEntry } from '../types/paragonEntry';

interface ParagonDrawerProps {
  /** Paragon entries to display. Empty array = drawer hidden entirely. */
  paragons: ParagonEntry[];
}

/**
 * Bottom-right pull-tab that expands into a full-screen overlay showing
 * the current paragon card at its native landscape aspect (1.4:1).
 *
 * In multiplayer with ≥2 paragons, a tab row appears above the card.
 * `P` toggles; backdrop click or `Esc` closes.
 */
export function ParagonDrawer({ paragons }: ParagonDrawerProps) {
  const [open, setOpen] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);

  // Default active tab: the local player's paragon, or first entry.
  useEffect(() => {
    if (paragons.length === 0) {
      setActiveId(null);
      return;
    }
    const self = paragons.find((p) => p.isSelf);
    setActiveId((curr) => {
      // keep existing choice if still valid
      if (curr && paragons.some((p) => p.playerId === curr)) return curr;
      return (self ?? paragons[0]).playerId;
    });
  }, [paragons]);

  // Keyboard: P toggles, Esc closes. Ignore when typing in inputs.
  useEffect(() => {
    if (paragons.length === 0) return;
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      ) {
        return;
      }
      if (e.key === 'p' || e.key === 'P') {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === 'Escape' && open) {
        e.preventDefault();
        setOpen(false);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [paragons.length, open]);

  if (paragons.length === 0) return null;

  const selfEntry = paragons.find((p) => p.isSelf) ?? paragons[0];
  const activeEntry = paragons.find((p) => p.playerId === activeId) ?? selfEntry;
  const showTabs = paragons.length >= 2;

  return (
    <>
      {/* Pull-tab (always rendered when there's at least one paragon) */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open paragon"
        style={{
          position: 'fixed',
          right: 16,
          bottom: 16,
          zIndex: 900,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          height: 44,
          padding: '4px 10px 4px 4px',
          background: 'rgba(14, 10, 6, 0.92)',
          border: '1px solid rgba(196, 149, 90, 0.5)',
          borderRadius: 6,
          color: '#e8d5a3',
          fontFamily: 'Cinzel, Georgia, serif',
          fontSize: 12,
          letterSpacing: 1,
          cursor: 'pointer',
          boxShadow: '0 6px 20px rgba(0,0,0,0.6)',
        }}
      >
        <img
          src={selfEntry.imageUrl}
          alt=""
          style={{
            width: 50,
            height: 36,
            objectFit: 'cover',
            borderRadius: 3,
            border: '1px solid rgba(196, 149, 90, 0.3)',
          }}
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.visibility = 'hidden';
          }}
        />
        PARAGON
      </button>

      {/* Backdrop + drawer (rendered when open) */}
      {open && (
        <div
          onClick={() => setOpen(false)}
          role="presentation"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 950,
            background: 'rgba(0, 0, 0, 0.75)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'flex-end',
            paddingBottom: 24,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 12,
              padding: 16,
              background: 'rgba(14, 10, 6, 0.97)',
              border: '1px solid rgba(196, 149, 90, 0.3)',
              borderRadius: 8,
              boxShadow: '0 12px 48px rgba(0,0,0,0.7)',
              maxWidth: '90vw',
            }}
          >
            {/* Tabs (only when ≥2 paragons) */}
            {showTabs && (
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: 4,
                  borderBottom: '1px solid rgba(196, 149, 90, 0.2)',
                  paddingBottom: 8,
                  width: '100%',
                  justifyContent: 'center',
                }}
              >
                {paragons.map((p) => {
                  const active = p.playerId === activeEntry.playerId;
                  return (
                    <button
                      key={p.playerId}
                      type="button"
                      onClick={() => setActiveId(p.playerId)}
                      style={{
                        padding: '6px 14px',
                        background: active ? 'rgba(196, 149, 90, 0.25)' : 'transparent',
                        border: '1px solid rgba(196, 149, 90, 0.4)',
                        borderRadius: 4,
                        color: active ? '#f3e2b4' : 'rgba(196, 149, 90, 0.7)',
                        fontFamily: 'Cinzel, Georgia, serif',
                        fontSize: 12,
                        letterSpacing: 1,
                        cursor: 'pointer',
                      }}
                    >
                      {p.displayName.toUpperCase()}
                    </button>
                  );
                })}
              </div>
            )}

            {/* Paragon image, landscape aspect preserved */}
            <img
              src={activeEntry.imageUrl}
              alt={`Paragon ${activeEntry.paragonName}`}
              style={{
                width: 'min(90vw, 600px)',
                height: 'auto',
                aspectRatio: '1.4 / 1',
                objectFit: 'contain',
                borderRadius: 4,
                boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
              }}
            />
          </div>
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 2: Type-check.**

Run: `npx tsc --noEmit 2>&1 | grep -E "ParagonDrawer|paragonEntry" | head -20`
Expected: no errors.

- [ ] **Step 3: Commit.**

```bash
git add app/shared/components/ParagonDrawer.tsx
git commit -m "feat(shared): add ParagonDrawer component"
```

---

## Task 5: Remove paragon zone from goldfish layout

Drop the `isParagon` parameter from `calculateZoneLayout` and the consumer. The `paragon` zone entry stays in the returned record (off-screen) so zone-keyed code elsewhere doesn't break.

**Files:**
- Modify: `app/goldfish/layout/zoneLayout.ts`
- Modify: `app/goldfish/components/GoldfishCanvas.tsx`

- [ ] **Step 1: Strip `isParagon` from `calculateZoneLayout`.**

Edit `app/goldfish/layout/zoneLayout.ts`:

1. Remove the `isParagon: boolean = false,` parameter. Shift `scale` up.
2. Change `const sidebarZoneCount = isParagon ? 6 : 5;` to `const sidebarZoneCount = 5;`.
3. Replace the `paragonZone` block with the always-off-screen variant:

```ts
// Paragon is no longer rendered on the canvas; the drawer owns it.
// Keep the entry so zone-keyed code (iteration over zones record) still works.
const paragonZone: ZoneRect = {
  x: -1000,
  y: -1000,
  width: 0,
  height: 0,
  label: 'Paragon',
};
```

4. Update the JSDoc comment — remove the `Paragon*` line from the ASCII diagram and the footnote.

- [ ] **Step 2: Update the consumer in `GoldfishCanvas.tsx`.**

Edit `app/goldfish/components/GoldfishCanvas.tsx`:

1. Remove the `const isParagon = false;` line (line ~233).
2. Change the `calculateZoneLayout` call to drop the `isParagon` argument:

```tsx
const zoneLayout = useMemo(
  () => calculateZoneLayout(virtualWidth, VIRTUAL_HEIGHT, scale),
  [virtualWidth, scale],
);
```

3. Remove the two spread patterns that conditionally included `'paragon'` in zone-order arrays (around lines 308 and 882). Example:

```tsx
// BEFORE
[
  'land-of-redemption', 'banish', 'reserve', 'deck', 'discard',
  ...(isParagon ? ['paragon' as ZoneId] : []),
  'land-of-bondage', 'territory', 'hand',
]

// AFTER
[
  'land-of-redemption', 'banish', 'reserve', 'deck', 'discard',
  'land-of-bondage', 'territory', 'hand',
]
```

Drop the `isParagon` reference from the `useMemo` dep arrays too.

- [ ] **Step 3: Type-check.**

Run: `npx tsc --noEmit 2>&1 | grep -E "GoldfishCanvas|zoneLayout|isParagon" | head -20`
Expected: no errors referencing `isParagon`.

- [ ] **Step 4: Commit.**

```bash
git add app/goldfish/layout/zoneLayout.ts app/goldfish/components/GoldfishCanvas.tsx
git commit -m "refactor(goldfish): remove isParagon branch from layout; drawer owns paragon UI"
```

---

## Task 6: Remove paragon zone from multiplayer layout

Drop `isParagon` from `calculateMultiplayerLayout` and its consumer. Remove "Paragon" from pile-label arrays. Drop `paragon` from the `PileZone` union if no remaining reference.

**Files:**
- Modify: `app/play/layout/multiplayerLayout.ts`
- Modify: `app/play/components/MultiplayerCanvas.tsx`

- [ ] **Step 1: Strip `isParagon` from `calculateMultiplayerLayout`.**

Edit `app/play/layout/multiplayerLayout.ts`:

1. Remove the `isParagon: boolean = false,` parameter and its JSDoc line.
2. Simplify the label/key arrays — drop the conditional branches:

```ts
// BEFORE
const oppPileLabels = isParagon
  ? ['Paragon', 'Deck', 'Discard', 'Reserve', 'Banish', 'Land of Redemption']
  : ['Deck', 'Discard', 'Reserve', 'Banish', 'Land of Redemption'];
const oppPileKeys: PileZone[] = isParagon
  ? ['paragon', 'deck', 'discard', 'reserve', 'banish', 'lor']
  : ['deck', 'discard', 'reserve', 'banish', 'lor'];

// AFTER
const oppPileLabels = ['Deck', 'Discard', 'Reserve', 'Banish', 'Land of Redemption'];
const oppPileKeys: PileZone[] = ['deck', 'discard', 'reserve', 'banish', 'lor'];
```

Do the same for `playerPileLabels` / `playerPileKeys` (drop the `'Paragon'` entries).

3. Update the fallback-branch comment "simple vertical stack (e.g. paragon format with 6 zones)" — just say "simple vertical stack fallback".

4. Check: `PileZone` union still includes `'paragon'`? Run `grep -n "PileZone" app/play/layout/multiplayerLayout.ts app/play/components/MultiplayerCanvas.tsx app/play/`. If `paragon` is no longer referenced anywhere, remove it from the union:

```ts
export type PileZone = 'lor' | 'banish' | 'reserve' | 'deck' | 'discard';
```

- [ ] **Step 2: Update `MultiplayerCanvas.tsx`.**

Edit `app/play/components/MultiplayerCanvas.tsx`:

1. Find the `calculateMultiplayerLayout(...)` call and remove the `isParagon` argument (if any was passed).
2. Find the two places that spread `paragon` conditionally (lines ~338 and ~352):

```tsx
// BEFORE
{
  // ...other piles...
  ...(mpLayout.sidebar.player.paragon ? { paragon: mpLayout.sidebar.player.paragon } : {}),
}

// AFTER — delete the entire paragon spread line
```

Do the same for the opponent variant.

3. Grep for any other `paragon`/`Paragon` references in the file and remove/adjust consistently.

- [ ] **Step 3: Type-check.**

Run: `npx tsc --noEmit 2>&1 | grep -E "MultiplayerCanvas|multiplayerLayout|isParagon|PileZone" | head -30`
Expected: no errors.

- [ ] **Step 4: Commit.**

```bash
git add app/play/layout/multiplayerLayout.ts app/play/components/MultiplayerCanvas.tsx
git commit -m "refactor(play): remove isParagon branch from multiplayer layout; drop paragon pile"
```

---

## Task 7: Mount `ParagonDrawer` in goldfish client

**Files:**
- Modify: `app/goldfish/[deckId]/client.tsx`

- [ ] **Step 1: Build the `paragons` prop from game state.**

At the top of `GoldfishGameArea` (or in `GoldfishClient` just above the `GoldfishGameArea` mount), compute a single-entry `ParagonEntry[]` from `deck.paragon`:

```tsx
import { ParagonDrawer } from '@/app/shared/components/ParagonDrawer';
import { buildParagonEntries } from '@/app/shared/utils/paragonEntries';

// Inside the component, alongside other useMemo calls:
const paragonEntries = useMemo(
  () => buildParagonEntries({
    players: [
      {
        id: 'goldfish-self',
        displayName: 'You',
        paragonName: deck.paragon ?? null,
        isSelf: true,
      },
    ],
  }),
  [deck.paragon],
);
```

(`deck.paragon` is `string | null | undefined` on `DeckDataForGoldfish` — confirm by peeking at `app/goldfish/types.ts`; if the field name differs, use whatever property carries the paragon name.)

- [ ] **Step 2: Mount the drawer.**

Inside `GoldfishGameArea`, add `<ParagonDrawer paragons={paragonEntries} />` as a sibling of `<CardLoupePanel />` (outside the Konva container, so it's a DOM overlay on top of the whole viewport):

```tsx
return (
  <div /* existing wrapper */>
    {/* ...existing cave-bg, vignette, game container, CardLoupePanel... */}
    <CardLoupePanel />
    <ParagonDrawer paragons={paragonEntries} />
  </div>
);
```

- [ ] **Step 3: Type-check.**

Run: `npx tsc --noEmit 2>&1 | grep -E "goldfish|ParagonDrawer" | head -20`
Expected: no errors.

- [ ] **Step 4: Commit.**

```bash
git add app/goldfish/[deckId]/client.tsx
git commit -m "feat(goldfish): mount ParagonDrawer in paragon-format games"
```

---

## Task 8: Mount `ParagonDrawer` in multiplayer client

**Files:**
- Modify: `app/play/[code]/client.tsx`

- [ ] **Step 1: Build the `paragons` prop from spacetimedb state.**

Inside the component that has access to `gameState` (the one that already reads `gameState.myPlayer` / `gameState.opponentPlayer`), compute:

```tsx
import { ParagonDrawer } from '@/app/shared/components/ParagonDrawer';
import { buildParagonEntries } from '@/app/shared/utils/paragonEntries';

const paragonEntries = useMemo(() => {
  const players: Array<{ id: string; displayName: string; paragonName: string | null; isSelf: boolean }> = [];
  if (gameState.myPlayer) {
    players.push({
      id: String(gameState.myPlayer.id),
      displayName: gameState.myPlayer.displayName,
      paragonName: gameState.myPlayer.paragon || null,
      isSelf: true,
    });
  }
  if (gameState.opponentPlayer) {
    players.push({
      id: String(gameState.opponentPlayer.id),
      displayName: gameState.opponentPlayer.displayName,
      paragonName: gameState.opponentPlayer.paragon || null,
      isSelf: false,
    });
  }
  return buildParagonEntries({ players });
}, [gameState.myPlayer, gameState.opponentPlayer]);
```

(Note: `gameState.myPlayer.paragon` is the field added in Task 1. The TS bindings from Task 1 Step 5 must be regenerated for this to type-check.)

- [ ] **Step 2: Mount the drawer.**

Add `<ParagonDrawer paragons={paragonEntries} />` in the rendered JSX — place it at the top level of the game view (sibling to existing overlays like `GameToastContainer`, `ChatPanel`, `TurnIndicator`), NOT inside the Konva stage. Render it whenever the game is playing; if it simplifies logic, render unconditionally — the component self-hides when `paragons.length === 0`.

- [ ] **Step 3: Type-check.**

Run: `npx tsc --noEmit 2>&1 | grep -E "play/\[code\]/client|ParagonDrawer|myPlayer\.paragon|opponentPlayer\.paragon" | head -20`
Expected: no errors. If you see errors about `paragon` not existing on Player, the bindings were not regenerated in Task 1 Step 5 — go back and regenerate.

- [ ] **Step 4: Commit.**

```bash
git add app/play/[code]/client.tsx
git commit -m "feat(play): mount ParagonDrawer in multiplayer with tabs for each player"
```

---

## Task 9: Manual verification and cleanup

No automated coverage for the UI — verify in the browser. Also sweep for any stray `isParagon` / sidebar-paragon references.

- [ ] **Step 1: Sweep for lingering `isParagon` references.**

Run: `grep -rn "isParagon" app/ --include="*.ts" --include="*.tsx"`
Expected: **no matches** (or only in `GameLobby.tsx`, where it's used for the deck-preview header — that's a different local variable unrelated to the layout flag; leave it alone).

If you find unexpected matches outside `GameLobby.tsx`, update them (drop the arg/branch) and re-run the grep.

- [ ] **Step 2: Start the dev server.**

Run: `npm run dev` in a separate terminal. Wait for `ready in` output.

- [ ] **Step 3: Goldfish — paragon deck.**

1. Navigate to `/goldfish` and pick any paragon-format deck (or go directly to `/goldfish/<deckId>?format=Paragon` if needed).
2. **Verify the pull-tab:** bottom-right of the viewport shows a tab labeled "PARAGON" with a tiny landscape thumbnail.
3. **Verify the sidebar:** only 5 piles (LOR, Banish, Reserve, Deck, Discard). No paragon pile.
4. **Open via click:** drawer slides up with a dim backdrop. The paragon card fills ~600px wide, landscape aspect preserved.
5. **Open via `P`:** close with click/backdrop, reopen by pressing `P`. Confirm `Esc` and `P` both close it.
6. **No tabs:** single-paragon solo mode should not render a tab row above the card.

- [ ] **Step 4: Goldfish — non-paragon deck.**

1. Pick a T1 or T2 deck.
2. **Verify:** no pull-tab anywhere on the screen. Pressing `P` does nothing (the drawer returns `null` when `paragons.length === 0`).
3. **Verify sidebar:** 5 piles, unchanged from before.

- [ ] **Step 5: Multiplayer — paragon vs paragon.**

1. Open two browser windows (or one window + one incognito). Both users log in.
2. User A creates a paragon-format game. User B joins with a different paragon deck.
3. **Both players:** pull-tab appears in the bottom-right.
4. **Open drawer:** tab row appears above the card with "YOU" and the opponent's display name.
5. **Switch tabs:** clicking the opponent tab swaps to the opponent's paragon image. Switching back returns to your paragon.
6. **Verify both sidebars:** 5 piles each, no paragon pile.

- [ ] **Step 6: Multiplayer — paragon vs T1.**

1. User A creates a paragon deck game. User B joins with a T1 deck.
2. **User A:** pull-tab appears, drawer shows only their own paragon, no tab row (only 1 paragon entry).
3. **User B:** no pull-tab (they have no paragon).

- [ ] **Step 7: Mobile viewport check.**

1. In browser devtools, switch to a ~375px-wide mobile viewport.
2. Open the drawer in goldfish paragon mode.
3. **Verify:** the drawer card fits within 90vw, the landscape aspect is preserved (not cropped or squished).
4. **Verify:** the pull-tab remains accessible in the bottom-right corner.

- [ ] **Step 8: Type-check the whole project.**

Run: `npx tsc --noEmit`
Expected: exits clean (any pre-existing errors should be unchanged; no new errors introduced by this work).

- [ ] **Step 9: Run the full vitest suite.**

Run: `npx vitest run`
Expected: all tests pass, including the new `paragonEntries.test.ts`.

- [ ] **Step 10: Final commit (if anything changed during verification).**

If you fixed bugs or tightened styles during manual testing, commit those:

```bash
git add -u
git commit -m "fix(paragon-drawer): <describe the fix>"
```

If nothing changed, skip the commit.

---

## Done criteria

- SpacetimeDB `Player` row has `paragon` field; `create_game` / `join_game` accept and store it.
- `app/shared/components/ParagonDrawer.tsx` exists and is mounted in both goldfish and multiplayer clients.
- `buildParagonEntries` has passing unit tests.
- `calculateZoneLayout` and `calculateMultiplayerLayout` no longer accept an `isParagon` argument. Sidebars always render 5 piles.
- Manual verification (Task 9) passes for all five scenarios.
- `grep -rn "isParagon" app/` returns only the unrelated `GameLobby.tsx` match.
