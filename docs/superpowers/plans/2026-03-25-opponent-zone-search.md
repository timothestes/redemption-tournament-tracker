# Opponent Zone Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add consent-based opponent zone search — right-click opponent's deck/hand/reserve, opponent approves, requester browses with full actions and drag-out.

**Architecture:** New SpacetimeDB `ZoneSearchRequest` table + 5 reducers handle the consent flow. Client subscribes to requests and shows consent dialog (target) or browse modal (requester). A new `OpponentBrowseModal` component handles opponent-specific actions (buttons target opponent zones, drag targets any zone). A `move_opponent_card` reducer validates requests before moving opponent cards.

**Tech Stack:** SpacetimeDB (TypeScript module), React 19, Konva.js, Next.js 15

**Spec:** `docs/superpowers/specs/2026-03-25-opponent-zone-search-design.md`

---

## File Structure

| File | Status | Responsibility |
|------|--------|----------------|
| `spacetimedb/src/schema.ts` | MODIFY | Add `ZoneSearchRequest` table |
| `spacetimedb/src/index.ts` | MODIFY | Add 5 reducers |
| `app/play/[code]/client.tsx` | MODIFY | Add subscription for `zone_search_request` |
| `app/play/hooks/useGameState.ts` | MODIFY | Subscribe to `ZoneSearchRequest`, expose data + actions |
| `app/shared/components/OpponentZoneContextMenu.tsx` | CREATE | Right-click menu for opponent zones |
| `app/shared/components/ConsentDialog.tsx` | CREATE | Blocking approval/deny modal |
| `app/shared/components/OpponentBrowseModal.tsx` | CREATE | Browse opponent zone with actions + drag |
| `app/play/components/MultiplayerCanvas.tsx` | MODIFY | Wire everything together |

---

## Task 1: Add ZoneSearchRequest Table to SpacetimeDB Schema

**Files:**
- Modify: `spacetimedb/src/schema.ts`

- [ ] **Step 1: Add the table definition**

After the `DisconnectTimeout` table definition (around line 217), add:

```typescript
export const ZoneSearchRequest = table(
  {
    name: 'zone_search_request',
    public: true,
    indexes: [
      { accessor: 'zone_search_request_game_id', algorithm: 'btree' as const, columns: ['gameId'] },
    ],
  },
  {
    id: t.u64().primaryKey().autoInc(),
    gameId: t.u64(),
    requesterId: t.u64(),
    targetPlayerId: t.u64(),
    zone: t.string(),
    status: t.string(),
    createdAt: t.timestamp(),
  }
);
```

- [ ] **Step 2: Register in schema export**

Add `ZoneSearchRequest` to the `schema({...})` export object (around line 219):

```typescript
const spacetimedb = schema({
  Game,
  Player,
  CardInstance,
  CardCounter,
  GameAction,
  ChatMessage,
  Spectator,
  DisconnectTimeout,
  ZoneSearchRequest,
});
```

- [ ] **Step 3: Verify it compiles**

Run: `cd spacetimedb && npx tsc --noEmit --pretty 2>&1 | head -20`

- [ ] **Step 4: Commit**

```bash
git add spacetimedb/src/schema.ts
git commit -m "feat: add ZoneSearchRequest table to SpacetimeDB schema"
```

---

## Task 2: Add Zone Search Reducers

**Files:**
- Modify: `spacetimedb/src/index.ts`

- [ ] **Step 1: Add request_zone_search reducer**

After the last existing reducer, add:

```typescript
export const request_zone_search = spacetimedb.reducer(
  {
    gameId: t.u64(),
    zone: t.string(),
  },
  (ctx, { gameId, zone }) => {
    const game = ctx.db.Game.id.find(gameId);
    if (!game) throw new SenderError('Game not found');
    if (game.status !== 'playing') throw new SenderError('Game is not in playing state');

    const player = findPlayerBySender(ctx, gameId);

    // Validate zone
    if (!['deck', 'hand', 'reserve'].includes(zone)) {
      throw new SenderError('Invalid zone for search: ' + zone);
    }

    // Find opponent
    const allPlayers = [...ctx.db.Player.player_game_id.filter(gameId)];
    const opponent = allPlayers.find(p => p.id !== player.id);
    if (!opponent) throw new SenderError('Opponent not found');

    // Check no pending request from this player
    for (const req of ctx.db.ZoneSearchRequest.zone_search_request_game_id.filter(gameId)) {
      if (req.requesterId === player.id && req.status === 'pending') {
        throw new SenderError('You already have a pending search request');
      }
    }

    ctx.db.ZoneSearchRequest.insert({
      id: 0n,
      gameId,
      requesterId: player.id,
      targetPlayerId: opponent.id,
      zone,
      status: 'pending',
      createdAt: ctx.timestamp,
    });

    logAction(ctx, gameId, player.id, 'REQUEST_ZONE_SEARCH', JSON.stringify({ zone }), game.turnNumber, game.currentPhase);
  }
);
```

