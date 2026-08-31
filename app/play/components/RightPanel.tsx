'use client';

import { useState } from 'react';
import { useCardPreview } from '@/app/goldfish/state/CardPreviewContext';
import { useInputMode } from '@/app/shared/hooks/useInputMode';
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
  /** When true, chat input is disabled (read-only chat). Used by spectators. */
  chatDisabled?: boolean;
  // ---- Spectator-controls subsection (player-mode only) ----
  spectators?: Array<{ id: bigint; identity: { toHexString: () => string }; displayName: string }>;
  myIdentityHex?: string;
  shareHandWithSpectators?: boolean;
  isGamePublic?: boolean;
  onSetShareHand?: (share: boolean) => void;
  onKickSpectator?: (spectatorId: bigint) => void;
  onSetGamePrivate?: (isPublic: boolean) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const PANEL_EXPANDED_WIDTH = 'clamp(280px, 20vw, 380px)';
const PANEL_COLLAPSED_WIDTH = 36;
// Touch: the collapsed rail IS the expand button, and 36px is under the 44px
// minimum touch target. The panel clips overflow (needed for the width
// transition), so a hit-area overhang would be unclickable — widen the whole
// rail instead. Pointer keeps the original 36px.
const PANEL_COLLAPSED_WIDTH_TOUCH = 45; // 44 of button + the 1px left border

export default function RightPanel({
  chatMessages,
  gameActions,
  myPlayerId,
  onSendChat,
  playerNames,
  chatScale,
  unreadChatCount = 0,
  chatDisabled = false,
  spectators,
  myIdentityHex,
  shareHandWithSpectators,
  isGamePublic,
  onSetShareHand,
  onKickSpectator,
  onSetGamePrivate,
}: RightPanelProps) {
  const { isLoupeVisible, toggleLoupe, previewCard, isPreviewFlipped } = useCardPreview();
  const [chatTab, setChatTab] = useState<'chat' | 'log' | 'all' | 'spectators'>('all');
  const isTouch = useInputMode() === 'touch';
  const collapsedWidth = isTouch ? PANEL_COLLAPSED_WIDTH_TOUCH : PANEL_COLLAPSED_WIDTH;
  // Collapsed on touch, only the top 48px of the 44px-wide rail did anything —
  // the rest was an empty scrim running the height of the screen, reading as
  // dead space beside the sidebar. The whole strip is the control instead,
  // labelled so it says what it opens.
  const isRail = isTouch && !isLoupeVisible;

  return (
    <div
      data-right-panel
      data-panel-open={isLoupeVisible ? 'true' : undefined}
      style={{
      width: isLoupeVisible ? PANEL_EXPANDED_WIDTH : collapsedWidth,
      minWidth: isLoupeVisible ? undefined : collapsedWidth,
      flexShrink: 0,
      display: 'flex',
      flexDirection: 'column',
      // Collapsed rail gets a scrim too — transparent, it showed a bright
      // strip of raw background art down the whole right screen edge while
      // every neighboring surface is darkened.
      background: isLoupeVisible ? 'rgba(10, 8, 5, 0.97)' : 'rgba(10, 8, 5, 0.55)',
      borderLeft: '1px solid rgba(107, 78, 39, 0.3)',
      overflow: 'hidden',
      transition: 'width 0.2s ease',
    }}>
      <button
        onClick={toggleLoupe}
        title={isLoupeVisible ? 'Hide panel (Tab)' : 'Show panel (Tab)'}
        aria-label={isLoupeVisible ? 'Hide chat and game log' : 'Show chat and game log'}
        style={{
          width: '100%',
          height: isRail ? 'auto' : 48,
          minHeight: 48,
          flex: isRail ? 1 : undefined,
          background: isRail ? 'transparent' : 'rgba(10, 8, 5, 0.96)',
          borderTop: 'none',
          borderLeft: 'none',
          borderRight: 'none',
          borderBottom: isRail ? 'none' : '1px solid rgba(107, 78, 39, 0.5)',
          cursor: 'pointer',
          display: 'flex',
          flexDirection: isRail ? 'column' : 'row',
          alignItems: 'center',
          justifyContent: isLoupeVisible ? 'flex-start' : 'center',
          gap: isRail ? 14 : 6,
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
              {isTouch ? 'Chat & Log' : 'Preview'}
            </span>
          </>
        ) : (
          <>
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
            {isRail && (
              <span
                style={{
                  writingMode: 'vertical-rl',
                  fontFamily: 'var(--font-cinzel), Georgia, serif',
                  fontSize: 10,
                  letterSpacing: '0.2em',
                  textTransform: 'uppercase',
                  whiteSpace: 'nowrap',
                  opacity: 0.8,
                }}
              >
                Chat &amp; Log
              </span>
            )}
          </>
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
          <div data-panel-preview style={{
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
                  // Unresolved forge refs ("forge:<uuid>") resolve to '' — show the
                  // card back instead of an empty src (React warns + refetches page).
                  src={getCardImageUrl(previewCard.cardImgFile) || '/gameplay/cardback.webp'}
                  alt={previewCard.cardName}
                  style={{
                    display: 'block',
                    width: '100%',
                    height: '100%',
                    objectFit: 'fill',
                    transform: previewCard.isMeek && !isPreviewFlipped ? 'rotate(180deg)' : undefined,
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
              chatDisabled={chatDisabled}
              spectators={spectators}
              myIdentityHex={myIdentityHex}
              shareHandWithSpectators={shareHandWithSpectators}
              isGamePublic={isGamePublic}
              onSetShareHand={onSetShareHand}
              onKickSpectator={onKickSpectator}
              onSetGamePrivate={onSetGamePrivate}
            />
          </div>
        </>
      )}
    </div>
  );
}
