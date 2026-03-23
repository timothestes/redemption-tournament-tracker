'use client';

import { useEffect, useRef, useState, type KeyboardEvent } from 'react';

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
  SHUFFLE_DECK: 'shuffled their deck',
  SHUFFLE_CARD_INTO_DECK: 'shuffled a card into their deck',
  MEEK_CARD: 'meekened a card',
  UNMEEK_CARD: 'unmeekened a card',
  FLIP_CARD: 'flipped a card',
  ADD_COUNTER: 'added a counter',
  REMOVE_COUNTER: 'removed a counter',
  SET_NOTE: 'set a note on a card',
  EXCHANGE_CARDS: 'exchanged cards',
  SET_PHASE: 'changed phase',
  END_TURN: 'ended their turn',
  ROLL_DICE: 'rolled dice',
  SEND_CHAT: 'sent a message',
  SET_PLAYER_OPTION: 'changed a setting',
  RESIGN_GAME: 'resigned the game',
  LEAVE_GAME: 'left the game',
  UPDATE_CARD_POSITION: 'repositioned a card',
};

function formatActionType(actionType: string): string {
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
}: ChatPanelProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'chat' | 'log'>('chat');
  const [inputText, setInputText] = useState('');
  const [unreadCount, setUnreadCount] = useState(0);

  const chatEndRef = useRef<HTMLDivElement>(null);
  const logEndRef = useRef<HTMLDivElement>(null);
  const prevChatLengthRef = useRef(chatMessages.length);

  // Track unread messages when panel is closed
  useEffect(() => {
    if (!isOpen && chatMessages.length > prevChatLengthRef.current) {
      setUnreadCount((n) => n + (chatMessages.length - prevChatLengthRef.current));
    }
    prevChatLengthRef.current = chatMessages.length;
  }, [chatMessages.length, isOpen]);

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

  // Auto-scroll log to bottom when new actions arrive
  useEffect(() => {
    if (isOpen && activeTab === 'log') {
      logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
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
    <>
      {/* ================================================================
          Toggle button — always visible at right edge of screen
          ================================================================ */}
      <button
        onClick={togglePanel}
        aria-label={isOpen ? 'Close chat panel' : 'Open chat panel'}
        style={{
          position: 'fixed',
          right: isOpen ? 322 : 0,
          top: '50%',
          transform: 'translateY(-50%)',
          zIndex: 400,
          background: 'rgba(15, 12, 8, 0.95)',
          border: '1px solid rgba(107, 78, 39, 0.5)',
          borderRight: isOpen ? '1px solid rgba(107, 78, 39, 0.5)' : 'none',
          borderRadius: isOpen ? '6px 0 0 6px' : '6px 0 0 6px',
          color: '#e8d5a3',
          cursor: 'pointer',
          padding: '10px 8px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 4,
          transition: 'right 0.25s ease',
          writingMode: 'vertical-rl',
          fontSize: 11,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          fontFamily: 'var(--font-geist-sans, system-ui, sans-serif)',
        }}
      >
        {/* Chat bubble icon */}
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          style={{ flexShrink: 0, rotate: '90deg' }}
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
              writingMode: 'horizontal-tb',
              letterSpacing: 0,
            }}
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {/* ================================================================
          Slide-out panel
          ================================================================ */}
      <div
        role="complementary"
        aria-label="Chat and game log panel"
        style={{
          position: 'fixed',
          top: 0,
          right: isOpen ? 0 : -320,
          width: 320,
          height: '100dvh',
          zIndex: 399,
          display: 'flex',
          flexDirection: 'column',
          background: 'rgba(10, 8, 5, 0.97)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          borderLeft: '1px solid rgba(107, 78, 39, 0.4)',
          transition: 'right 0.25s ease',
          fontFamily: 'var(--font-geist-sans, system-ui, sans-serif)',
        }}
      >
        {/* ---- Header ---- */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '10px 12px',
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
                    padding: '4px 12px',
                    background: isActive ? 'rgba(196, 149, 90, 0.12)' : 'transparent',
                    border: `1px solid ${isActive ? 'rgba(196, 149, 90, 0.45)' : 'transparent'}`,
                    borderRadius: 20,
                    cursor: 'pointer',
                    fontSize: 11,
                    letterSpacing: '0.07em',
                    textTransform: 'uppercase',
                    color: isActive ? '#e8d5a3' : 'rgba(232, 213, 163, 0.4)',
                    fontFamily: 'inherit',
                    transition: 'color 0.15s, background 0.15s, border-color 0.15s',
                  }}
                >
                  {tab === 'chat' ? 'Chat' : 'Game Log'}
                </button>
              );
            })}
          </div>

          {/* Close button */}
          <button
            onClick={() => setIsOpen(false)}
            aria-label="Close panel"
            style={{
              background: 'transparent',
              border: 'none',
              color: 'rgba(232, 213, 163, 0.5)',
              cursor: 'pointer',
              padding: 4,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 4,
              transition: 'color 0.15s',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = '#e8d5a3';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = 'rgba(232, 213, 163, 0.5)';
            }}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* ---- Tab: Chat ---- */}
        {activeTab === 'chat' && (
          <>
            {/* Message list */}
            <div
              style={{
                flex: 1,
                overflowY: 'auto',
                padding: '10px 12px',
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
              }}
            >
              {chatMessages.length === 0 && (
                <p
                  style={{
                    color: 'rgba(232, 213, 163, 0.3)',
                    fontSize: 12,
                    textAlign: 'center',
                    marginTop: 24,
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
                        gap: 6,
                        alignItems: 'baseline',
                        marginBottom: 3,
                        flexDirection: isMe ? 'row-reverse' : 'row',
                      }}
                    >
                      <span
                        style={{
                          fontWeight: 700,
                          fontSize: 11,
                          color: isMe ? '#c4955a' : '#4a7ab5',
                          letterSpacing: '0.02em',
                        }}
                      >
                        {senderName}
                      </span>
                      <span
                        style={{
                          fontSize: 10,
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
                        maxWidth: '85%',
                        padding: '6px 10px',
                        borderRadius: isMe ? '12px 12px 4px 12px' : '12px 12px 12px 4px',
                        background: isMe
                          ? 'rgba(196, 149, 90, 0.14)'
                          : 'rgba(255, 255, 255, 0.06)',
                        border: isMe
                          ? '1px solid rgba(196, 149, 90, 0.3)'
                          : '1px solid rgba(255, 255, 255, 0.08)',
                        fontSize: 13,
                        color: '#e8d5a3',
                        lineHeight: 1.45,
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
                padding: '10px 12px',
                borderTop: '1px solid rgba(107, 78, 39, 0.3)',
                display: 'flex',
                gap: 8,
                flexShrink: 0,
              }}
            >
              <input
                type="text"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Send a message…"
                maxLength={500}
                style={{
                  flex: 1,
                  background: 'rgba(255, 255, 255, 0.06)',
                  border: '1px solid rgba(107, 78, 39, 0.35)',
                  borderRadius: 6,
                  padding: '7px 10px',
                  color: '#e8d5a3',
                  fontSize: 13,
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
                  padding: '7px 12px',
                  background:
                    inputText.trim()
                      ? 'rgba(196, 149, 90, 0.18)'
                      : 'rgba(255, 255, 255, 0.04)',
                  border: `1px solid ${inputText.trim() ? 'rgba(196, 149, 90, 0.5)' : 'rgba(107, 78, 39, 0.2)'}`,
                  borderRadius: 6,
                  color: inputText.trim() ? '#e8d5a3' : 'rgba(232, 213, 163, 0.3)',
                  cursor: inputText.trim() ? 'pointer' : 'default',
                  fontSize: 11,
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
              padding: '10px 12px',
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
            }}
          >
            {gameActions.length === 0 && (
              <p
                style={{
                  color: 'rgba(232, 213, 163, 0.3)',
                  fontSize: 12,
                  textAlign: 'center',
                  marginTop: 24,
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
              const verb = formatActionType(action.actionType);
              const time = formatTimestamp(action.timestamp.microsSinceUnixEpoch);
              const turn = Number(action.turnNumber);

              return (
                <div
                  key={action.id.toString()}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 1,
                    padding: '5px 8px',
                    background: 'rgba(255, 255, 255, 0.03)',
                    borderRadius: 5,
                    borderLeft: '2px solid rgba(107, 78, 39, 0.3)',
                  }}
                >
                  <span style={{ fontSize: 12, color: '#c8b882', lineHeight: 1.4 }}>
                    <strong style={{ color: '#e8d5a3' }}>{playerName}</strong>{' '}
                    {verb}
                  </span>
                  <span
                    style={{
                      fontSize: 10,
                      color: 'rgba(232, 213, 163, 0.3)',
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    Turn {turn} · {action.phase} · {time}
                  </span>
                </div>
              );
            })}
            <div ref={logEndRef} />
          </div>
        )}
      </div>
    </>
  );
}
