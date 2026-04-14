'use client';

import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
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

interface ChatPanelProps {
  chatMessages: ChatMessage[];
  gameActions: GameAction[];
  myPlayerId: bigint;
  onSendChat: (text: string) => void;
  playerNames: Record<string, string>; // playerId.toString() → display name
  activeTab?: 'chat' | 'log';
  onActiveTabChange?: (tab: 'chat' | 'log') => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTimestamp(micros: bigint): string {
  const ms = Number(micros / BigInt(1000));
  const date = new Date(ms);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

const ACTION_TYPE_LABELS: Record<string, string> = {
  DRAW: 'drew a card',
  DRAW_MULTIPLE: 'drew multiple cards',
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
  EXCHANGE_CARDS: 'exchanged cards',
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
  if (name === 'a face-down card') return <span>{name}</span>;
  return (
    <span
      style={{ textDecoration: 'underline', textDecorationStyle: 'dotted', textUnderlineOffset: 2, cursor: 'pointer' }}
      onMouseEnter={() => setPreviewCard({ cardName: name, cardImgFile: img ?? '' })}
      onMouseLeave={() => setPreviewCard(null)}
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

function formatActionType(actionType: string, payload?: string, playerNames?: Record<string, string>, actorPlayerId?: string): ReactNode {
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
      return `rolled ${data.result0} vs ${data.result1}`;
    } catch { /* fall through */ }
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
  if (actionType === 'SET_PHASE' && payload) {
    try {
      const data = JSON.parse(payload);
      if (data.phase) return `moved to ${data.phase}`;
    } catch { /* fall through */ }
  }
  if (actionType === 'SPAWN_LOST_SOUL') {
    return 'spawned a lost soul token';
  }
  if (actionType === 'MOVE_CARD' && payload) {
    try {
      const data = JSON.parse(payload);
      if (data.redirected && data.cardName) {
        return <>{data.redirected} <HoverableCard name={data.cardName} img={data.cardImgFile} /> but went to land of bondage instead</>;
      }
      if (data.cardName) {
        if (data.to === 'discard') return <>discarded <HoverableCard name={data.cardName} img={data.cardImgFile} /></>;
        if (data.to === 'reserve') return <>placed <HoverableCard name={data.cardName} img={data.cardImgFile} /> in reserve</>;
        if (data.to === 'banish') return <>banished <HoverableCard name={data.cardName} img={data.cardImgFile} /></>;
        if (data.to === 'deck') return <>put <HoverableCard name={data.cardName} img={data.cardImgFile} /> into deck</>;
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
      if (data.to === 'deck') return <>put {cardEl} into {ownerName}&apos;s deck from {data.from}</>;
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
      if (data.cardName) {
        const isCrossPlayer = data.targetOwnerId && data.targetOwnerId !== actorPlayerId;
        const targetName = isCrossPlayer && playerNames?.[data.targetOwnerId];
        return targetName
          ? <>moved <HoverableCard name={data.cardName} img={data.cardImgFile} /> to top of {targetName}&apos;s deck</>
          : <>moved <HoverableCard name={data.cardName} img={data.cardImgFile} /> to top of deck</>;
      }
    } catch { /* fall through */ }
  }
  if (actionType === 'MOVE_TO_BOTTOM_OF_DECK' && payload) {
    try {
      const data = JSON.parse(payload);
      if (data.cardName) {
        const isCrossPlayer = data.targetOwnerId && data.targetOwnerId !== actorPlayerId;
        const targetName = isCrossPlayer && playerNames?.[data.targetOwnerId];
        return targetName
          ? <>moved <HoverableCard name={data.cardName} img={data.cardImgFile} /> to bottom of {targetName}&apos;s deck</>
          : <>moved <HoverableCard name={data.cardName} img={data.cardImgFile} /> to bottom of deck</>;
      }
    } catch { /* fall through */ }
  }
  if (actionType === 'MOVE_CARDS_BATCH' && payload) {
    try {
      const data = JSON.parse(payload);
      const parts: ReactNode[] = [];
      const fromSuffix = data.fromSource === 'top-of-deck' ? ' from top of deck'
        : data.fromSource === 'bottom-of-deck' ? ' from bottom of deck'
        : data.fromSource === 'random-from-deck' ? ' randomly from deck'
        : '';
      if (data.cards?.length) {
        if (data.toZone === 'discard') parts.push(<span key="discard">discarded <CardNameList cards={data.cards} />{fromSuffix}</span>);
        if (data.toZone === 'reserve') parts.push(<span key="reserve">reserved <CardNameList cards={data.cards} />{fromSuffix}</span>);
        if (data.toZone === 'banish') parts.push(<span key="banish">banished <CardNameList cards={data.cards} />{fromSuffix}</span>);
        if (data.toZone === 'deck') parts.push(<span key="deck">put <CardNameList cards={data.cards} /> into deck</span>);
        if (data.toZone === 'hand') {
          const isCrossPlayer = data.targetOwnerId && playerNames?.[data.targetOwnerId] && data.targetOwnerId !== actorPlayerId;
          const targetName = isCrossPlayer && playerNames?.[data.targetOwnerId];
          parts.push(<span key="hand">{targetName ? <>moved <CardNameList cards={data.cards} /> to {targetName}&apos;s hand{fromSuffix}</> : <>drew <CardNameList cards={data.cards} />{fromSuffix}</>}</span>);
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
      if (data.cardName) {
        return targetName
          ? <>shuffled <HoverableCard name={data.cardName} img={data.cardImgFile} /> into {targetName}&apos;s deck</>
          : <>shuffled <HoverableCard name={data.cardName} img={data.cardImgFile} /> into their deck</>;
      }
      return targetName ? `shuffled a card into ${targetName}'s deck` : 'shuffled a card into their deck';
    } catch { /* fall through */ }
  }
  if (actionType === 'REVEAL_HAND') return 'revealed their hand for 30 seconds';
  if (actionType === 'HIDE_HAND') return 'hid their hand';
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
      return `finished searching ${targetName}'s ${data.zone}`;
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
}: ChatPanelProps) {
  const [isOpen, setIsOpen] = useState(true);
  const [internalTab, setInternalTab] = useState<'chat' | 'log'>('chat');
  const activeTab = controlledTab ?? internalTab;
  const setActiveTab = onActiveTabChange ?? setInternalTab;
  const [inputText, setInputText] = useState('');
  const [unreadCount, setUnreadCount] = useState(0);

  const chatEndRef = useRef<HTMLDivElement>(null);
  const logEndRef = useRef<HTMLDivElement>(null);
  const prevChatLengthRef = useRef(chatMessages.length);

  // Track unread messages when chat isn't actively visible
  useEffect(() => {
    const chatVisible = isOpen && activeTab === 'chat';
    if (!chatVisible && chatMessages.length > prevChatLengthRef.current) {
      setUnreadCount((n) => n + (chatMessages.length - prevChatLengthRef.current));
    }
    prevChatLengthRef.current = chatMessages.length;
  }, [chatMessages.length, isOpen, activeTab]);

  // Clear unread when opening chat tab
  useEffect(() => {
    if (isOpen && activeTab === 'chat') {
      setUnreadCount(0);
    }
  }, [isOpen, activeTab]);

  // Auto-scroll chat to bottom when new messages arrive
  useEffect(() => {
    if (isOpen && activeTab === 'chat') {
      chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [chatMessages, isOpen, activeTab]);

  // Auto-scroll log to bottom when new actions arrive or tab switches
  const prevLogTab = useRef(activeTab);
  useEffect(() => {
    if (isOpen && activeTab === 'log') {
      // Instant scroll when first switching to log tab, smooth for new entries
      const justSwitched = prevLogTab.current !== 'log';
      logEndRef.current?.scrollIntoView({ behavior: justSwitched ? 'instant' : 'smooth' });
    }
    prevLogTab.current = activeTab;
  }, [gameActions, isOpen, activeTab]);

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
    }}>
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
          fontSize: 11,
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
              fontSize: 9,
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
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '6px 8px',
              borderBottom: '1px solid rgba(107, 78, 39, 0.3)',
              flexShrink: 0,
            }}
          >
            {/* Tabs */}
            <div style={{ display: 'flex', gap: 4 }}>
              {(['chat', 'log'] as const).map((tab) => {
                const isActive = activeTab === tab;
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
                      fontSize: 10,
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
                        {unreadCount > 0 && activeTab !== 'chat' && (
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
                    ) : 'Log'}
                  </button>
                );
              })}
            </div>
          </div>

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
                {chatMessages.length === 0 && (
                  <p
                    style={{
                      color: 'rgba(232, 213, 163, 0.3)',
                      fontSize: 11,
                      textAlign: 'center',
                      marginTop: 16,
                      fontStyle: 'italic',
                    }}
                  >
                    No messages yet.
                  </p>
                )}
                {chatMessages.map((msg) => {
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
                            fontSize: 10,
                            color: isMe ? '#c4955a' : '#4a7ab5',
                            letterSpacing: '0.02em',
                          }}
                        >
                          {senderName}
                        </span>
                        <span
                          style={{
                            fontSize: 9,
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
                          fontSize: 12,
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
                    fontSize: 12,
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
                    fontSize: 10,
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
              {gameActions.length === 0 && (
                <p
                  style={{
                    color: 'rgba(232, 213, 163, 0.3)',
                    fontSize: 11,
                    textAlign: 'center',
                    marginTop: 16,
                    fontStyle: 'italic',
                  }}
                >
                  No actions yet.
                </p>
              )}
              {gameActions.map((action) => {
                const playerName =
                  playerNames[action.playerId.toString()] ??
                  `Player ${action.playerId}`;
                const verb = formatActionType(action.actionType, action.payload, playerNames, action.playerId.toString());
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
                    <span style={{ fontSize: 11, color: '#c8b882', lineHeight: 1.35 }}>
                      <strong style={{ color: '#e8d5a3' }}>{playerName}</strong>{' '}
                      {verb}
                    </span>
                    <span
                      style={{
                        fontSize: 9,
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
        </div>
      )}
    </div>
  );
}
