# Online Play — Card Text Notes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let players right-click a card they own in online play, pick "Add text note" / "Edit note", type up to 40 characters, and have that note appear on the card for everyone in the game.

**Architecture:** Most of the wiring already exists — `CardInstance.notes`, `set_note` reducer, `setNote` hook, read-only rendering in `GameCardNode` and `CardZoomModal`, and `setNote` in the shared `GameActions`. Plan adds: (1) server-side safety cap/ownership/trim on the reducer, (2) a new `CardNotePopover` UI component, (3) an "Edit note" menu item in `CardContextMenu`, and (4) the wiring in `MultiplayerCanvas` to open the popover from the menu.

**Tech Stack:** TypeScript, React 19, Next.js App Router, Framer Motion, SpacetimeDB (TypeScript SDK).

**Test strategy:** Play/goldfish components have no unit test infrastructure (see `app/play/layout/__tests__/` for the narrow set that does exist — layout math only). UI work is verified manually by running the dev server. Reducer changes are verified by republishing and exercising the feature end-to-end.

**Spec:** [docs/superpowers/specs/2026-04-18-online-play-card-notes-design.md](../specs/2026-04-18-online-play-card-notes-design.md)

---

## Task 1: Harden the `set_note` reducer

Adds server-side safeguards: 40-char cap, ownership check, whitespace trim. Without this, any player in the game could edit any card's note and write arbitrarily long strings.

**Files:**
- Modify: `spacetimedb/src/index.ts:2570-2586`

- [ ] **Step 1: Replace the reducer body**

