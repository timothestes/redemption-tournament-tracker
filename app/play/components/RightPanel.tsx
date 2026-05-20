'use client';

import { useState } from 'react';
import { useCardPreview } from '@/app/goldfish/state/CardPreviewContext';
import ChatPanel from '@/app/play/components/ChatPanel';
import { getCardImageUrl } from '@/app/shared/utils/cardImageUrl';

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

interface RightPanelProps {
  chatMessages: ChatMessage[];
  gameActions: GameAction[];
  myPlayerId: bigint;
  onSendChat: (text: string) => void;
  playerNames: Record<string, string>;
  chatScale: number;
  unreadChatCount?: number;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const PANEL_EXPANDED_WIDTH = 'clamp(280px, 20vw, 380px)';
const PANEL_COLLAPSED_WIDTH = 36;

export default function RightPanel({
  chatMessages,
  gameActions,
  myPlayerId,
  onSendChat,
  playerNames,
  chatScale,
  unreadChatCount = 0,
}: RightPanelProps) {
  const { isLoupeVisible, toggleLoupe, previewCard } = useCardPreview();
  const [chatTab, setChatTab] = useState<'chat' | 'log' | 'all'>('all');

  return (
    <div style={{
      width: isLoupeVisible ? PANEL_EXPANDED_WIDTH : PANEL_COLLAPSED_WIDTH,
      minWidth: isLoupeVisible ? undefined : PANEL_COLLAPSED_WIDTH,
      flexShrink: 0,
      display: 'flex',
      flexDirection: 'column',
      background: isLoupeVisible ? 'rgba(10, 8, 5, 0.97)' : 'transparent',
      borderLeft: '1px solid rgba(107, 78, 39, 0.3)',
      overflow: 'hidden',
      transition: 'width 0.2s ease',
    }}>
      <button
        onClick={toggleLoupe}
        title={isLoupeVisible ? 'Hide panel (Tab)' : 'Show panel (Tab)'}
        style={{
          width: '100%',
          height: 48,
          minHeight: 48,
          background: 'rgba(10, 8, 5, 0.96)',
          borderTop: 'none',
          borderLeft: 'none',
          borderRight: 'none',
          borderBottom: '1px solid rgba(107, 78, 39, 0.5)',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: isLoupeVisible ? 'flex-start' : 'center',
          gap: 6,
          padding: isLoupeVisible ? '0 12px' : '0',
          color: 'rgba(232, 213, 163, 0.5)',
          flexShrink: 0,
        }}
      >
        {isLoupeVisible ? (
          <>
            <span style={{ fontSize: 14 }}>›</span>
            <span style={{
              fontFamily: 'var(--font-cinzel), Georgia, serif',
              fontSize: 11,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              whiteSpace: 'nowrap',
            }}>
              Preview
            </span>
          </>
        ) : (
          <span style={{ fontSize: 14, position: 'relative' }}>
            ‹
            {unreadChatCount > 0 && (
              <span
                style={{
                  position: 'absolute',
                  top: -2,
                  right: -6,
                  width: 7,
                  height: 7,
                  borderRadius: '50%',
                  background: '#c4955a',
                  boxShadow: '0 0 4px rgba(196, 149, 90, 0.6)',
                  animation: 'unread-pulse 2s ease-in-out infinite',
                }}
              />
            )}
          </span>
        )}
      </button>
      {/* Keyframe for unread dot pulse */}
      {unreadChatCount > 0 && !isLoupeVisible && (
        <style>{`
          @keyframes unread-pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.4; }
          }
        `}</style>
      )}
      {isLoupeVisible && (
        <>
          <div style={{
            flexShrink: 0,
            padding: 12,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 8,
          }}>
            {previewCard ? (
              <div style={{
                position: 'relative',
                width: '100%',
                aspectRatio: '375 / 525',
                borderRadius: 6,
                overflow: 'hidden',
                boxShadow: '0 4px 24px rgba(0,0,0,0.7), 0 0 8px rgba(212,168,103,0.2)',
                background: '#000',
              }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={getCardImageUrl(previewCard.cardImgFile)}
                  alt={previewCard.cardName}
                  style={{
                    display: 'block',
                    width: '100%',
                    height: '100%',
                    objectFit: 'fill',
                    transform: previewCard.isMeek ? 'rotate(180deg)' : undefined,
                  }}
                />
                {previewCard.notes && (
                  <div style={{
                    position: 'absolute',
                    left: 8,
                    right: 8,
                    bottom: 10,
                    background: 'rgba(0, 0, 0, 0.88)',
                    border: '1px solid #c4955a',
                    borderRadius: 999,
                    padding: '5px 10px',
                    color: '#f0d9a8',
                    fontFamily: 'var(--font-cinzel), Georgia, serif',
                    fontSize: 12,
                    fontWeight: 700,
                    textAlign: 'center',
                    boxShadow: '0 4px 16px rgba(0,0,0,0.8)',
                    wordBreak: 'break-word',
                  }}>
                    {previewCard.notes}
                  </div>
                )}
              </div>
            ) : (
              <div style={{
                width: '100%',
                aspectRatio: '1 / 1.4',
                borderRadius: 6,
                border: '1px dashed rgba(107, 78, 39, 0.5)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                opacity: 0.55,
              }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/gameplay/cardback.webp"
                  alt="Hover a card"
                  style={{ width: '100%', height: '100%', objectFit: 'contain', borderRadius: 6, opacity: 0.7 }}
                />
              </div>
            )}
          </div>
          <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', borderTop: '1px solid rgba(107, 78, 39, 0.3)' }}>
            <ChatPanel
              chatMessages={chatMessages}
              gameActions={gameActions}
              myPlayerId={myPlayerId}
              onSendChat={onSendChat}
              playerNames={playerNames}
              activeTab={chatTab}
              onActiveTabChange={setChatTab}
              chatScale={chatScale}
            />
          </div>
        </>
      )}
    </div>
  );
}