- [ ] **Step 2: Add approve_zone_search reducer**

```typescript
export const approve_zone_search = spacetimedb.reducer(
  {
    gameId: t.u64(),
    requestId: t.u64(),
  },
  (ctx, { gameId, requestId }) => {
    const player = findPlayerBySender(ctx, gameId);
    const req = ctx.db.ZoneSearchRequest.id.find(requestId);
    if (!req) throw new SenderError('Request not found');
    if (req.gameId !== gameId) throw new SenderError('Request not in this game');
    if (req.targetPlayerId !== player.id) throw new SenderError('Only the target player can approve');
    if (req.status !== 'pending') throw new SenderError('Request is not pending');

    ctx.db.ZoneSearchRequest.id.update({ ...req, status: 'approved' });
  }
);
```

- [ ] **Step 3: Add deny_zone_search reducer**

```typescript
export const deny_zone_search = spacetimedb.reducer(
  {
    gameId: t.u64(),
    requestId: t.u64(),
  },
  (ctx, { gameId, requestId }) => {
    const player = findPlayerBySender(ctx, gameId);
    const req = ctx.db.ZoneSearchRequest.id.find(requestId);
    if (!req) throw new SenderError('Request not found');
    if (req.gameId !== gameId) throw new SenderError('Request not in this game');
    if (req.targetPlayerId !== player.id) throw new SenderError('Only the target player can deny');
    if (req.status !== 'pending') throw new SenderError('Request is not pending');

    ctx.db.ZoneSearchRequest.id.delete(requestId);
  }
);
```

- [ ] **Step 4: Add complete_zone_search reducer**

```typescript
export const complete_zone_search = spacetimedb.reducer(
  {
    gameId: t.u64(),
    requestId: t.u64(),
  },
  (ctx, { gameId, requestId }) => {
    const player = findPlayerBySender(ctx, gameId);
    const req = ctx.db.ZoneSearchRequest.id.find(requestId);
    if (!req) throw new SenderError('Request not found');
    if (req.gameId !== gameId) throw new SenderError('Request not in this game');
    if (req.requesterId !== player.id) throw new SenderError('Only the requester can complete');
    if (req.status !== 'approved') throw new SenderError('Request is not approved');

    ctx.db.ZoneSearchRequest.id.delete(requestId);
  }
);
```

- [ ] **Step 5: Add move_opponent_card reducer**

```typescript
export const move_opponent_card = spacetimedb.reducer(
  {
    gameId: t.u64(),
    requestId: t.u64(),
    cardInstanceId: t.u64(),
    toZone: t.string(),
    posX: t.string(),
    posY: t.string(),
  },
  (ctx, { gameId, requestId, cardInstanceId, toZone, posX, posY }) => {
    const game = ctx.db.Game.id.find(gameId);
    if (!game) throw new SenderError('Game not found');

    const player = findPlayerBySender(ctx, gameId);

    // Validate approved request
    const req = ctx.db.ZoneSearchRequest.id.find(requestId);
    if (!req) throw new SenderError('Search request not found');
    if (req.gameId !== gameId) throw new SenderError('Request not in this game');
    if (req.requesterId !== player.id) throw new SenderError('Not your search request');
    if (req.status !== 'approved') throw new SenderError('Search request not approved');

    // Find and validate card
    const card = ctx.db.CardInstance.id.find(cardInstanceId);
    if (!card) throw new SenderError('Card not found');
    if (card.gameId !== gameId) throw new SenderError('Card not in this game');

    // Move the card
    const fromZone = card.zone;
    const isFlipped = toZone === 'deck';
    ctx.db.CardInstance.id.update({
      ...card,
      zone: toZone,
      zoneIndex: 0n,
      posX,
      posY,
      isFlipped,
    });

    logAction(ctx, gameId, player.id, 'MOVE_OPPONENT_CARD',
      JSON.stringify({ requestId: requestId.toString(), cardInstanceId: cardInstanceId.toString(), from: fromZone, to: toZone }),
      game.turnNumber, game.currentPhase);
  }
);
```