Read the current reducer at [spacetimedb/src/index.ts:2570-2586](../../spacetimedb/src/index.ts#L2570). Replace the `(ctx, { gameId, cardInstanceId, text }) => { ... }` body so the full reducer reads:

```ts
export const set_note = spacetimedb.reducer(
  {
    gameId: t.u64(),
    cardInstanceId: t.u64(),
    text: t.string(),
  },
  (ctx, { gameId, cardInstanceId, text }) => {
    const player = findPlayerBySender(ctx, gameId);

    const trimmed = text.trim();
    if (trimmed.length > 40) throw new SenderError('Note too long (max 40 chars)');

    const card = ctx.db.CardInstance.id.find(cardInstanceId);
    if (!card) throw new SenderError('Card not found');
    if (card.gameId !== gameId) throw new SenderError('Card not in this game');
    if (card.ownerId !== player.id) throw new SenderError('Not your card');

    ctx.db.CardInstance.id.update({ ...card, notes: trimmed });
    // No logAction
  }
);
```

- [ ] **Step 2: Commit**

```bash
git add spacetimedb/src/index.ts
git commit -m "feat(spacetimedb): enforce length cap, ownership, and trim on set_note"
```

---

## Task 2: Republish module and regenerate bindings

Reducer changes don't reach the client until the module is republished and bindings are regenerated.

**Files:**
- Regenerate: `lib/spacetimedb/module_bindings/` (do not edit by hand)

- [ ] **Step 1: Publish and regenerate**

Invoke the `spacetimedb-deploy` skill. It runs `spacetime publish` and `spacetime generate` and wires the generated types back into `lib/spacetimedb/module_bindings/`.

- [ ] **Step 2: Verify bindings changed (or didn't)**

Run:

```bash
git diff --stat lib/spacetimedb/module_bindings
```

Expected: Either no changes (reducer signature didn't change, only body did — this is expected), or small type tweaks. Either is fine. If huge diffs appear, check that `spacetime generate` targeted the correct output dir.

- [ ] **Step 3: Commit regenerated bindings (if any)**

```bash
git add lib/spacetimedb/module_bindings
git diff --cached --quiet || git commit -m "chore: regenerate spacetimedb bindings"
```

---

## Task 3: Create `CardNotePopover` component

Small floating input anchored at cursor coords. Auto-focuses, Enter saves, Escape cancels, click-outside cancels.

**Files:**
- Create: `app/play/components/CardNotePopover.tsx`

- [ ] **Step 1: Write the component**

Create `app/play/components/CardNotePopover.tsx`:

```tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';

const MAX_LEN = 40;
const WIDTH = 260;
const HEIGHT = 92;

interface CardNotePopoverProps {
  x: number;
  y: number;
  initialValue: string;
  onSave: (text: string) => void;
  onCancel: () => void;
}

export function CardNotePopover({ x, y, initialValue, onSave, onCancel }: CardNotePopoverProps) {
  const [value, setValue] = useState(initialValue);
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onCancel();
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [onCancel]);

  const left = Math.max(8, Math.min(x, window.innerWidth - WIDTH - 8));
  const top = Math.max(8, Math.min(y, window.innerHeight - HEIGHT - 8));

  const handleSubmit = () => {
    onSave(value.trim());
  };

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={{ duration: 0.1 }}
      style={{
        position: 'fixed',
        left,
        top,
        width: WIDTH,
        background: 'var(--gf-bg)',
        border: '1px solid var(--gf-border)',
        borderRadius: 6,
        padding: 10,
        zIndex: 1000,
        boxShadow: '0 8px 24px rgba(0,0,0,0.6)',
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <input
        ref={inputRef}
        value={value}
        maxLength={MAX_LEN}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            handleSubmit();
          }
        }}
        placeholder="Add a note..."
        style={{
          width: '100%',
          padding: '6px 8px',
          background: 'var(--gf-bg-elevated, rgba(0,0,0,0.2))',
          border: '1px solid var(--gf-border)',
          borderRadius: 4,
          color: 'var(--gf-text)',
          fontSize: 13,
          fontFamily: 'var(--font-cinzel), Georgia, serif',
          outline: 'none',
        }}
      />
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginTop: 6,
          fontSize: 10,
          color: 'var(--gf-text-dim)',
        }}
      >
        <span>Enter to save · Esc to cancel</span>
        <span>{value.length} / {MAX_LEN}</span>
      </div>
    </motion.div>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run:

```bash
npx tsc --noEmit -p tsconfig.json 2>&1 | grep "CardNotePopover" || echo "no errors in CardNotePopover"
```

Expected: `no errors in CardNotePopover`

- [ ] **Step 3: Commit**

```bash
git add app/play/components/CardNotePopover.tsx
git commit -m "feat(play): add CardNotePopover component"
```

---

## Task 4: Add "Edit note" item to `CardContextMenu`

Add a new optional `onEditNote` prop. When present, renders a menu item whose label reflects current note state. Mirrors the existing `onDetach` / `onExchange` prop pattern.

**Files:**
- Modify: `app/shared/components/CardContextMenu.tsx`

- [ ] **Step 1: Extend props interface**

In [app/shared/components/CardContextMenu.tsx:18-30](../../app/shared/components/CardContextMenu.tsx#L18), add a new optional prop to `CardContextMenuProps`. The full interface becomes:

```tsx
interface CardContextMenuProps {
  card: GameCard;
  x: number;
  y: number;
  actions: GameActions;
  onClose: () => void;
  onExchange?: (cardIds: string[]) => void;
  /** Invoked when the user clicks "Unequip" on an attached weapon. Only renders the menu
   *  entry when this handler is provided AND card.equippedTo is set. */
  onDetach?: (cardInstanceId: string) => void;
  /** Invoked when the user clicks "Add text note" / "Edit note". When omitted, the
   *  menu entry is not rendered (used to gate the action to card owners). */
  onEditNote?: (card: GameCard) => void;
  /** Live zone state for reading updated card data (counters, etc.) */
  zones?: Record<ZoneId, GameCard[]>;
}
```

- [ ] **Step 2: Destructure new prop in the signature**

Update the function signature at line 32 so `onEditNote` is pulled out of props:

```tsx
export function CardContextMenu({ card: initialCard, x, y, actions, onClose, onExchange, onDetach, onEditNote, zones }: CardContextMenuProps) {
```

- [ ] **Step 3: Add the menu item**

Insert a new `{onEditNote && (...)}` block immediately **after** the existing "Unequip" block (which ends around line 271) and **before** the first `<div style={separatorStyle} />` at line 273. The new block:

```tsx
      {onEditNote && (
        <button
          style={itemStyle}
          onClick={() => doAction(() => onEditNote(card))}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--gf-hover)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
        >
          {card.notes
            ? `Edit note: "${card.notes.length > 20 ? card.notes.slice(0, 20) + '…' : card.notes}"`
            : 'Add text note'}
        </button>
      )}
```

- [ ] **Step 4: Verify it compiles**

Run:

```bash
npx tsc --noEmit -p tsconfig.json 2>&1 | grep "CardContextMenu" || echo "no errors in CardContextMenu"
```

Expected: `no errors in CardContextMenu`

- [ ] **Step 5: Commit**

```bash
git add app/shared/components/CardContextMenu.tsx
git commit -m "feat(shared): add Edit note menu item to CardContextMenu"
```

---

## Task 5: Wire popover state into `MultiplayerCanvas`

Add popover state, gate the new `onEditNote` prop to the card owner, render the popover, and call `gameState.setNote` on save.

**Files:**
- Modify: `app/play/components/MultiplayerCanvas.tsx`

- [ ] **Step 1: Add the import**

Near the other `@/app/shared/components/*` imports (around line 31-35), add:

```tsx
import { CardNotePopover } from './CardNotePopover';
```

- [ ] **Step 2: Add popover state**

Immediately after the `multiCardContextMenu` state declaration at [MultiplayerCanvas.tsx:550](../../app/play/components/MultiplayerCanvas.tsx#L550), insert:

```tsx
  const [notePopover, setNotePopover] = useState<{
    cardId: string;
    x: number;
    y: number;
    initialValue: string;
  } | null>(null);
```

- [ ] **Step 3: Close the popover in `closeAllMenus`**

At [MultiplayerCanvas.tsx:935-940](../../app/play/components/MultiplayerCanvas.tsx#L935), inside the `closeAllMenus` callback body, add `setNotePopover(null);` alongside the other `setContextMenu(null)` / `setMultiCardContextMenu(null)` calls. Order doesn't matter, but add it right after the existing `setMultiCardContextMenu(null);` line.

- [ ] **Step 4: Wire `onEditNote` into the rendered `CardContextMenu`**

At [MultiplayerCanvas.tsx:4277-4300](../../app/play/components/MultiplayerCanvas.tsx#L4277), the existing `<CardContextMenu ... />` block must gain an `onEditNote` prop mirroring the `onDetach` ownership-gate pattern. Insert between the existing `onDetach={...}` prop and the `zones={...}` prop:

```tsx
          onEditNote={
            contextMenu.card.ownerId === 'player1'
              ? (card) => {
                  setNotePopover({
                    cardId: card.instanceId,
                    x: contextMenu.x,
                    y: contextMenu.y,
                    initialValue: card.notes ?? '',
                  });
                  setContextMenu(null);
                }
              : undefined
          }
```

- [ ] **Step 5: Render the popover**

Immediately after the `<MultiCardContextMenu>` block ends (closing `)}` around [MultiplayerCanvas.tsx:4317](../../app/play/components/MultiplayerCanvas.tsx#L4317)), insert:

```tsx
      {notePopover && (
        <CardNotePopover
          x={notePopover.x}
          y={notePopover.y}
          initialValue={notePopover.initialValue}
          onSave={(text) => {
            gameState.setNote(BigInt(notePopover.cardId), text);
            setNotePopover(null);
          }}
          onCancel={() => setNotePopover(null)}
        />
      )}
```

- [ ] **Step 6: Verify it compiles**

Run:

```bash
npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "MultiplayerCanvas|CardNotePopover" || echo "no errors"
```

Expected: `no errors`

- [ ] **Step 7: Commit**

```bash
git add app/play/components/MultiplayerCanvas.tsx
git commit -m "feat(play): wire CardNotePopover into multiplayer canvas"
```

---

## Task 6: Manual verification

The play/ components have no unit test infrastructure, so the only meaningful verification is end-to-end in a browser with a real SpacetimeDB connection.

- [ ] **Step 1: Start dev server**

```bash
npm run dev
```

Expected: server on `localhost:3000`.

- [ ] **Step 2: Confirm module is published**

Run `spacetime logs <module-name>` (check `.env.local` or `app/config.ts` for the name) and verify recent publish activity.

- [ ] **Step 3: Smoke test — add note**

1. Open two browser windows as different users, start an online game and get past the pregame phase so cards are on the table.
2. On one of your cards in territory, right-click → click `Add text note`.
3. Type "Heal 2 next turn" → press Enter.
4. Verify: popover closes; note appears on the card in `GameCardNode`.
5. Switch to the opponent window → verify the note is visible there too.

- [ ] **Step 4: Smoke test — edit note**

1. Right-click the same card → the menu should now read `Edit note: "Heal 2 next turn"` (truncated).
2. Click → popover opens with the existing text selected.
3. Replace with "Blocks Michael" → Enter.
4. Verify: new note shows; opponent sees update.

- [ ] **Step 5: Smoke test — clear note**

1. Right-click card → `Edit note: "Blocks Michael"`.
2. Delete all text → Enter.
3. Verify: note bar disappears on both windows. The menu label returns to `Add text note`.

- [ ] **Step 6: Smoke test — cancel paths**

1. Open popover → press Escape → popover closes, note unchanged.
2. Open popover → click outside it → popover closes, note unchanged.

- [ ] **Step 7: Smoke test — ownership gate**

1. Right-click an opponent's face-up card (e.g. in their territory).
2. Verify: either the token menu appears OR the full menu appears but `Add text note` / `Edit note` is NOT in it.
3. As an additional server-side safety check: temporarily uncomment a line in the browser console to force a `conn.reducers.setNote({ gameId, cardInstanceId: <opponent's card id>, text: 'hack' })` call. Expected: reducer rejects with `SenderError: Not your card`. (Check spacetime logs.)

- [ ] **Step 8: Smoke test — length cap**

1. Open popover, type 40 characters → client stops you (input `maxLength={40}`).
2. Via browser console, force `conn.reducers.setNote({ gameId, cardInstanceId, text: 'x'.repeat(41) })`. Expected: reducer rejects with `SenderError: Note too long (max 40 chars)`.

If all six smoke paths pass, the feature is complete.

---

## Self-review checklist

- Spec coverage: visibility (Task 1 trusts public subscription), owner-only edit (Task 1 + Task 5 gate), 40-char cap (Task 1 + Task 3), inline popover (Task 3), empty-submit-clears (Task 1 trims, existing renderers hide empty). All spec decisions map to tasks.
- Placeholder scan: No TBDs; every code step has full code; every shell step has the exact command and expected output.
- Type consistency: `onEditNote(card: GameCard)` used identically in Task 4 (prop definition + usage) and Task 5 (render site).
- Files touched match the spec's "Files touched" table (reducer, popover new file, menu, canvas + bindings).
