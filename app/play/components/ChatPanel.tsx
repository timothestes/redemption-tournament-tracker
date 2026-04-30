'use client';

import { isValidElement, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode, type CSSProperties } from 'react';
import { useCardPreview } from '@/app/goldfish/state/CardPreviewContext';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ChatMessage {
  id: bigint;
  gameId: bigint;
  senderId: bigint;
  text: string;
  sentAt: { microsSinceUnixEpoch: bigint };
}

interface GameAction {
  id: bigint;
  gameId: bigint;
  playerId: bigint;
  actionType: string;
  payload: string;
  turnNumber: bigint;
  phase: string;
  timestamp: { microsSinceUnixEpoch: bigint };
}

type TabKey = 'chat' | 'log' | 'all';

interface ChatPanelProps {
  chatMessages: ChatMessage[];
  gameActions: GameAction[];
  myPlayerId: bigint;
  onSendChat: (text: string) => void;
  playerNames: Record<string, string>; // playerId.toString() → display name
  activeTab?: TabKey;
  onActiveTabChange?: (tab: TabKey) => void;
  /** Font scale for chat/log content. Defaults to 1.0. */
  chatScale?: number;
}

// Discriminated union for interleaved timeline entries
type TimelineEntry =
  | { kind: 'chat'; msg: ChatMessage; micros: bigint }
  | { kind: 'action'; action: GameAction; micros: bigint };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Keep in sync with RITUAL_TUMBLE_MS (1200) + dice reveal delay (600) in
// PregameScreen.tsx — this is how long the rolling animation runs before the
// die lands, so we hide PREGAME_ROLL log entries until then.
const PREGAME_ROLL_REVEAL_DELAY_MS = 1800;

/** Flatten a ReactNode (string, number, array, fragment, element) to plain text.
 *  Used to build searchable strings from the rich JSX returned by formatActionType. */
function nodeToText(node: ReactNode): string {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(nodeToText).join(' ');
  if (isValidElement(node)) {
    const props = node.props as { children?: ReactNode; name?: unknown };
    // HoverableCard / similar pass the card name as a `name` prop, not children.
    if (typeof props.name === 'string' && !props.children) return props.name;
    return nodeToText(props.children);
  }
  return '';
}