- [ ] **Step 6: Verify it compiles**

Run: `cd spacetimedb && npx tsc --noEmit --pretty 2>&1 | head -20`

- [ ] **Step 7: Commit**

```bash
git add spacetimedb/src/index.ts
git commit -m "feat: add zone search reducers (request/approve/deny/complete/move)"
```

---

## Task 3: Add Client Subscription and Hook Support

**Files:**
- Modify: `app/play/[code]/client.tsx`
- Modify: `app/play/hooks/useGameState.ts`

- [ ] **Step 1: Add subscription in client.tsx**

Find the `conn.subscriptionBuilder().subscribe([...])` array (around line 256) and add:

```
'SELECT * FROM zone_search_request',
```

- [ ] **Step 2: Add useTable subscription in useGameState.ts**

After the existing `useTable` calls (around line 112), add:

```typescript
const [allZoneSearchRequests, zsrLoading] = useTable(tables.ZoneSearchRequest) as [any[], boolean];
```

- [ ] **Step 3: Filter and expose zone search requests**

After the existing `useMemo` blocks that filter by gameId, add:

```typescript
const zoneSearchRequests = useMemo(
  () => allZoneSearchRequests.filter((r: any) => r.gameId === gameId),
  [allZoneSearchRequests, gameId],
);

// Pending request targeting the current player (for consent dialog)
const incomingSearchRequest = useMemo(() => {
  if (!myPlayer) return null;
  return zoneSearchRequests.find((r: any) => r.targetPlayerId === myPlayer.id && r.status === 'pending') ?? null;
}, [zoneSearchRequests, myPlayer]);

// Approved request from the current player (for browse modal)
const approvedSearchRequest = useMemo(() => {
  if (!myPlayer) return null;
  return zoneSearchRequests.find((r: any) => r.requesterId === myPlayer.id && r.status === 'approved') ?? null;
}, [zoneSearchRequests, myPlayer]);
```

- [ ] **Step 4: Add action methods for zone search reducers**

After the existing action methods:

```typescript
const requestZoneSearch = useCallback(
  (zone: string) => {
    conn?.reducers.requestZoneSearch({ gameId, zone });
  },
  [conn, gameId],
);

const approveZoneSearch = useCallback(
  (requestId: bigint) => {
    conn?.reducers.approveZoneSearch({ gameId, requestId });
  },
  [conn, gameId],
);

const denyZoneSearch = useCallback(
  (requestId: bigint) => {
    conn?.reducers.denyZoneSearch({ gameId, requestId });
  },
  [conn, gameId],
);

const completeZoneSearch = useCallback(
  (requestId: bigint) => {
    conn?.reducers.completeZoneSearch({ gameId, requestId });
  },
  [conn, gameId],
);

const moveOpponentCard = useCallback(
  (requestId: bigint, cardInstanceId: bigint, toZone: string, posX?: string, posY?: string) => {
    conn?.reducers.moveOpponentCard({
      gameId,
      requestId,
      cardInstanceId,
      toZone,
      posX: posX || '',
      posY: posY || '',
    });
  },
  [conn, gameId],
);
```

- [ ] **Step 5: Add to the returned gameState object**

Add to the return value of `useGameState`:

```typescript
incomingSearchRequest,
approvedSearchRequest,
requestZoneSearch,
approveZoneSearch,
denyZoneSearch,
completeZoneSearch,
moveOpponentCard,
```

- [ ] **Step 6: Verify it compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`

Note: This may show errors if the SpacetimeDB client bindings haven't been regenerated. The bindings auto-generate when the module is published. For type-checking locally, you may need to use `as any` casts on the reducer calls until bindings are regenerated. Verify this compiles or add appropriate `// @ts-expect-error` comments if needed.

- [ ] **Step 7: Commit**

```bash
git add app/play/[code]/client.tsx app/play/hooks/useGameState.ts
git commit -m "feat: add zone search subscription and action methods"
```

