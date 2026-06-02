'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTable, useSpacetimeDB } from 'spacetimedb/react';
import { tables } from '@/lib/spacetimedb/module_bindings';

interface SpectatorHandRequestBannerProps {
  gameId: bigint | null;
  /** Local player's row — needed to call setShareHandWithSpectators and to auto-dismiss when share flips on. */
  myPlayer: { id: bigint; gameId: bigint; shareHandWithSpectators: boolean } | null;
}

/**
 * Row-driven banner stack: one banner per active SpectatorHandRequest for
 * this game. Each banner has Share / Dismiss buttons. Dismiss is local-only
 * (no server signal — the server only tracks the request itself).
 * Auto-dismisses when the underlying row is deleted by the 30s expiry
 * reducer OR when myPlayer.shareHandWithSpectators flips from false to true.
 *
 * Styled to match PauseConsentToast — see that component for the canonical
 * consent-banner pattern in this app.
 */
export default function SpectatorHandRequestBanner({
  gameId,
  myPlayer,
}: SpectatorHandRequestBannerProps) {
  const spacetimeCtx = useSpacetimeDB() as any;
  const conn = spacetimeCtx?.getConnection?.() ?? null;
  const [allRequests] = useTable(
    tables.SpectatorHandRequest.where(r => r.gameId.eq(gameId ?? 0n)),
  );
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const prevSharingRef = useRef(false);

  // Auto-dismiss only when shareHandWithSpectators flips false → true.
  useEffect(() => {
    const sharing = !!myPlayer?.shareHandWithSpectators;
    const flipped = !prevSharingRef.current && sharing;
    prevSharingRef.current = sharing;
    if (!flipped) return;
    setDismissed(prev => {
      const next = new Set(prev);
      for (const r of allRequests) next.add(r.id.toString());
      return next;
    });
  }, [myPlayer?.shareHandWithSpectators, allRequests]);

  const visible = useMemo(
    () => allRequests.filter(r => !dismissed.has(r.id.toString())),
    [allRequests, dismissed],
  );

  if (!myPlayer || visible.length === 0) return null;

  const onShare = () => {
    conn?.reducers.setShareHandWithSpectators({ gameId: myPlayer.gameId, share: true });
  };

  const onDismiss = (id: bigint) => {
    setDismissed(prev => {
      const next = new Set(prev);
      next.add(id.toString());
      return next;
    });
  };

  return (
    <div
      style={{
        position: 'absolute',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        zIndex: 800,
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        pointerEvents: 'none',
      }}
    >
      {visible.map((req) => (
        <div
          key={req.id.toString()}
          style={{
            background: 'rgba(14, 10, 6, 0.95)',
            border: '1px solid rgba(196, 149, 90, 0.4)',
            borderRadius: 8,
            padding: '14px 20px',
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
            boxShadow: '0 4px 24px rgba(0,0,0,0.5)',
            pointerEvents: 'auto',
            minWidth: 360,
          }}
        >
          {/* Header — explicit "spectator request" label */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              paddingBottom: 8,
              borderBottom: '1px solid rgba(107, 78, 39, 0.3)',
            }}
          >
            {/* Eye icon makes it visually clear this is from a spectator */}
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="rgba(196, 149, 90, 0.85)"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
            <span
              style={{
                fontFamily: 'var(--font-cinzel), Georgia, serif',
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
                color: 'rgba(196, 149, 90, 0.85)',
              }}
            >
              Spectator request
            </span>
          </div>

          {/* Body — who and what */}
          <p
            style={{
              fontFamily: 'Georgia, serif',
              fontSize: 14,
              color: '#e8d5a3',
              margin: 0,
              lineHeight: 1.4,
            }}
          >
            <span style={{ fontWeight: 700 }}>{req.spectatorName}</span>
            {' is spectating and would like to see hands.'}
          </p>

          {/* Actions */}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button
              onClick={() => onDismiss(req.id)}
              style={{
                padding: '8px 16px',
                borderRadius: 4,
                border: '1px solid rgba(107, 78, 39, 0.3)',
                background: 'transparent',
                color: 'rgba(196, 149, 90, 0.7)',
                fontFamily: 'var(--font-cinzel), Georgia, serif',
                fontSize: 12,
                fontWeight: 700,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              Dismiss
            </button>
            <button
              onClick={onShare}
              style={{
                padding: '8px 16px',
                borderRadius: 4,
                border: '1px solid rgba(196, 149, 90, 0.45)',
                background: 'rgba(196, 149, 90, 0.15)',
                color: '#e8d5a3',
                fontFamily: 'var(--font-cinzel), Georgia, serif',
                fontSize: 12,
                fontWeight: 700,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              Share hand
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