function formatTimestamp(micros: bigint): string {
  const ms = Number(micros / BigInt(1000));
  const date = new Date(ms);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

const ACTION_TYPE_LABELS: Record<string, string> = {
  DRAW: 'drew a card',
  // DRAW_MULTIPLE is handled inline in formatActionType (with count + private card names)
  MOVE_CARD: 'moved a card',
  MOVE_CARDS_BATCH: 'moved multiple cards',
  SEARCH_OWN_DECK: 'is searching their deck',
  SHUFFLE_DECK: 'shuffled their deck',
  SHUFFLE: 'shuffled their deck',
  SHUFFLE_CARD_INTO_DECK: 'shuffled a card into their deck',
  SHUFFLE_INTO_DECK: 'shuffled a card into their deck',
  MEEK_CARD: 'converted a card to meek',
  MEEK: 'converted a card to meek',
  UNMEEK_CARD: 'converted a card from meek',
  UNMEEK: 'converted a card from meek',
  FLIP_CARD: 'flipped a card',
  ADD_COUNTER: 'added a counter',
  REMOVE_COUNTER: 'removed a counter',
  SET_NOTE: 'set a note on a card',
  EXCHANGE: 'exchanged cards with their deck',
  EXCHANGE_CARDS: 'exchanged cards with their deck',
  SET_PHASE: 'moved to a new phase',
  END_TURN: 'ended their turn',
  ROLL_DICE: 'rolled dice',
  SEND_CHAT: 'sent a message',
  SET_PLAYER_OPTION: 'changed a setting',
  RESIGN: 'resigned',
  RESIGN_GAME: 'resigned',
  LEAVE_GAME: 'left the game',
  UPDATE_CARD_POSITION: 'repositioned a card',
  PREGAME_ROLL: 'rolled for first player',
  PLAYER_JOINED: 'joined the game',
  GAME_CREATED: 'created the game',
  REMATCH_REQUESTED: 'wants to play again',
  REMATCH_RESPONSE: 'responded to rematch',
};

function HoverableCard({ name, img }: { name: string; img?: string }) {
  const { setPreviewCard } = useCardPreview();
  if (name === 'a face-down card' || !img) return <span>{name}</span>;
  return (
    <span
      style={{ textDecoration: 'underline', textDecorationStyle: 'dotted', textUnderlineOffset: 2, cursor: 'pointer' }}
      onMouseEnter={() => setPreviewCard({ cardName: name, cardImgFile: img ?? '' })}
      onMouseLeave={() => {}}
    >
      {name}
    </span>
  );
}

function CardNameList({ cards }: { cards: { name: string; img: string }[] }) {
  return (
    <>
      {cards.map((c, i) => (
        <span key={i}>
          {i > 0 && ', '}
          <HoverableCard name={c.name} img={c.img} />
        </span>
      ))}
    </>
  );
}

function formatActionType(actionType: string, payload?: string, playerNames?: Record<string, string>, actorPlayerId?: string, viewerPlayerId?: string): ReactNode {
  if (actionType === 'ROLL_DICE' && payload) {
    try {
      const data = JSON.parse(payload);
      return `rolled a d${data.sides} → ${data.result}`;
    } catch { /* fall through */ }
  }
  if (actionType === 'GAME_STARTED' && payload) {
    try {
      const data = JSON.parse(payload);
      const chosenName = data.chosenName ?? ('Player ' + (Number(data.chosenSeat) + 1));
      return `chose ${chosenName} to go first`;
    } catch { /* fall through */ }
  }
  if (actionType === 'PREGAME_ROLL' && payload) {
    try {
      const data = JSON.parse(payload);
      const winnerRoll = data.winner === '0' ? data.result0 : data.result1;
      const loserRoll = data.winner === '0' ? data.result1 : data.result0;
      return `won the roll: ${winnerRoll} vs ${loserRoll}`;
    } catch { /* fall through */ }
  }
  if (actionType === 'DRAW_MULTIPLE') {
    if (payload) {
      try {
        const data = JSON.parse(payload);
        const count = data.count ? Number(data.count) : undefined;
        const isViewer = actorPlayerId && viewerPlayerId && actorPlayerId === viewerPlayerId;
        const hasCards = data.cards && Array.isArray(data.cards) && data.cards.length > 0;
        const countText = count ? `drew ${count} card${count === 1 ? '' : 's'}` : 'drew multiple cards';
        if (isViewer && hasCards) {
          return (
            <>
              {countText}: <CardNameList cards={data.cards} />
              <span style={{ fontSize: 'calc(9px * var(--chat-fs, 1))', fontStyle: 'italic', color: 'rgba(232, 213, 163, 0.35)', marginLeft: 4 }}>
                (only visible to you)
              </span>
            </>
          );
        }
        return countText;
      } catch { /* fall through */ }
    }
    return 'drew multiple cards';
  }
  if ((actionType === 'MEEK' || actionType === 'MEEK_CARD') && payload) {
    try {
      const data = JSON.parse(payload);
      if (data.cardName) return <>converted <HoverableCard name={data.cardName} img={data.cardImgFile} /> to meek</>;
    } catch { /* fall through */ }
  }
  if ((actionType === 'UNMEEK' || actionType === 'UNMEEK_CARD') && payload) {
    try {
      const data = JSON.parse(payload);
      if (data.cardName) return <>converted <HoverableCard name={data.cardName} img={data.cardImgFile} /> from meek</>;
    } catch { /* fall through */ }
  }
  if ((actionType === 'FLIP' || actionType === 'FLIP_CARD') && payload) {
    try {
      const data = JSON.parse(payload);
      if (!data.isFlipped && data.cardName) return <>flipped <HoverableCard name={data.cardName} img={data.cardImgFile} /> face up</>;
      return data.isFlipped ? 'turned a card face down' : 'flipped a card face up';
    } catch { /* fall through */ }
  }
  if (actionType === 'REVEAL_CARD' && payload) {
    try {
      const data = JSON.parse(payload);
      if (data.cardName) return <>revealed <HoverableCard name={data.cardName} img={data.cardImgFile} /> from hand</>;
      return 'revealed a card from hand';
    } catch { /* fall through */ }
  }
  if (actionType === 'SET_PHASE' && payload) {
    try {
      const data = JSON.parse(payload);
      if (data.phase) return `moved to ${data.phase}`;
    } catch { /* fall through */ }
  }
  if (actionType === 'SPAWN_LOST_SOUL') {
    return 'spawned a lost soul token';
  }
  if (actionType === 'REVEAL_CARDS' && payload) {
    try {
      const parsed = JSON.parse(payload);
      // New-shape payload from ability-triggered reveals — renders rich detail.
      if (parsed && !Array.isArray(parsed) && parsed.cardIds && parsed.context) {
        const ctx = parsed.context;
        const count = Number(ctx.count ?? (Array.isArray(parsed.cardIds) ? parsed.cardIds.length : 0));
        const position = ctx.position ?? 'top';
        const where = position === 'random' ? `${count} random` : `${position} ${count}`;
        const source: string | undefined = ctx.sourceCardName;
        if (source) {
          return <>revealed {where} card{count === 1 ? '' : 's'} of deck via <HoverableCard name={source} /></>;
        }
        return `revealed ${where} card${count === 1 ? '' : 's'} of deck`;
      }
      // Legacy raw cardIds array (deck-menu Reveal Top/Bottom/Random).
      if (Array.isArray(parsed)) {
        const n = parsed.length;
        return `revealed ${n} card${n === 1 ? '' : 's'}`;
      }
    } catch { /* fall through */ }
  }
  if (actionType === 'SHUFFLE_AND_DRAW' && payload) {
    try {
      const data = JSON.parse(payload);
      const shuffled = Number(data.shuffled ?? 0);
      const drawn = Number(data.drawn ?? 0);
      return `shuffled ${shuffled} from hand into deck and drew ${drawn}`;
    } catch { /* fall through */ }
  }
  if (actionType === 'DRAW_BOTTOM_OF_DECK' && payload) {
    try {
      const data = JSON.parse(payload);
      const count = Number(data.count ?? 1);
      const sourceName: string = data.sourceCardName ?? '';
      const sourceImg: string = data.sourceCardImgFile ?? '';
      const cards: { name: string; img: string }[] = Array.isArray(data.cards) ? data.cards : [];
      const isViewer = actorPlayerId && viewerPlayerId && actorPlayerId === viewerPlayerId;
      const prefix = count === 1 ? 'drew bottom card of deck' : `drew bottom ${count} cards of deck`;
      return (
        <>
          {prefix}
          {isViewer && cards.length > 0 ? (
            <>
              : <CardNameList cards={cards} />
              <span style={{ fontSize: 'calc(9px * var(--chat-fs, 1))', fontStyle: 'italic', color: 'rgba(232, 213, 163, 0.35)', marginLeft: 4 }}>
                (only visible to you)
              </span>
            </>
          ) : null}
          {sourceName ? (
            <>
              {' '}via <HoverableCard name={sourceName} img={sourceImg} />
            </>
          ) : null}
        </>
      );
    } catch { /* fall through */ }
  }
  if (actionType === 'RESERVE_TOP_OF_DECK' && payload) {
    try {
      const data = JSON.parse(payload);
      const count = Number(data.count ?? 1);
      const sourceName: string = data.sourceCardName ?? '';
      const sourceImg: string = data.sourceCardImgFile ?? '';
      const cards: { name: string; img: string }[] = Array.isArray(data.cards) ? data.cards : [];
      const hasCards = cards.length > 0;
      const prefix = count === 1 ? 'reserved top card of deck' : `reserved top ${count} cards of deck`;
      return (
        <>
          {prefix}
          {hasCards ? (
            <>
              : <CardNameList cards={cards} />
            </>
          ) : null}
          {sourceName ? (
            <>
              {' '}via <HoverableCard name={sourceName} img={sourceImg} />
            </>
          ) : null}
        </>
      );
    } catch { /* fall through */ }
  }
  if (actionType === 'SET_CARD_OUTLINE' && payload) {
    try {
      const data = JSON.parse(payload);
      const cardName: string = data.cardName ?? 'a card';
      const color = data.color === 'good' ? 'Good' : data.color === 'evil' ? 'Evil' : '';
      if (!color) {
        return <>cleared the outline on <HoverableCard name={cardName} img="" /></>;
      }
      return (
        <>
          chose <strong>{color}</strong> on <HoverableCard name={cardName} img="" />
        </>
      );
    } catch { /* fall through */ }
  }
  if (actionType === 'SPAWN_TOKEN' && payload) {
    try {
      const data = JSON.parse(payload);
      const count = Number(data.count ?? 1);
      const tokenName: string = data.tokenName ?? 'a token';
      const tokenImg: string = data.tokenImgFile ?? '';
      const sourceName: string = data.sourceCardName ?? '';
      const sourceImg: string = data.sourceCardImgFile ?? '';
      const tokenLabel = count > 1 ? `${count}× ${tokenName}` : tokenName;
      return (
        <>
          created <HoverableCard name={tokenLabel} img={tokenImg} />
          {sourceName ? (
            <>
              {' '}from <HoverableCard name={sourceName} img={sourceImg} />
            </>
          ) : null}
        </>
      );
    } catch { /* fall through */ }
  }
  if ((actionType === 'EXCHANGE' || actionType === 'EXCHANGE_CARDS') && payload) {
    try {
      const data = JSON.parse(payload);
      const count = data.count ? Number(data.count) : 0;
      const isViewer = actorPlayerId && viewerPlayerId && actorPlayerId === viewerPlayerId;
      const rawExchanged: { name: string; img: string; fromZone?: string; deckOwnerId?: string }[] = Array.isArray(data.cards) ? data.cards : [];
      // Hand cards are private — only reveal names/images to the actor themselves.
      const exchangedForDisplay = rawExchanged.map((c) => {
        if (!isViewer && c.fromZone === 'hand') {
          return { name: 'a card from hand', img: '' };
        }
        return { name: c.name, img: c.img };
      });
      const received: { name: string; img: string }[] = Array.isArray(data.received) ? data.received : [];
      const hasExchanged = exchangedForDisplay.length > 0;
      const hasReceived = received.length > 0;

      // Cross-player routing: cards going back to an opponent's deck get a
      // trailing clause so the log accurately reflects where they landed.
      const crossOwnerGroups = new Map<string, { name: string; img: string }[]>();
      for (let i = 0; i < rawExchanged.length; i++) {
        const raw = rawExchanged[i];
        const owner = raw.deckOwnerId;
        if (!owner || !actorPlayerId || owner === actorPlayerId) continue;
        const display = exchangedForDisplay[i];
        if (!display) continue;
        if (!crossOwnerGroups.has(owner)) crossOwnerGroups.set(owner, []);
        crossOwnerGroups.get(owner)!.push(display);
      }
      const crossClauses: ReactNode[] = [];
      for (const [ownerId, cards] of crossOwnerGroups) {
        const name = playerNames?.[ownerId];
        if (!name) continue;
        crossClauses.push(
          <span key={ownerId}>; sent <CardNameList cards={cards} /> to {name}&apos;s deck</span>
        );
      }

      if (hasExchanged && hasReceived) {
        return (
          <>
            exchanged <CardNameList cards={exchangedForDisplay} /> for <CardNameList cards={received} />
            {crossClauses}
          </>
        );
      }
      if (hasExchanged) {
        return (
          <>
            exchanged <CardNameList cards={exchangedForDisplay} /> with their deck
            {crossClauses}
          </>
        );
      }
      if (count > 0) {
        return `exchanged ${count} card${count === 1 ? '' : 's'} with their deck`;
      }
    } catch { /* fall through */ }
  }
  if (actionType === 'SURRENDER_LOST_SOUL' && payload) {
    try {
      const data = JSON.parse(payload);
      if (data.cardName) {
        const targetName = data.targetOwnerId && playerNames?.[data.targetOwnerId];
        return targetName
          ? <>surrendered <HoverableCard name={data.cardName} img={data.cardImgFile} /> to {targetName}&apos;s land of redemption</>
          : <>surrendered <HoverableCard name={data.cardName} img={data.cardImgFile} /></>;
      }
    } catch { /* fall through */ }
  }
  if (actionType === 'RESCUE_LOST_SOUL' && payload) {
    try {
      const data = JSON.parse(payload);
      if (data.cardName) {
        const fromOwnerName = data.fromOwnerId && data.fromOwnerId !== '0' && data.fromOwnerId !== actorPlayerId
          ? playerNames?.[data.fromOwnerId]
          : null;
        return fromOwnerName
          ? <>rescued <HoverableCard name={data.cardName} img={data.cardImgFile} /> from {fromOwnerName}&apos;s land of bondage</>
          : <>rescued <HoverableCard name={data.cardName} img={data.cardImgFile} /></>;
      }
    } catch { /* fall through */ }
  }
  if (actionType === 'MOVE_CARD' && payload) {
    try {
      const data = JSON.parse(payload);
      if (data.redirected && data.cardName) {
        return <>{data.redirected} <HoverableCard name={data.cardName} img={data.cardImgFile} /> but went to land of bondage instead</>;
      }
      if (data.cardName) {
        const isCrossPlayer = data.targetOwnerId && data.targetOwnerId !== actorPlayerId;
        const targetName = isCrossPlayer && playerNames?.[data.targetOwnerId];
        const cardEl = <HoverableCard name={data.cardName} img={data.cardImgFile} />;
        const fromCtx = targetName && data.from ? <> from {targetName}&apos;s {data.from}</> : null;
        if (data.to === 'discard') return targetName ? <>discarded {cardEl}{fromCtx} into {targetName}&apos;s discard</> : <>discarded {cardEl}</>;
        if (data.to === 'reserve') return targetName ? <>placed {cardEl}{fromCtx} into {targetName}&apos;s reserve</> : <>placed {cardEl} in reserve</>;
        if (data.to === 'banish') return targetName ? <>banished {cardEl}{fromCtx} into {targetName}&apos;s banish</> : <>banished {cardEl}</>;
        if (data.to === 'deck') return targetName ? <>put {cardEl}{fromCtx} into {targetName}&apos;s deck</> : 'put a card into their deck';
        if (data.to === 'hand') {
          const isCrossPlayer = data.targetOwnerId && data.targetOwnerId !== actorPlayerId;
          const targetName = isCrossPlayer && playerNames?.[data.targetOwnerId];
          return targetName
            ? <>moved <HoverableCard name={data.cardName} img={data.cardImgFile} /> to {targetName}&apos;s hand</>
            : <>moved <HoverableCard name={data.cardName} img={data.cardImgFile} /> to hand</>;
        }
        if (data.to === 'territory') {
          const isCrossPlayer = data.targetOwnerId && data.targetOwnerId !== actorPlayerId;
          const targetName = isCrossPlayer && playerNames?.[data.targetOwnerId];
          return targetName
            ? <>moved <HoverableCard name={data.cardName} img={data.cardImgFile} /> to {targetName}&apos;s territory</>
            : <>played <HoverableCard name={data.cardName} img={data.cardImgFile} /> to territory</>;
        }
        if (data.to === 'land-of-bondage') {
          const isCrossPlayer = data.targetOwnerId && data.targetOwnerId !== actorPlayerId;
          const targetName = isCrossPlayer && playerNames?.[data.targetOwnerId];
          return targetName
            ? <>sent <HoverableCard name={data.cardName} img={data.cardImgFile} /> to {targetName}&apos;s land of bondage</>
            : <>sent <HoverableCard name={data.cardName} img={data.cardImgFile} /> to land of bondage</>;
        }
        if (data.to === 'land-of-redemption') {
          const isCrossPlayer = data.targetOwnerId && data.targetOwnerId !== actorPlayerId;
          const targetName = isCrossPlayer && playerNames?.[data.targetOwnerId];
          return targetName
            ? <>moved <HoverableCard name={data.cardName} img={data.cardImgFile} /> to {targetName}&apos;s land of redemption</>
            : <>rescued <HoverableCard name={data.cardName} img={data.cardImgFile} /></>;
        }
      }
    } catch { /* fall through */ }
  }
  if (actionType === 'MOVE_OPPONENT_CARD' && payload) {
    try {
      const data = JSON.parse(payload);
      const cardEl = data.cardName ? <HoverableCard name={data.cardName} img={data.cardImgFile} /> : 'a card';
      const ownerName = data.cardOwnerName ?? 'opponent';
      if (data.to === 'discard') return <>discarded {cardEl} from {ownerName}&apos;s {data.from}</>;
      if (data.to === 'reserve') return <>placed {cardEl} in reserve from {ownerName}&apos;s {data.from}</>;
      if (data.to === 'banish') return <>banished {cardEl} from {ownerName}&apos;s {data.from}</>;
      if (data.to === 'deck') return <>put a card into {ownerName}&apos;s deck from {data.from}</>;
      if (data.to === 'hand') return <>took {cardEl} from {ownerName}&apos;s {data.from} to hand</>;
      if (data.to === 'territory') return <>moved {cardEl} from {ownerName}&apos;s {data.from} to territory</>;
      if (data.to === 'land-of-bondage') return <>sent {cardEl} from {ownerName}&apos;s {data.from} to land of bondage</>;
      if (data.to === 'land-of-redemption') return <>rescued {cardEl} from {ownerName}&apos;s {data.from}</>;
      return <>moved {cardEl} from {ownerName}&apos;s {data.from} to {data.to}</>;
    } catch { /* fall through */ }
  }
  if (actionType === 'MOVE_TO_TOP_OF_DECK' && payload) {
    try {
      const data = JSON.parse(payload);
      const isCrossPlayer = data.targetOwnerId && data.targetOwnerId !== actorPlayerId;
      const targetName = isCrossPlayer && playerNames?.[data.targetOwnerId];
      const cardEl = data.cardName && data.cardName !== 'a face-down card'
        ? <HoverableCard name={data.cardName} img={data.cardImgFile} />
        : 'a card';
      return targetName
        ? <>moved {cardEl} to top of {targetName}&apos;s deck</>
        : <>moved {cardEl} to top of their deck</>;
    } catch { /* fall through */ }
  }
  if (actionType === 'MOVE_TO_BOTTOM_OF_DECK' && payload) {
    try {
      const data = JSON.parse(payload);
      const isCrossPlayer = data.targetOwnerId && data.targetOwnerId !== actorPlayerId;
      const targetName = isCrossPlayer && playerNames?.[data.targetOwnerId];
      const cardEl = data.cardName && data.cardName !== 'a face-down card'
        ? <HoverableCard name={data.cardName} img={data.cardImgFile} />
        : 'a card';
      return targetName
        ? <>moved {cardEl} to bottom of {targetName}&apos;s deck</>
        : <>moved {cardEl} to bottom of their deck</>;
    } catch { /* fall through */ }
  }
  if (actionType === 'MOVE_CARDS_BATCH' && payload) {
    try {
      const data = JSON.parse(payload);
      const parts: ReactNode[] = [];
      const sourceName = data.sourceOwnerId && playerNames?.[data.sourceOwnerId] ? playerNames[data.sourceOwnerId] : null;
      const deckLabel = sourceName ? `${sourceName}'s deck` : 'deck';
      // Build a "from" suffix. Prefer the explicit fromSource (deck-derived
      // batch ops like "top of deck"); otherwise, if every card shares the
      // same originating zone, surface that — e.g. "from territory".
      const explicitFromSuffix = data.fromSource === 'top-of-deck' ? ` from top of ${deckLabel}`
        : data.fromSource === 'bottom-of-deck' ? ` from bottom of ${deckLabel}`
        : data.fromSource === 'random-from-deck' ? ` randomly from ${deckLabel}`
        : '';
      const cardFromZones: string[] = Array.isArray(data.cards)
        ? data.cards.map((c: { from?: string }) => c?.from).filter((z: string | undefined): z is string => !!z)
        : [];
      const allSameFrom = cardFromZones.length > 0 && cardFromZones.length === data.cards?.length
        && cardFromZones.every((z) => z === cardFromZones[0]);
      const commonFromZone = allSameFrom ? cardFromZones[0] : null;
      const ZONE_LABEL: Record<string, string> = {
        territory: 'territory',
        'land-of-bondage': 'land of bondage',
        'land-of-redemption': 'land of redemption',
        'soul-deck': 'soul deck',
        hand: 'hand', deck: 'deck', discard: 'discard', reserve: 'reserve', banish: 'banish',
      };
      const sharedFromSuffix = explicitFromSuffix
        || (commonFromZone && commonFromZone !== data.toZone
              ? ` from ${sourceName ? `${sourceName}'s ` : 'their '}${ZONE_LABEL[commonFromZone] ?? commonFromZone}`
              : '');
      const isCrossPlayerBatch = data.targetOwnerId && data.targetOwnerId !== actorPlayerId;
      const targetNameBatch = isCrossPlayerBatch && playerNames?.[data.targetOwnerId];
      const intoSuffix = (zone: string) => targetNameBatch ? <> into {targetNameBatch}&apos;s {zone}</> : null;
      if (data.cards?.length) {
        if (data.toZone === 'discard') parts.push(<span key="discard">discarded <CardNameList cards={data.cards} />{sharedFromSuffix}{intoSuffix('discard')}</span>);
        if (data.toZone === 'reserve') parts.push(<span key="reserve">reserved <CardNameList cards={data.cards} />{sharedFromSuffix}{intoSuffix('reserve')}</span>);
        if (data.toZone === 'banish') parts.push(<span key="banish">banished <CardNameList cards={data.cards} />{sharedFromSuffix}{intoSuffix('banish')}</span>);
        if (data.toZone === 'deck') {
          const allFaceDown = data.cards.every((c: { name?: string }) => c?.name === 'a face-down card');
          const deckTarget = targetNameBatch ? <>{targetNameBatch}&apos;s deck</> : <>their deck</>;
          parts.push(
            <span key="deck">
              {allFaceDown
                ? <>put {data.cards.length === 1 ? 'a card' : `${data.cards.length} cards`} into {deckTarget}</>
                : <>put <CardNameList cards={data.cards} />{sharedFromSuffix} into {deckTarget}</>}
            </span>
          );
        }
        if (data.toZone === 'hand') {
          const isCrossPlayer = data.targetOwnerId && playerNames?.[data.targetOwnerId] && data.targetOwnerId !== actorPlayerId;
          const targetName = isCrossPlayer && playerNames?.[data.targetOwnerId];
          const isViewer = actorPlayerId && viewerPlayerId && actorPlayerId === viewerPlayerId;
          const fromHiddenDeck = data.fromSource === 'top-of-deck' || data.fromSource === 'bottom-of-deck' || data.fromSource === 'random-from-deck';
          // Drawing from own deck into own hand is private — don't reveal card names to the opponent.
          const hideFromOpponent = !targetName && fromHiddenDeck && !isViewer;
          if (hideFromOpponent) {
            const n = data.cards.length;
            parts.push(<span key="hand">drew {n === 1 ? 'a card' : `${n} cards`}{explicitFromSuffix}</span>);
          } else {
            parts.push(<span key="hand">{targetName ? <>moved <CardNameList cards={data.cards} /> to {targetName}&apos;s hand{explicitFromSuffix}</> : <>drew <CardNameList cards={data.cards} />{explicitFromSuffix}{isViewer && fromHiddenDeck ? <span style={{ fontSize: 'calc(9px * var(--chat-fs, 1))', fontStyle: 'italic', color: 'rgba(232, 213, 163, 0.35)', marginLeft: 4 }}>(only visible to you)</span> : null}</>}</span>);
          }
        }
        if (data.toZone === 'territory') {
          const isCrossPlayer = data.targetOwnerId && data.targetOwnerId !== actorPlayerId;
          const targetName = isCrossPlayer && playerNames?.[data.targetOwnerId];
          parts.push(<span key="territory">{targetName ? <>moved <CardNameList cards={data.cards} /> to {targetName}&apos;s territory</> : <>played <CardNameList cards={data.cards} /> to territory</>}</span>);
        }
        if (data.toZone === 'land-of-bondage') {
          const isCrossPlayer = data.targetOwnerId && data.targetOwnerId !== actorPlayerId;
          const targetName = isCrossPlayer && playerNames?.[data.targetOwnerId];
          parts.push(<span key="lob">{targetName ? <>sent <CardNameList cards={data.cards} /> to {targetName}&apos;s land of bondage</> : <>sent <CardNameList cards={data.cards} /> to land of bondage</>}</span>);
        }
        if (data.toZone === 'land-of-redemption') {
          const isCrossPlayer = data.targetOwnerId && data.targetOwnerId !== actorPlayerId;
          const targetName = isCrossPlayer && playerNames?.[data.targetOwnerId];
          parts.push(<span key="lor">{targetName ? <>moved <CardNameList cards={data.cards} /> to {targetName}&apos;s land of redemption</> : <>rescued <CardNameList cards={data.cards} /></>}</span>);
        }
      }
      if (data.redirectedLostSouls?.length) {
        const actionWord = data.toZone === 'discard' ? 'discarded' : data.toZone === 'reserve' ? 'reserved' : 'banished';
        parts.push(<span key="redirect">{actionWord} <CardNameList cards={data.redirectedLostSouls} /> but went to land of bondage instead</span>);
      }
      if (parts.length) return <>{parts.map((p, i) => <span key={i}>{i > 0 && '; '}{p}</span>)}</>;
    } catch { /* fall through */ }
  }
  if ((actionType === 'SHUFFLE_INTO_DECK' || actionType === 'SHUFFLE_CARD_INTO_DECK') && payload) {
    try {
      const data = JSON.parse(payload);
      const isCrossPlayer = data.deckOwnerId && data.deckOwnerId !== actorPlayerId;
      const targetName = isCrossPlayer && playerNames?.[data.deckOwnerId];
      const cardEl = data.cardName && data.cardName !== 'a face-down card'
        ? <HoverableCard name={data.cardName} img={data.cardImgFile} />
        : 'a card';
      return targetName
        ? <>shuffled {cardEl} into {targetName}&apos;s deck</>
        : <>shuffled {cardEl} into their deck</>;
    } catch { /* fall through */ }
  }
  if (actionType === 'LOOK_AT_TOP' && payload) {
    // New format: JSON {count, sourceCardName, position}. Old format: bare count string.
    if (payload.startsWith('{')) {
      try {
        const data = JSON.parse(payload) as { count: number; sourceCardName?: string; position?: 'top' | 'bottom' | 'random' };
        const count = Number(data.count) || 0;
        const positionWord = data.position === 'bottom' ? 'bottom' : data.position === 'random' ? 'random' : 'top';
        const cardsWord = count === 1 ? 'card' : 'cards';
        const pickPhrase =
          positionWord === 'random'
            ? `at ${count} random ${cardsWord} from their deck`
            : `at the ${positionWord} ${count} ${cardsWord} of their deck`;
        if (data.sourceCardName) {
          return <>used <HoverableCard name={data.sourceCardName} /> to look {pickPhrase}</>;
        }
        return `looked ${pickPhrase}`;
      } catch { /* fall through */ }
    }
    const count = parseInt(payload, 10);
    if (count === 1) return 'looked at the top card of their deck';
    if (count > 1) return `looked at the top ${count} cards of their deck`;
    return 'looked at the top of their deck';
  }
  if (actionType === 'REVEAL_HAND') return 'revealed their hand for 30 seconds';
  if (actionType === 'HIDE_HAND') return 'hid their hand';
  if (actionType === 'REVEAL_RESERVE') return 'revealed their reserve';
  if (actionType === 'HIDE_RESERVE') return 'hid their reserve';
  if (actionType === 'REQUEST_ZONE_SEARCH' && payload) {
    try {
      const data = JSON.parse(payload);
      const zoneName = data.zone === 'hand-reveal' ? 'hand' : data.zone === 'action-priority' ? 'action priority' : data.zone;
      const targetName = data.targetName ?? 'opponent';
      if (data.zone === 'hand-reveal') return `requested to reveal ${targetName}'s hand`;
      if (data.zone === 'action-priority') return `requested action priority`;
      return `requested to search ${targetName}'s ${zoneName}`;
    } catch { /* fall through */ }
  }
  if (actionType === 'REQUEST_OPPONENT_ACTION' && payload) {
    try {
      const data = JSON.parse(payload);
      const targetName = data.targetName ?? 'opponent';
      let count = 0;
      try { count = data.actionParams ? (JSON.parse(data.actionParams).count ?? 0) : 0; } catch {}
      const plural = count === 1 ? '' : 's';
      switch (data.action) {
        case 'shuffle_deck': return `asked to shuffle ${targetName}'s deck`;
        case 'look_deck_top': return `asked to look at the top ${count} card${plural} of ${targetName}'s deck`;
        case 'look_deck_bottom': return `asked to look at the bottom ${count} card${plural} of ${targetName}'s deck`;
        case 'look_deck_random': return `asked to look at ${count} random card${plural} from ${targetName}'s deck`;
        case 'reveal_deck_top': return `asked to reveal the top ${count} card${plural} of ${targetName}'s deck`;
        case 'reveal_deck_bottom': return `asked to reveal the bottom ${count} card${plural} of ${targetName}'s deck`;
        case 'reveal_deck_random': return `asked to reveal ${count} random card${plural} from ${targetName}'s deck`;
        case 'draw_deck_top': return `asked to draw ${count} from the top of ${targetName}'s deck`;
        case 'draw_deck_bottom': return `asked to draw ${count} from the bottom of ${targetName}'s deck`;
        case 'draw_deck_random': return `asked to draw ${count} random card${plural} from ${targetName}'s deck`;
        case 'discard_deck_top': return `asked to discard the top ${count} card${plural} of ${targetName}'s deck`;
        case 'discard_deck_bottom': return `asked to discard the bottom ${count} card${plural} of ${targetName}'s deck`;
        case 'discard_deck_random': return `asked to discard ${count} random card${plural} from ${targetName}'s deck`;
        case 'reserve_deck_top': return `asked to send the top ${count} card${plural} of ${targetName}'s deck to reserve`;
        case 'reserve_deck_bottom': return `asked to send the bottom ${count} card${plural} of ${targetName}'s deck to reserve`;
        case 'reserve_deck_random': return `asked to send ${count} random card${plural} from ${targetName}'s deck to reserve`;
        case 'random_hand_to_discard': return `asked to discard ${count} random card${plural} from ${targetName}'s hand`;
        case 'random_hand_to_reserve': return `asked to send ${count} random card${plural} from ${targetName}'s hand to reserve`;
        case 'random_hand_to_deck_top': return `asked to send ${count} random card${plural} from ${targetName}'s hand to the top of their deck`;
        case 'random_hand_to_deck_bottom': return `asked to send ${count} random card${plural} from ${targetName}'s hand to the bottom of their deck`;
        case 'random_hand_to_deck_shuffle': return `asked to shuffle ${count} random card${plural} from ${targetName}'s hand into their deck`;
        case 'shuffle_and_draw': {
          let s = 0, d = 0;
          try {
            const p = data.actionParams ? JSON.parse(data.actionParams) : {};
            s = p.shuffleCount ?? 0; d = p.drawCount ?? 0;
          } catch {}
          return `asked ${targetName} to shuffle ${s} from hand into deck and draw ${d}`;
        }
        default: return `asked to perform an action on ${targetName}'s deck`;
      }
    } catch { /* fall through */ }
  }
  if (actionType === 'APPROVE_ZONE_SEARCH' && payload) {
    try {
      const data = JSON.parse(payload);
      if (data.zone === 'hand-reveal') return 'approved hand reveal';
      if (data.zone === 'action-priority') return 'granted action priority';
      return `allowed ${data.zone} search`;
    } catch { /* fall through */ }
  }
  if (actionType === 'DENY_ZONE_SEARCH' && payload) {
    try {
      const data = JSON.parse(payload);
      if (data.zone === 'hand-reveal') return 'denied hand reveal';
      if (data.zone === 'action-priority') return 'denied action priority';
      return `denied ${data.zone} search`;
    } catch { /* fall through */ }
  }
  if (actionType === 'COMPLETE_ZONE_SEARCH' && payload) {
    try {
      const data = JSON.parse(payload);
      const targetName = data.targetName ?? 'opponent';
      if (data.zone === 'hand-reveal') return `finished viewing ${targetName}'s hand`;
      if (data.zone === 'action-priority') return 'finished action priority';
      if (data.zone === 'deck') {
        const suffix = data.shuffled ? ' (and shuffled it)' : ' (and chose not to shuffle it)';
        return `finished searching ${targetName}'s deck${suffix}`;
      }
      return `finished searching ${targetName}'s ${data.zone}`;
    } catch { /* fall through */ }
  }
  if (actionType === 'ADD_COUNTER' && payload) {
    try {
      const data = JSON.parse(payload);
      if (data.cardName) return <>added {data.color} counter to <HoverableCard name={data.cardName} img={data.cardImgFile} /></>;
    } catch { /* fall through */ }
  }
  if (actionType === 'REMOVE_COUNTER' && payload) {
    try {
      const data = JSON.parse(payload);
      if (data.cardName) return <>removed {data.color} counter from <HoverableCard name={data.cardName} img={data.cardImgFile} /></>;
    } catch { /* fall through */ }
  }
  if (actionType === 'RANDOM_HAND_TO_ZONE' && payload) {
    try {
      const data = JSON.parse(payload);
      const count = Number(data.count ?? 0);
      const plural = count === 1 ? '' : 's';
      const destination: string = data.destination ?? '';
      const isViewer = actorPlayerId && viewerPlayerId && actorPlayerId === viewerPlayerId;
      const rawCards: { name: string; img: string }[] = Array.isArray(data.cards) ? data.cards : [];

      let verb: string;
      if (destination === 'discard') verb = `discarded ${count} random card${plural} from their hand`;
      else if (destination === 'reserve') verb = `sent ${count} random card${plural} from their hand to reserve`;
      else if (destination === 'banish') verb = `banished ${count} random card${plural} from their hand`;
      else if (destination === 'land-of-bondage') verb = `sent ${count} random card${plural} from their hand to land of bondage`;
      else if (destination === 'deck (top)') verb = `put ${count} random card${plural} from their hand on top of their deck`;
      else if (destination === 'deck (bottom)') verb = `put ${count} random card${plural} from their hand on the bottom of their deck`;
      else if (destination === 'deck (shuffle)') verb = `shuffled ${count} random card${plural} from their hand into their deck`;
      else verb = `moved ${count} random card${plural} from their hand to ${destination}`;

      if (isViewer && rawCards.length > 0) {
        return (
          <>
            {verb}: <CardNameList cards={rawCards} />
            <span style={{ fontSize: 'calc(9px * var(--chat-fs, 1))', fontStyle: 'italic', color: 'rgba(232, 213, 163, 0.35)', marginLeft: 4 }}>
              (only visible to you)
            </span>
          </>
        );
      }
      return verb;
    } catch { /* fall through */ }
  }
  if (actionType === 'SET_NOTE' && payload) {
    try {
      const data = JSON.parse(payload);
      if (data.cardName) {
        const note = typeof data.note === 'string' ? data.note : '';
        const previous = typeof data.previousNote === 'string' ? data.previousNote : '';
        if (!note && previous) {
          return <>cleared note on <HoverableCard name={data.cardName} img={data.cardImgFile} /></>;
        }
        if (note && !previous) {
          return <>added note &ldquo;{note}&rdquo; to <HoverableCard name={data.cardName} img={data.cardImgFile} /></>;
        }
        if (note && previous) {
          return <>edited note on <HoverableCard name={data.cardName} img={data.cardImgFile} /> to &ldquo;{note}&rdquo;</>;
        }
      }
    } catch { /* fall through */ }
  }
  return ACTION_TYPE_LABELS[actionType] ?? actionType.toLowerCase().replace(/_/g, ' ');
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ChatPanel({
  chatMessages,
  gameActions,
  myPlayerId,
  onSendChat,
  playerNames,
  activeTab: controlledTab,
  onActiveTabChange,
  chatScale = 1,
}: ChatPanelProps) {
  const [isOpen, setIsOpen] = useState(true);
  const [internalTab, setInternalTab] = useState<TabKey>('all');
  const activeTab = controlledTab ?? internalTab;
  const setActiveTab = onActiveTabChange ?? setInternalTab;
  const [inputText, setInputText] = useState('');
  const [unreadCount, setUnreadCount] = useState(0);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);
  const normalizedQuery = searchQuery.trim().toLowerCase();
  const isSearching = normalizedQuery.length > 0;

  // Delay PREGAME_ROLL log entries so they appear when the dice land, not
  // when the server broadcasts the roll. Actions present on first mount are
  // considered "already revealed" so a mid-game refresh doesn't re-hide them.
  const seenActionIdsRef = useRef<Set<string> | null>(null);
  const [hiddenActionIds, setHiddenActionIds] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    if (seenActionIdsRef.current === null) {
      seenActionIdsRef.current = new Set(gameActions.map((a) => a.id.toString()));
      return;
    }
    const newIds: string[] = [];
    for (const action of gameActions) {
      const id = action.id.toString();
      if (seenActionIdsRef.current.has(id)) continue;
      seenActionIdsRef.current.add(id);
      if (action.actionType === 'PREGAME_ROLL') newIds.push(id);
    }
    if (newIds.length === 0) return;
    setHiddenActionIds((prev) => {
      const next = new Set(prev);
      for (const id of newIds) next.add(id);
      return next;
    });
    const timers = newIds.map((id) =>
      setTimeout(() => {
        setHiddenActionIds((prev) => {
          if (!prev.has(id)) return prev;
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }, PREGAME_ROLL_REVEAL_DELAY_MS),
    );
    return () => timers.forEach(clearTimeout);
  }, [gameActions]);

  const visibleGameActions = (hiddenActionIds.size === 0
    ? gameActions
    : gameActions.filter((a) => !hiddenActionIds.has(a.id.toString()))
  ).filter((a) => {
    // Suppress "finished action priority" — the grant/request pair is enough.
    if (a.actionType === 'COMPLETE_ZONE_SEARCH' && a.payload) {
      try {
        if (JSON.parse(a.payload).zone === 'action-priority') return false;
      } catch { /* fall through */ }
    }
    return true;
  });

  // ---- Search filter ----
  // Build a lowercased searchable string for each visible action by flattening
  // the rich JSX returned by formatActionType to plain text. Memoized by id +
  // payload so re-renders don't redo the work.
  const actionSearchText = useMemo(() => {
    const map = new Map<string, string>();
    for (const a of visibleGameActions) {
      const playerName = playerNames[a.playerId.toString()] ?? `Player ${a.playerId}`;
      const verb = formatActionType(a.actionType, a.payload, playerNames, a.playerId.toString(), myPlayerId.toString());
      map.set(a.id.toString(), `${playerName} ${nodeToText(verb)} ${a.actionType}`.toLowerCase());
    }
    return map;
  }, [visibleGameActions, playerNames, myPlayerId]);

  const matchesQuery = (text: string) => !isSearching || text.includes(normalizedQuery);

  const filteredChat = isSearching
    ? chatMessages.filter((msg) => {
        const senderName = playerNames[msg.senderId.toString()] ?? '';
        return `${senderName} ${msg.text}`.toLowerCase().includes(normalizedQuery);
      })
    : chatMessages;

  const filteredActions = isSearching
    ? visibleGameActions.filter((a) => matchesQuery(actionSearchText.get(a.id.toString()) ?? ''))
    : visibleGameActions;

  const totalMatches = isSearching ? filteredChat.length + filteredActions.length : 0;

  const chatEndRef = useRef<HTMLDivElement>(null);
  const logEndRef = useRef<HTMLDivElement>(null);
  const allEndRef = useRef<HTMLDivElement>(null);
  const prevChatLengthRef = useRef(chatMessages.length);

  // Track unread messages when chat isn't actively visible
  useEffect(() => {
    const chatVisible = isOpen && (activeTab === 'chat' || activeTab === 'all');
    if (!chatVisible && chatMessages.length > prevChatLengthRef.current) {
      setUnreadCount((n) => n + (chatMessages.length - prevChatLengthRef.current));
    }
    prevChatLengthRef.current = chatMessages.length;
  }, [chatMessages.length, isOpen, activeTab]);

  // Clear unread when opening chat or all tab
  useEffect(() => {
    if (isOpen && (activeTab === 'chat' || activeTab === 'all')) {
      setUnreadCount(0);
    }
  }, [isOpen, activeTab]);

  // Auto-scroll chat to bottom when new messages arrive (paused while searching
  // so the user can read filtered results without being yanked to the bottom).
  useEffect(() => {
    if (isSearching) return;
    if (isOpen && activeTab === 'chat') {
      chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [chatMessages, isOpen, activeTab, isSearching]);

  // Auto-scroll log to bottom when new actions arrive or tab switches
  const prevLogTab = useRef(activeTab);
  useEffect(() => {
    if (isSearching) { prevLogTab.current = activeTab; return; }
    if (isOpen && activeTab === 'log') {
      // Instant scroll when first switching to log tab, smooth for new entries
      const justSwitched = prevLogTab.current !== 'log';
      logEndRef.current?.scrollIntoView({ behavior: justSwitched ? 'instant' : 'smooth' });
    }
    prevLogTab.current = activeTab;
  }, [gameActions, isOpen, activeTab, hiddenActionIds, isSearching]);

  // Auto-scroll combined "all" tab to bottom
  const prevAllTab = useRef(activeTab);
  useEffect(() => {
    if (isSearching) { prevAllTab.current = activeTab; return; }
    if (isOpen && activeTab === 'all') {
      const justSwitched = prevAllTab.current !== 'all';
      allEndRef.current?.scrollIntoView({ behavior: justSwitched ? 'instant' : 'smooth' });
    }
    prevAllTab.current = activeTab;
  }, [chatMessages, gameActions, isOpen, activeTab, hiddenActionIds, isSearching]);

  // Focus the search input when the search bar opens.
  useEffect(() => {
    if (searchOpen) searchInputRef.current?.focus();
  }, [searchOpen]);

  const handleSend = () => {
    const trimmed = inputText.trim();
    if (!trimmed) return;
    onSendChat(trimmed);
    setInputText('');
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const togglePanel = () => {
    setIsOpen((prev) => !prev);
  };

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      flex: 1,
      overflow: 'hidden',
      fontFamily: 'var(--font-geist-sans, system-ui, sans-serif)',
      ['--chat-fs' as string]: chatScale,
    } as CSSProperties}>
      {/* ================================================================
          Toggle button — horizontal row in the sidebar
          ================================================================ */}
      <button
        onClick={togglePanel}
        aria-label={isOpen ? 'Close chat panel' : 'Open chat panel'}
        style={{
          width: '100%',
          padding: '8px 12px',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          background: isOpen ? 'rgba(196, 149, 90, 0.08)' : 'transparent',
          border: 'none',
          borderBottom: '1px solid rgba(107, 78, 39, 0.2)',
          color: '#e8d5a3',
          cursor: 'pointer',
          fontSize: 'calc(11px * var(--chat-fs, 1))',
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          fontFamily: 'inherit',
          flexShrink: 0,
        }}
      >
        {/* Chat bubble icon */}
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          style={{ flexShrink: 0 }}
        >
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
        Chat
        {/* Unread badge */}
        {unreadCount > 0 && (
          <span
            aria-label={`${unreadCount} unread messages`}
            style={{
              background: '#c4955a',
              color: '#0a0805',
              borderRadius: '50%',
              fontSize: 'calc(9px * var(--chat-fs, 1))',
              fontWeight: 700,
              minWidth: 16,
              height: 16,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '0 3px',
              marginLeft: 'auto',
            }}
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
        {/* Chevron indicator */}
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          style={{
            flexShrink: 0,
            marginLeft: unreadCount > 0 ? 0 : 'auto',
            transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: 'transform 0.15s ease',
          }}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {/* ================================================================
          Panel content — conditionally rendered when open
          ================================================================ */}
      {isOpen && (
        <div
          role="complementary"
          aria-label="Chat and game log panel"
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            background: 'rgba(10, 8, 5, 0.97)',
          }}
        >
          {/* ---- Header with tabs ---- */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr auto 1fr',
              alignItems: 'center',
              padding: '6px 8px',
              borderBottom: '1px solid rgba(107, 78, 39, 0.3)',
              flexShrink: 0,
            }}
          >
            <span aria-hidden />
            {/* Tabs */}
            <div style={{ display: 'flex', gap: 4 }}>
              {(['all', 'chat', 'log'] as const).map((tab) => {
                const isActive = activeTab === tab;
                const label = tab === 'chat' ? 'Chat' : tab === 'log' ? 'Log' : 'All';
                return (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    style={{
                      padding: '3px 10px',
                      background: isActive ? 'rgba(196, 149, 90, 0.12)' : 'transparent',
                      border: `1px solid ${isActive ? 'rgba(196, 149, 90, 0.45)' : 'transparent'}`,
                      borderRadius: 20,
                      cursor: 'pointer',
                      fontSize: 'calc(10px * var(--chat-fs, 1))',
                      letterSpacing: '0.07em',
                      textTransform: 'uppercase',
                      color: isActive ? '#e8d5a3' : 'rgba(232, 213, 163, 0.4)',
                      fontFamily: 'inherit',
                      transition: 'color 0.15s, background 0.15s, border-color 0.15s',
                    }}
                  >
                    {tab === 'chat' ? (
                      <span style={{ position: 'relative' }}>
                        Chat
                        {unreadCount > 0 && activeTab !== 'chat' && activeTab !== 'all' && (
                          <span
                            style={{
                              position: 'absolute',
                              top: -1,
                              right: -7,
                              width: 6,
                              height: 6,
                              borderRadius: '50%',
                              background: '#c4955a',
                              boxShadow: '0 0 4px rgba(196, 149, 90, 0.6)',
                            }}
                          />
                        )}
                      </span>
                    ) : label}
                  </button>
                );
              })}
            </div>
            {/* Search toggle (right-aligned in the grid) */}
            <div style={{ justifySelf: 'end' }}>
              <button
                onClick={() => {
                  setSearchOpen((prev) => {
                    const next = !prev;
                    if (!next) setSearchQuery('');
                    return next;
                  });
                }}
                aria-label={searchOpen ? 'Close search' : 'Search messages and log'}
                aria-pressed={searchOpen}
                title={searchOpen ? 'Close search' : 'Search'}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 24,
                  height: 24,
                  padding: 0,
                  background: searchOpen ? 'rgba(196, 149, 90, 0.18)' : 'transparent',
                  border: `1px solid ${searchOpen ? 'rgba(196, 149, 90, 0.45)' : 'transparent'}`,
                  borderRadius: 4,
                  cursor: 'pointer',
                  color: searchOpen ? '#e8d5a3' : 'rgba(232, 213, 163, 0.55)',
                  transition: 'color 0.15s, background 0.15s, border-color 0.15s',
                }}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <circle cx="11" cy="11" r="7" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
              </button>
            </div>
          </div>

          {/* ---- Search bar (collapsible) ---- */}
          {searchOpen && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '6px 8px',
                borderBottom: '1px solid rgba(107, 78, 39, 0.3)',
                background: 'rgba(196, 149, 90, 0.04)',
                flexShrink: 0,
              }}
            >
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    e.preventDefault();
                    setSearchQuery('');
                    setSearchOpen(false);
                  }
                }}
                placeholder="Search messages, actions, cards..."
                style={{
                  flex: 1,
                  minWidth: 0,
                  background: 'rgba(255, 255, 255, 0.06)',
                  border: '1px solid rgba(107, 78, 39, 0.35)',
                  borderRadius: 4,
                  padding: '4px 8px',
                  color: '#e8d5a3',
                  fontSize: 'calc(11px * var(--chat-fs, 1))',
                  fontFamily: 'inherit',
                  outline: 'none',
                }}
                aria-label="Search messages and log"
              />
              <span
                style={{
                  fontSize: 'calc(10px * var(--chat-fs, 1))',
                  color: 'rgba(232, 213, 163, 0.45)',
                  fontVariantNumeric: 'tabular-nums',
                  whiteSpace: 'nowrap',
                  minWidth: 56,
                  textAlign: 'right',
                }}
              >
                {isSearching ? `${totalMatches} ${totalMatches === 1 ? 'match' : 'matches'}` : 'Esc to close'}
              </span>
            </div>
          )}

          {/* ---- Tab: Chat ---- */}
          {activeTab === 'chat' && (
            <>
              {/* Message list */}
              <div
                style={{
                  flex: 1,
                  overflowY: 'auto',
                  padding: '8px 8px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                }}
              >
                {filteredChat.length === 0 && (
                  <p
                    style={{
                      color: 'rgba(232, 213, 163, 0.3)',
                      fontSize: 'calc(11px * var(--chat-fs, 1))',
                      textAlign: 'center',
                      marginTop: 16,
                      fontStyle: 'italic',
                    }}
                  >
                    {isSearching ? 'No matches.' : 'No messages yet.'}
                  </p>
                )}
                {filteredChat.map((msg) => {
                  const isMe = msg.senderId === myPlayerId;
                  const senderName =
                    playerNames[msg.senderId.toString()] ??
                    (isMe ? 'You' : `Player ${msg.senderId}`);
                  const time = formatTimestamp(msg.sentAt.microsSinceUnixEpoch);

                  return (
                    <div
                      key={msg.id.toString()}
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: isMe ? 'flex-end' : 'flex-start',
                      }}
                    >
                      {/* Sender + time */}
                      <div
                        style={{
                          display: 'flex',
                          gap: 4,
                          alignItems: 'baseline',
                          marginBottom: 2,
                          flexDirection: isMe ? 'row-reverse' : 'row',
                        }}
                      >
                        <span
                          style={{
                            fontWeight: 700,
                            fontSize: 'calc(10px * var(--chat-fs, 1))',
                            color: isMe ? '#c4955a' : '#4a7ab5',
                            letterSpacing: '0.02em',
                          }}
                        >
                          {senderName}
                        </span>
                        <span
                          style={{
                            fontSize: 'calc(9px * var(--chat-fs, 1))',
                            color: 'rgba(232, 213, 163, 0.3)',
                            fontVariantNumeric: 'tabular-nums',
                          }}
                        >
                          {time}
                        </span>
                      </div>

                      {/* Bubble */}
                      <div
                        style={{
                          maxWidth: '90%',
                          padding: '4px 8px',
                          borderRadius: isMe ? '10px 10px 3px 10px' : '10px 10px 10px 3px',
                          background: isMe
                            ? 'rgba(196, 149, 90, 0.14)'
                            : 'rgba(255, 255, 255, 0.06)',
                          border: isMe
                            ? '1px solid rgba(196, 149, 90, 0.3)'
                            : '1px solid rgba(255, 255, 255, 0.08)',
                          fontSize: 'calc(12px * var(--chat-fs, 1))',
                          color: '#e8d5a3',
                          lineHeight: 1.4,
                          wordBreak: 'break-word',
                        }}
                      >
                        {msg.text}
                      </div>
                    </div>
                  );
                })}
                <div ref={chatEndRef} />
              </div>

              {/* Input row */}
              <div
                style={{
                  padding: '6px 8px',
                  borderTop: '1px solid rgba(107, 78, 39, 0.3)',
                  display: 'flex',
                  gap: 4,
                  flexShrink: 0,
                }}
              >
                <input
                  type="text"
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Message..."
                  maxLength={500}
                  style={{
                    flex: 1,
                    minWidth: 0,
                    background: 'rgba(255, 255, 255, 0.06)',
                    border: '1px solid rgba(107, 78, 39, 0.35)',
                    borderRadius: 4,
                    padding: '5px 8px',
                    color: '#e8d5a3',
                    fontSize: 'calc(12px * var(--chat-fs, 1))',
                    fontFamily: 'inherit',
                    outline: 'none',
                  }}
                  aria-label="Chat message"
                />
                <button
                  onClick={handleSend}
                  disabled={!inputText.trim()}
                  aria-label="Send message"
                  style={{
                    padding: '5px 8px',
                    background:
                      inputText.trim()
                        ? 'rgba(196, 149, 90, 0.18)'
                        : 'rgba(255, 255, 255, 0.04)',
                    border: `1px solid ${inputText.trim() ? 'rgba(196, 149, 90, 0.5)' : 'rgba(107, 78, 39, 0.2)'}`,
                    borderRadius: 4,
                    color: inputText.trim() ? '#e8d5a3' : 'rgba(232, 213, 163, 0.3)',
                    cursor: inputText.trim() ? 'pointer' : 'default',
                    fontSize: 'calc(10px * var(--chat-fs, 1))',
                    letterSpacing: '0.06em',
                    textTransform: 'uppercase',
                    fontFamily: 'inherit',
                    transition: 'background 0.15s, color 0.15s, border-color 0.15s',
                    flexShrink: 0,
                  }}
                >
                  Send
                </button>
              </div>
            </>
          )}

          {/* ---- Tab: Game Log ---- */}
          {activeTab === 'log' && (
            <div
              style={{
                flex: 1,
                overflowY: 'auto',
                padding: '8px 8px',
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
              }}
            >
              {filteredActions.length === 0 && (
                <p
                  style={{
                    color: 'rgba(232, 213, 163, 0.3)',
                    fontSize: 'calc(11px * var(--chat-fs, 1))',
                    textAlign: 'center',
                    marginTop: 16,
                    fontStyle: 'italic',
                  }}
                >
                  {isSearching ? 'No matches.' : 'No actions yet.'}
                </p>
              )}
              {filteredActions.map((action) => {
                const playerName =
                  playerNames[action.playerId.toString()] ??
                  `Player ${action.playerId}`;
                const verb = formatActionType(action.actionType, action.payload, playerNames, action.playerId.toString(), myPlayerId.toString());
                const time = formatTimestamp(action.timestamp.microsSinceUnixEpoch);
                const turn = Number(action.turnNumber);

                return (
                  <div
                    key={action.id.toString()}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 1,
                      padding: '4px 6px',
                      background: 'rgba(255, 255, 255, 0.03)',
                      borderRadius: 4,
                      borderLeft: '2px solid rgba(107, 78, 39, 0.3)',
                    }}
                  >
                    <span style={{ fontSize: 'calc(11px * var(--chat-fs, 1))', color: '#c8b882', lineHeight: 1.35 }}>
                      <strong style={{ color: '#e8d5a3' }}>{playerName}</strong>{' '}
                      {verb}
                    </span>
                    <span
                      style={{
                        fontSize: 'calc(9px * var(--chat-fs, 1))',
                        color: 'rgba(232, 213, 163, 0.3)',
                        fontVariantNumeric: 'tabular-nums',
                      }}
                    >
                      T{turn} · {action.phase} · {time}
                    </span>
                  </div>
                );
              })}
              <div ref={logEndRef} />
            </div>
          )}

          {/* ---- Tab: All (Combined) ---- */}
          {activeTab === 'all' && (
            <>
              {/* Combined timeline */}
              <div
                style={{
                  flex: 1,
                  overflowY: 'auto',
                  padding: '8px 8px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                }}
              >
                {filteredChat.length === 0 && filteredActions.length === 0 && (
                  <p
                    style={{
                      color: 'rgba(232, 213, 163, 0.3)',
                      fontSize: 'calc(11px * var(--chat-fs, 1))',
                      textAlign: 'center',
                      marginTop: 16,
                      fontStyle: 'italic',
                    }}
                  >
                    {isSearching ? 'No matches.' : 'No activity yet.'}
                  </p>
                )}
                {(() => {
                  // Build a merged timeline sorted chronologically
                  const timeline: TimelineEntry[] = [];
                  for (const msg of filteredChat) {
                    timeline.push({ kind: 'chat', msg, micros: msg.sentAt.microsSinceUnixEpoch });
                  }
                  for (const action of filteredActions) {
                    timeline.push({ kind: 'action', action, micros: action.timestamp.microsSinceUnixEpoch });
                  }
                  timeline.sort((a, b) => (a.micros < b.micros ? -1 : a.micros > b.micros ? 1 : 0));

                  return timeline.map((entry) => {
                    if (entry.kind === 'chat') {
                      const msg = entry.msg;
                      const isMe = msg.senderId === myPlayerId;
                      const senderName =
                        playerNames[msg.senderId.toString()] ??
                        (isMe ? 'You' : `Player ${msg.senderId}`);
                      const time = formatTimestamp(msg.sentAt.microsSinceUnixEpoch);

                      return (
                        <div
                          key={`chat-${msg.id.toString()}`}
                          style={{
                            display: 'flex',
                            gap: 6,
                            alignItems: 'flex-start',
                          }}
                        >
                          {/* Chat icon */}
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width="11"
                            height="11"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke={isMe ? '#c4955a' : '#4a7ab5'}
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            aria-hidden="true"
                            style={{ flexShrink: 0, marginTop: 2 }}
                          >
                            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                          </svg>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: 'flex', gap: 4, alignItems: 'baseline' }}>
                              <span
                                style={{
                                  fontWeight: 700,
                                  fontSize: 'calc(10px * var(--chat-fs, 1))',
                                  color: isMe ? '#c4955a' : '#4a7ab5',
                                  letterSpacing: '0.02em',
                                }}
                              >
                                {senderName}
                              </span>
                              <span
                                style={{
                                  fontSize: 'calc(9px * var(--chat-fs, 1))',
                                  color: 'rgba(232, 213, 163, 0.3)',
                                  fontVariantNumeric: 'tabular-nums',
                                }}
                              >
                                {time}
                              </span>
                            </div>
                            <div
                              style={{
                                marginTop: 2,
                                padding: '3px 7px',
                                borderRadius: '8px 8px 8px 3px',
                                background: isMe
                                  ? 'rgba(196, 149, 90, 0.10)'
                                  : 'rgba(255, 255, 255, 0.05)',
                                border: isMe
                                  ? '1px solid rgba(196, 149, 90, 0.22)'
                                  : '1px solid rgba(255, 255, 255, 0.07)',
                                fontSize: 'calc(12px * var(--chat-fs, 1))',
                                color: '#e8d5a3',
                                lineHeight: 1.4,
                                wordBreak: 'break-word',
                                maxWidth: '95%',
                              }}
                            >
                              {msg.text}
                            </div>
                          </div>
                        </div>
                      );
                    } else {
                      const action = entry.action;
                      const playerName =
                        playerNames[action.playerId.toString()] ??
                        `Player ${action.playerId}`;
                      const verb = formatActionType(action.actionType, action.payload, playerNames, action.playerId.toString(), myPlayerId.toString());
                      const time = formatTimestamp(action.timestamp.microsSinceUnixEpoch);
                      const turn = Number(action.turnNumber);

                      return (
                        <div
                          key={`action-${action.id.toString()}`}
                          style={{
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 1,
                            padding: '3px 6px',
                            borderLeft: '2px solid rgba(107, 78, 39, 0.25)',
                            opacity: 0.8,
                          }}
                        >
                          <span style={{ fontSize: 'calc(10px * var(--chat-fs, 1))', color: '#c8b882', lineHeight: 1.35 }}>
                            <strong style={{ color: '#e8d5a3' }}>{playerName}</strong>{' '}
                            {verb}
                          </span>
                          <span
                            style={{
                              fontSize: 'calc(9px * var(--chat-fs, 1))',
                              color: 'rgba(232, 213, 163, 0.25)',
                              fontVariantNumeric: 'tabular-nums',
                            }}
                          >
                            T{turn} · {action.phase} · {time}
                          </span>
                        </div>
                      );
                    }
                  });
                })()}
                <div ref={allEndRef} />
              </div>

              {/* Input row (same as chat tab) */}
              <div
                style={{
                  padding: '6px 8px',
                  borderTop: '1px solid rgba(107, 78, 39, 0.3)',
                  display: 'flex',
                  gap: 4,
                  flexShrink: 0,
                }}
              >
                <input
                  type="text"
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Message..."
                  maxLength={500}
                  style={{
                    flex: 1,
                    minWidth: 0,
                    background: 'rgba(255, 255, 255, 0.06)',
                    border: '1px solid rgba(107, 78, 39, 0.35)',
                    borderRadius: 4,
                    padding: '5px 8px',
                    color: '#e8d5a3',
                    fontSize: 'calc(12px * var(--chat-fs, 1))',
                    fontFamily: 'inherit',
                    outline: 'none',
                  }}
                  aria-label="Chat message"
                />
                <button
                  onClick={handleSend}
                  disabled={!inputText.trim()}
                  aria-label="Send message"
                  style={{
                    padding: '5px 8px',
                    background:
                      inputText.trim()
                        ? 'rgba(196, 149, 90, 0.18)'
                        : 'rgba(255, 255, 255, 0.04)',
                    border: `1px solid ${inputText.trim() ? 'rgba(196, 149, 90, 0.5)' : 'rgba(107, 78, 39, 0.2)'}`,
                    borderRadius: 4,
                    color: inputText.trim() ? '#e8d5a3' : 'rgba(232, 213, 163, 0.3)',
                    cursor: inputText.trim() ? 'pointer' : 'default',
                    fontSize: 'calc(10px * var(--chat-fs, 1))',
                    letterSpacing: '0.06em',
                    textTransform: 'uppercase',
                    fontFamily: 'inherit',
                    transition: 'background 0.15s, color 0.15s, border-color 0.15s',
                    flexShrink: 0,
                  }}
                >
                  Send
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