---

## Task 4: Create OpponentZoneContextMenu Component

**Files:**
- Create: `app/shared/components/OpponentZoneContextMenu.tsx`

- [ ] **Step 1: Create the component**

Follow the existing `LorContextMenu` pattern (same styling, same click-outside/Esc handling):

```typescript
'use client';

import { useEffect, useRef } from 'react';
import { Search } from 'lucide-react';

interface OpponentZoneContextMenuProps {
  x: number;
  y: number;
  zoneName: string; // Display name like "Deck", "Hand", "Reserve"
  onSearch: () => void;
  onClose: () => void;
}

export function OpponentZoneContextMenu({ x, y, zoneName, onSearch, onClose }: OpponentZoneContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose();
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [onClose]);

  return (
    <div
      ref={menuRef}
      onContextMenu={(e) => e.preventDefault()}
      style={{
        position: 'absolute',
        left: Math.min(x, typeof window !== 'undefined' ? window.innerWidth - 200 : x),
        top: Math.min(y, typeof window !== 'undefined' ? window.innerHeight - 60 : y),
        background: 'var(--gf-bg)',
        border: '1px solid var(--gf-border)',
        borderRadius: 6,
        padding: '4px 0',
        zIndex: 600,
        boxShadow: '0 8px 24px rgba(0,0,0,0.6)',
        whiteSpace: 'nowrap',
      }}
    >
      <button
        onClick={onSearch}
        onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--gf-hover)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          width: '100%',
          padding: '6px 14px',
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          color: 'var(--gf-text)',
          fontSize: 13,
          textAlign: 'left',
          fontFamily: 'var(--font-cinzel), Georgia, serif',
        }}
      >
        <Search size={14} />
        Search {zoneName}
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`

- [ ] **Step 3: Commit**

```bash
git add app/shared/components/OpponentZoneContextMenu.tsx
git commit -m "feat: add OpponentZoneContextMenu component"
```

---

## Task 5: Create ConsentDialog Component

**Files:**
- Create: `app/shared/components/ConsentDialog.tsx`

- [ ] **Step 1: Create the component**

```typescript
'use client';

interface ConsentDialogProps {
  requesterName: string;
  zoneName: string;
  onAllow: () => void;
  onDeny: () => void;
}

export function ConsentDialog({ requesterName, zoneName, onAllow, onDeny }: ConsentDialogProps) {
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 800,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0,0,0,0.7)',
      }}
    >
      <div
        style={{
          background: 'var(--gf-bg)',
          border: '1px solid var(--gf-border)',
          borderRadius: 8,
          padding: '24px 32px',
          maxWidth: 360,
          textAlign: 'center',
          boxShadow: '0 12px 40px rgba(0,0,0,0.8)',
        }}
      >
        <div
          style={{
            fontFamily: 'var(--font-cinzel), Georgia, serif',
            fontSize: 16,
            color: 'var(--gf-text-bright)',
            marginBottom: 8,
            letterSpacing: '0.05em',
          }}
        >
          Zone Search Request
        </div>
        <div
          style={{
            fontSize: 14,
            color: 'var(--gf-text)',
            marginBottom: 20,
            lineHeight: 1.5,
          }}
        >
          <strong style={{ color: 'var(--gf-accent)' }}>{requesterName}</strong> wants to search your <strong style={{ color: 'var(--gf-text-bright)' }}>{zoneName}</strong>.
        </div>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
          <button
            onClick={onAllow}
            style={{
              padding: '8px 24px',
              background: '#2d5a27',
              border: '1px solid #4a8a42',
              borderRadius: 6,
              color: '#c4e8bf',
              fontSize: 13,
              fontFamily: 'var(--font-cinzel), Georgia, serif',
              cursor: 'pointer',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = '#3a7332'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = '#2d5a27'; }}
          >
            Allow
          </button>
          <button
            onClick={onDeny}
            style={{
              padding: '8px 24px',
              background: '#5a2727',
              border: '1px solid #8a4242',
              borderRadius: 6,
              color: '#e8bfbf',
              fontSize: 13,
              fontFamily: 'var(--font-cinzel), Georgia, serif',
              cursor: 'pointer',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = '#733232'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = '#5a2727'; }}
          >
            Deny
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`

- [ ] **Step 3: Commit**

