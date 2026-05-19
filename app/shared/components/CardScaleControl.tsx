'use client';

import { useState, useRef, useEffect } from 'react';
import { Settings, RotateCcw, RefreshCw, Clock, EyeOff } from 'lucide-react';

interface CardScaleControlProps {
  cardScale: number;
  setCardScale: (scale: number) => void;
  resetScale: () => void;
  minScale: number;
  maxScale: number;
  step: number;
  /** Chat/log font scale — if provided, a second slider renders. */
  chatScale?: number;
  setChatScale?: (scale: number) => void;
  resetChatScale?: () => void;
  minChatScale?: number;
  maxChatScale?: number;
  chatStep?: number;
  /** Called to trigger mid-game deck reload (multiplayer only). */
  onLoadDeck?: () => void;
  /** Whether the game timer is currently visible. */
  isTimerVisible?: boolean;
  /** Toggle timer visibility. */
  onToggleTimer?: () => void;
  /** Spectators in the current game. When provided (even empty), the subsection renders. */
  spectators?: Array<{ id: bigint; identity: { toHexString: () => string }; displayName: string }>;
  /** Local player's identity hex — used to filter own row from spectator list. */
  myIdentityHex?: string;
  /** Local player's shareHandWithSpectators value. */
  shareHandWithSpectators?: boolean;
  /** Game id, needed to gate the spectators subsection. */
  gameId?: bigint;
  /** Whether the game is currently public. */
  isGamePublic?: boolean;
  /** Reducer callbacks (provided by parent so this component stays presentational). */
  onSetShareHand?: (share: boolean) => void;
  onKickSpectator?: (spectatorId: bigint) => void;
  onSetGamePrivate?: (isPublic: boolean) => void;
}

