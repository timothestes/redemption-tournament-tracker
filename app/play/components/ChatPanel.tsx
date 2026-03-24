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
  const [isOpen, setIsOpen] = useState(true);
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
                    {tab === 'chat' ? 'Chat' : 'Log'}
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