```bash
git add app/shared/components/ConsentDialog.tsx
git commit -m "feat: add ConsentDialog component for zone search approval"
```

---

## Task 6: Create OpponentBrowseModal Component

**Files:**
- Create: `app/shared/components/OpponentBrowseModal.tsx`

This is the most complex new component. It shows opponent zone cards with search/filter, action buttons, and drag-out support.

- [ ] **Step 1: Create the component**

Base it on the inline browse grid pattern but with search, action buttons, and drag support. The component receives opponent cards as props (not via context). Read `app/shared/components/ZoneBrowseModal.tsx` for the search/filter UI patterns to replicate, and `app/shared/components/DeckSearchModal.tsx` for the action popup pattern.

Key props:
```typescript
interface OpponentBrowseModalProps {
  zoneName: string;
  cards: GameCard[];
  onMoveCard: (cardId: string, toZone: string) => void;
  onClose: () => void;
  // Drag infrastructure
  onStartDrag?: (card: GameCard, imageUrl: string, e: React.PointerEvent) => void;
  didDragRef?: React.MutableRefObject<boolean>;
  isDragActive?: boolean;
}
```

Action buttons per card (shown on right-click or via popup):
- Discard — `onMoveCard(cardId, 'discard')`
- Banish — `onMoveCard(cardId, 'banish')`
- Top of Deck — `onMoveCard(cardId, 'deck-top')` (caller converts to moveCardToTopOfDeck)
- Bottom of Deck — `onMoveCard(cardId, 'deck-bottom')` (caller converts to moveCardToBottomOfDeck)
- Shuffle into Deck — `onMoveCard(cardId, 'deck-shuffle')` (caller converts to shuffleCardIntoDeck)

The full component implementation should:
- Render as a full overlay (same pattern as ZoneBrowseModal — absolute inset 0, z-index 700)
- Show a card grid with search bar (filter by name)
- Right-click a card to show action popup
- Support pointer-down drag to canvas
- Use `useCardPreview()` for hover loupe
- Use goldfish theme variables

This component is large enough that the implementer should read `ZoneBrowseModal.tsx` and `DeckSearchModal.tsx` for patterns, then build a simplified version focused on opponent actions.

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`

- [ ] **Step 3: Commit**

```bash
git add app/shared/components/OpponentBrowseModal.tsx
git commit -m "feat: add OpponentBrowseModal with search, actions, and drag"
```

---

## Task 7: Wire Everything into MultiplayerCanvas

**Files:**
- Modify: `app/play/components/MultiplayerCanvas.tsx`

This task wires the new components and SpacetimeDB state together.

- [ ] **Step 1: Add imports**

```typescript
import { OpponentZoneContextMenu } from '@/app/shared/components/OpponentZoneContextMenu';
import { ConsentDialog } from '@/app/shared/components/ConsentDialog';
import { OpponentBrowseModal } from '@/app/shared/components/OpponentBrowseModal';
import { showGameToast } from '@/app/shared/components/GameToast';
```

- [ ] **Step 2: Destructure zone search state from gameState**

Where `useGameState` is destructured, add:

```typescript
const {
  // ... existing destructured values ...
  incomingSearchRequest,
  approvedSearchRequest,
  requestZoneSearch,
  approveZoneSearch,
  denyZoneSearch,
  completeZoneSearch,
  moveOpponentCard,
} = gameState;
```

- [ ] **Step 3: Add opponent context menu state**

```typescript
const [opponentZoneMenu, setOpponentZoneMenu] = useState<{ x: number; y: number; zone: string; zoneName: string } | null>(null);
```

Add to `closeAllMenus`:
```typescript
setOpponentZoneMenu(null);
```

- [ ] **Step 4: Add right-click handler on opponent sidebar piles**

Find the opponent sidebar piles `<Group>` (around line 1800, the `SIDEBAR_ZONES.map` for opponent). Add `onContextMenu` to the `<Group>`:

```typescript
onContextMenu={['deck', 'hand', 'reserve'].includes(zoneKey) ? (e: Konva.KonvaEventObject<PointerEvent>) => {
  e.evt.preventDefault();
  const stage = stageRef.current;
  if (!stage) return;
  const container = stage.container().getBoundingClientRect();
  closeAllMenus();
  const zoneNames: Record<string, string> = { deck: 'Deck', hand: 'Hand', reserve: 'Reserve' };
  setOpponentZoneMenu({
    x: e.evt.clientX - container.left,
    y: e.evt.clientY - container.top,
    zone: zoneKey,
    zoneName: zoneNames[zoneKey] ?? zoneKey,
  });
} : undefined}
```

- [ ] **Step 5: Add right-click handler on opponent hand area**

The opponent hand renders bare `<CardBackShape>` elements in an IIFE (around line 1883). Wrap the outer `<Group>` with an `onContextMenu` handler:

```typescript
<Group
  onContextMenu={(e: Konva.KonvaEventObject<PointerEvent>) => {
    e.evt.preventDefault();
    const stage = stageRef.current;
    if (!stage) return;
    const container = stage.container().getBoundingClientRect();
    closeAllMenus();
    setOpponentZoneMenu({
      x: e.evt.clientX - container.left,
      y: e.evt.clientY - container.top,
      zone: 'hand',
      zoneName: 'Hand',
    });
  }}