export function CardScaleControl({
  cardScale,
  setCardScale,
  resetScale,
  minScale,
  maxScale,
  step,
  chatScale,
  setChatScale,
  resetChatScale,
  minChatScale,
  maxChatScale,
  chatStep,
  onLoadDeck,
  isTimerVisible,
  onToggleTimer,
  spectators,
  myIdentityHex,
  shareHandWithSpectators,
  gameId,
  isGamePublic,
  onSetShareHand,
  onKickSpectator,
  onSetGamePrivate,
}: CardScaleControlProps) {
  const [open, setOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Close popover on outside click
  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  const pct = Math.round(cardScale * 100);
  const chatPct = chatScale !== undefined ? Math.round(chatScale * 100) : null;
  const hasChatControl =
    chatScale !== undefined &&
    setChatScale !== undefined &&
    resetChatScale !== undefined &&
    minChatScale !== undefined &&
    maxChatScale !== undefined &&
    chatStep !== undefined;

  return (
    <div
      ref={popoverRef}
      onContextMenu={(e) => e.preventDefault()}
      style={{ position: 'absolute', bottom: 8, left: 12, zIndex: 200 }}
    >
      {/* Gear button */}
      <button
        onClick={() => setOpen(prev => !prev)}
        title="Card size settings (+/- keys)"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 36,
          height: 36,
          background: 'rgba(30,22,16,0.92)',
          border: '1px solid var(--gf-border, #3d2e1f)',
          borderRadius: 8,
          cursor: 'pointer',
          color: 'var(--gf-text, #e8d5a3)',
          transition: 'background 0.15s, color 0.15s',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = 'var(--gf-hover, #2a1f12)';
          e.currentTarget.style.color = 'var(--gf-text-bright, #fff)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'rgba(30,22,16,0.92)';
          e.currentTarget.style.color = 'var(--gf-text, #e8d5a3)';
        }}
      >
        <Settings size={18} />
      </button>

      {/* Popover */}
      {open && (
        <div
          style={{
            position: 'absolute',
            bottom: 44,
            left: 0,
            background: 'rgba(30,22,16,0.96)',
            border: '1px solid var(--gf-border, #3d2e1f)',
            borderRadius: 8,
            padding: '12px 16px',
            minWidth: 200,
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          {/* Label + percentage */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span
              style={{
                fontFamily: 'var(--font-cinzel), Georgia, serif',
                fontSize: 11,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                color: 'var(--gf-text, #e8d5a3)',
              }}
            >
              Card Size
            </span>
            <span
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: 'var(--gf-text-bright, #fff)',
                fontVariantNumeric: 'tabular-nums',
                minWidth: 36,
                textAlign: 'right',
              }}
            >
              {pct}%
            </span>
          </div>

          {/* Slider */}
          <input
            type="range"
            min={minScale * 100}
            max={maxScale * 100}
            step={step * 100}
            value={pct}
            onChange={(e) => {
              const newScale = Math.round(parseFloat(e.target.value)) / 100;
              setCardScale(newScale);
            }}
            style={{
              width: '100%',
              accentColor: '#c4955a',
              cursor: 'pointer',
            }}
          />

          {/* Min/max labels + reset */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 10, color: 'var(--gf-text-dim, #8a7a66)' }}>
              {Math.round(minScale * 100)}%
            </span>
            <button
              onClick={resetScale}
              title="Reset to 100%"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                padding: '2px 8px',
                background: 'transparent',
                border: '1px solid var(--gf-border, #3d2e1f)',
                borderRadius: 4,
                cursor: 'pointer',
                color: 'var(--gf-text, #e8d5a3)',
                fontSize: 10,
                fontFamily: 'var(--font-cinzel), Georgia, serif',
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
                transition: 'background 0.15s',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'var(--gf-hover, #2a1f12)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent';
              }}
            >
              <RotateCcw size={10} />
              Reset
            </button>
            <span style={{ fontSize: 10, color: 'var(--gf-text-dim, #8a7a66)' }}>
              {Math.round(maxScale * 100)}%
            </span>
          </div>

          {/* Chat/log font size — multiplayer only */}
          {hasChatControl && (
            <>
              <div style={{
                height: 1,
                background: 'var(--gf-border, #3d2e1f)',
                margin: '4px 0',
              }} />
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span
                  style={{
                    fontFamily: 'var(--font-cinzel), Georgia, serif',
                    fontSize: 11,
                    letterSpacing: '0.06em',
                    textTransform: 'uppercase',
                    color: 'var(--gf-text, #e8d5a3)',
                  }}
                >
                  Chat/Log Size
                </span>
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    color: 'var(--gf-text-bright, #fff)',
                    fontVariantNumeric: 'tabular-nums',
                    minWidth: 36,
                    textAlign: 'right',
                  }}
                >
                  {chatPct}%
                </span>
              </div>
              <input
                type="range"
                min={minChatScale! * 100}
                max={maxChatScale! * 100}
                step={chatStep! * 100}
                value={chatPct!}
                onChange={(e) => {
                  const newScale = Math.round(parseFloat(e.target.value)) / 100;
                  setChatScale!(newScale);
                }}
                style={{
                  width: '100%',
                  accentColor: '#c4955a',
                  cursor: 'pointer',
                }}
              />
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 10, color: 'var(--gf-text-dim, #8a7a66)' }}>
                  {Math.round(minChatScale! * 100)}%
                </span>
                <button
                  onClick={resetChatScale}
                  title="Reset to 100%"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    padding: '2px 8px',
                    background: 'transparent',
                    border: '1px solid var(--gf-border, #3d2e1f)',
                    borderRadius: 4,
                    cursor: 'pointer',
                    color: 'var(--gf-text, #e8d5a3)',
                    fontSize: 10,
                    fontFamily: 'var(--font-cinzel), Georgia, serif',
                    letterSpacing: '0.04em',
                    textTransform: 'uppercase',
                    transition: 'background 0.15s',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'var(--gf-hover, #2a1f12)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'transparent';
                  }}
                >
                  <RotateCcw size={10} />
                  Reset
                </button>
                <span style={{ fontSize: 10, color: 'var(--gf-text-dim, #8a7a66)' }}>
                  {Math.round(maxChatScale! * 100)}%
                </span>
              </div>
            </>
          )}

          {/* Load Deck — multiplayer only */}
          {onLoadDeck && (
            <>
              <div style={{
                height: 1,
                background: 'var(--gf-border, #3d2e1f)',
                margin: '4px 0',
              }} />
              <button
                onClick={() => {
                  onLoadDeck();
                  setOpen(false);
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  width: '100%',
                  padding: '6px 4px',
                  background: 'transparent',
                  border: 'none',
                  borderRadius: 4,
                  cursor: 'pointer',
                  color: 'var(--gf-text, #e8d5a3)',
                  fontFamily: 'var(--font-cinzel), Georgia, serif',
                  fontSize: 11,
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                  transition: 'background 0.15s',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'var(--gf-hover, #2a1f12)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent';
                }}
              >
                <RefreshCw size={14} />
                Load Deck
              </button>
            </>
          )}

          {/* Timer visibility toggle */}
          {onToggleTimer && (
            <>
              <div style={{
                height: 1,
                background: 'var(--gf-border, #3d2e1f)',
                margin: '4px 0',
              }} />
              <button
                onClick={() => {
                  onToggleTimer();
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  width: '100%',
                  padding: '6px 4px',
                  background: 'transparent',
                  border: 'none',
                  borderRadius: 4,
                  cursor: 'pointer',
                  color: 'var(--gf-text, #e8d5a3)',
                  fontFamily: 'var(--font-cinzel), Georgia, serif',
                  fontSize: 11,
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                  transition: 'background 0.15s',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'var(--gf-hover, #2a1f12)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent';
                }}
              >
                {isTimerVisible ? <EyeOff size={14} /> : <Clock size={14} />}
                {isTimerVisible ? 'Hide Timer' : 'Show Timer'}
              </button>
            </>
          )}

          {/* Spectators subsection — only shown in player mode when gameId is provided */}
          {gameId !== undefined && (
            <div style={{ marginTop: 4, paddingTop: 12, borderTop: '1px solid var(--gf-border, #3d2e1f)' }}>
              <div style={{
                fontSize: 11,
                opacity: 0.7,
                marginBottom: 8,
                textTransform: 'uppercase',
                letterSpacing: '0.1em',
                fontFamily: 'var(--font-cinzel), Georgia, serif',
                color: 'var(--gf-text, #e8d5a3)',
              }}>
                Spectators
              </div>

              {(spectators ?? []).length > 0 && (
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, cursor: 'pointer', color: 'var(--gf-text, #e8d5a3)', fontSize: 12 }}>
                  <input
                    type="checkbox"
                    checked={!!shareHandWithSpectators}
                    onChange={(e) => onSetShareHand?.(e.target.checked)}
                  />
                  <span>Share my hand with spectators</span>
                </label>
              )}

              {(spectators ?? []).length > 0 && (
                <div style={{ marginBottom: 8 }}>
                  <div style={{ fontSize: 11, opacity: 0.6, marginBottom: 4, color: 'var(--gf-text, #e8d5a3)' }}>
                    Watching ({spectators!.filter(s => s.identity.toHexString() !== myIdentityHex).length})
                  </div>
                  {spectators!
                    .filter(s => s.identity.toHexString() !== myIdentityHex)
                    .map(s => (
                      <div key={s.id.toString()} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0' }}>
                        <span style={{ fontSize: 12, color: 'var(--gf-text, #e8d5a3)' }}>{s.displayName}</span>
                        <button
                          onClick={() => onKickSpectator?.(s.id)}
                          style={{
                            background: 'transparent',
                            color: '#c4955a',
                            border: '1px solid rgba(196, 149, 90, 0.4)',
                            borderRadius: 4,
                            padding: '2px 8px',
                            cursor: 'pointer',
                            fontSize: 11,
                          }}
                        >
                          Kick
                        </button>
                      </div>
                    ))}
                </div>
              )}

              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', color: 'var(--gf-text, #e8d5a3)', fontSize: 12 }}>
                <input
                  type="checkbox"
                  checked={isGamePublic === false}
                  onChange={(e) => onSetGamePrivate?.(!e.target.checked)}
                />
                <span>Private game (no new spectators)</span>
              </label>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