>
  {/* existing CardBackShape rendering */}
</Group>
```

- [ ] **Step 6: Create opponent drag hook instance**

For drag-out from OpponentBrowseModal targeting any zone:

```typescript
const findZoneForOpponentDrag = useCallback((x: number, y: number): ZoneId | null => {
  const hit = findZoneAtPosition(x, y);
  if (!hit) return null;
  return hit.zone as ZoneId;
}, [findZoneAtPosition]);

const {
  dragState: opponentModalDrag,
  startDrag: opponentModalStartDrag,
  didDragRef: opponentModalDidDragRef,
} = useModalCardDrag({
  stageRef,
  zoneLayout: { ...myZones, ...opponentZones } as any,
  findZoneAtPosition: findZoneForOpponentDrag,
  moveCard: (id, toZone, _idx, posX, posY) => {
    if (approvedSearchRequest) {
      moveOpponentCard(
        BigInt(approvedSearchRequest.id),
        BigInt(id),
        String(toZone),
        posX?.toString(),
        posY?.toString()
      );
    }
  },
  moveCardsBatch: (ids, toZone) => {
    if (approvedSearchRequest) {
      for (const id of ids) {
        moveOpponentCard(BigInt(approvedSearchRequest.id), BigInt(id), String(toZone));
      }
    }
  },
  cardWidth,
  cardHeight,
});
```

- [ ] **Step 7: Watch for request status changes**

Add a useEffect to react to status changes — show toast on deny:

```typescript
const prevApprovedRef = useRef<any>(null);
useEffect(() => {
  // When an approved request appears, it's handled by the render (OpponentBrowseModal shows)
  // When a request is denied, the request row gets deleted, so we detect by tracking pending state
}, []);
```

For denied requests: since `deny_zone_search` deletes the row, the pending request disappears. Track this with a ref:

```typescript
const pendingRequestRef = useRef<bigint | null>(null);

useEffect(() => {
  const currentPending = zoneSearchRequests?.find(
    (r: any) => r.requesterId === myPlayer?.id && r.status === 'pending'
  );
  if (pendingRequestRef.current && !currentPending && !approvedSearchRequest) {
    // Was pending, now gone, and not approved = denied
    showGameToast('Search request denied');
  }
  pendingRequestRef.current = currentPending?.id ?? null;
}, [zoneSearchRequests, myPlayer, approvedSearchRequest]);
```

Note: You'll also need `zoneSearchRequests` exposed from useGameState. If not already exposed, add it.

- [ ] **Step 8: Render OpponentZoneContextMenu**

After existing context menus:

```tsx
{opponentZoneMenu && (
  <OpponentZoneContextMenu
    x={opponentZoneMenu.x}
    y={opponentZoneMenu.y}
    zoneName={opponentZoneMenu.zoneName}
    onSearch={() => {
      requestZoneSearch(opponentZoneMenu.zone);
      showGameToast('Waiting for opponent to approve...');
      setOpponentZoneMenu(null);
    }}
    onClose={() => setOpponentZoneMenu(null)}
  />
)}
```

- [ ] **Step 9: Render ConsentDialog**

```tsx
{incomingSearchRequest && (
  <ConsentDialog
    requesterName={opponentDisplayName ?? 'Opponent'}
    zoneName={incomingSearchRequest.zone}
    onAllow={() => approveZoneSearch(BigInt(incomingSearchRequest.id))}
    onDeny={() => denyZoneSearch(BigInt(incomingSearchRequest.id))}
  />
)}
```

Note: `opponentDisplayName` should be available from the game state. Check what player display name data is accessible and use the appropriate variable.

- [ ] **Step 10: Render OpponentBrowseModal**

```tsx
{approvedSearchRequest && (() => {
  const zoneCards = (opponentCards[approvedSearchRequest.zone] ?? [])
    .map(c => cardInstanceToGameCard(c, counters.get(c.id) ?? [], 'player2'));
  return (
    <OpponentBrowseModal
      zoneName={approvedSearchRequest.zone}
      cards={zoneCards}
      onMoveCard={(cardId, action) => {
        const reqId = BigInt(approvedSearchRequest.id);
        if (action === 'discard') {
          moveOpponentCard(reqId, BigInt(cardId), 'discard');
        } else if (action === 'banish') {
          moveOpponentCard(reqId, BigInt(cardId), 'banish');
        } else if (action === 'deck-top') {
          moveOpponentCard(reqId, BigInt(cardId), 'deck', '0', '0');
          // Note: For true "top of deck" positioning, the reducer would need zoneIndex logic.
          // The current move_opponent_card sets zoneIndex=0 which is top.
        } else if (action === 'deck-bottom') {
          moveOpponentCard(reqId, BigInt(cardId), 'deck', '0', '0');
          // For bottom, may need a dedicated reducer or zoneIndex param
        } else if (action === 'deck-shuffle') {
          moveOpponentCard(reqId, BigInt(cardId), 'deck');
          gameState.shuffleDeck(); // Shuffles opponent's deck
        }
      }}
      onClose={() => completeZoneSearch(BigInt(approvedSearchRequest.id))}
      onStartDrag={opponentModalStartDrag}
      didDragRef={opponentModalDidDragRef}
      isDragActive={opponentModalDrag.isDragging}
    />
  );
})()}
```

- [ ] **Step 11: Verify it compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`

- [ ] **Step 12: Commit**

```bash
git add app/play/components/MultiplayerCanvas.tsx
git commit -m "feat: wire opponent zone search into play mode canvas"
```

---

## Task 8: Manual Verification

- [ ] **Step 1: Publish SpacetimeDB module**

The new table and reducers need to be published to SpacetimeDB for the client bindings to be generated:

```bash
cd spacetimedb && npx spacetime publish --clear-database
```

Note: `--clear-database` is needed because we added a new table. This will reset all game data.

- [ ] **Step 2: Regenerate client bindings**

```bash
npx spacetime generate --lang typescript --out-dir ../lib/spacetimedb/module_bindings
```

- [ ] **Step 3: Start dev server and test**

```bash
npm run dev
```

Test flow:
1. Open two browser windows, start a play mode game
2. In Player A's window, right-click opponent's deck → "Search Deck" appears
3. Click "Search Deck" → toast shows "Waiting for opponent to approve..."
4. In Player B's window, consent dialog appears → click "Allow"
5. In Player A's window, OpponentBrowseModal opens showing opponent's deck cards
6. Test button actions: right-click a card → Discard, Banish, etc.
7. Test drag-out: drag a card from modal to Player A's territory
8. Close the modal
9. Repeat with "Deny" — verify toast shows "Request denied"
10. Test opponent hand search: right-click opponent hand area → "Search Hand"

- [ ] **Step 4: Fix any issues found during testing**

- [ ] **Step 5: Commit fixes**

```bash
git add -A
git commit -m "fix: address issues from manual verification"
```

---

## Summary

| Task | Description | Depends On |
|------|-------------|------------|
| 1 | Add ZoneSearchRequest table | — |
| 2 | Add zone search reducers | Task 1 |
| 3 | Client subscription + hook | Tasks 1-2 |
| 4 | OpponentZoneContextMenu | — |
| 5 | ConsentDialog | — |
| 6 | OpponentBrowseModal | — |
| 7 | Wire into MultiplayerCanvas | Tasks 3-6 |
| 8 | Publish, regenerate bindings, test | Task 7 |

Tasks 4-6 can run in parallel. Tasks 1-2 are sequential. Task 3 depends on 1-2. Task 7 depends on 3-6.
