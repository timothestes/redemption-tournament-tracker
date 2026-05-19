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
 * reducer OR when myPlayer.shareHandWithSpectators flips to true (covers
 * the two-tab race where a sibling tab accepted).
 */
export default function SpectatorHandRequestBanner({
  gameId,
  myPlayer,
}: SpectatorHandRequestBannerProps) {
  const { conn } = useSpacetimeDB() as any;
  const [allRequests] = useTable(
    tables.SpectatorHandRequest.where(r => r.gameId.eq(gameId ?? 0n)),
  );
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const prevSharingRef = useRef(false);

  // Auto-dismiss only when shareHandWithSpectators flips false → true.
  // Excluding allRequests from the transition check so new incoming requests
  // while the toggle is already on still render a banner.
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
        top: 80,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 800,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
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
            padding: '12px 20px',
            display: 'flex',
            alignItems: 'center',
            gap: 16,
            color: '#e6dbc4',
            pointerEvents: 'auto',
          }}
        >
          <span>{req.spectatorName} wants to see hands</span>
          <button
            onClick={onShare}
            style={{
              background: '#c4955a',
              color: '#0e0a06',
              border: 'none',
              borderRadius: 4,
              padding: '6px 12px',
              cursor: 'pointer',
              fontWeight: 600,
            }}
          >
            Share with spectators
          </button>
          <button
            onClick={() => onDismiss(req.id)}
            style={{
              background: 'transparent',
              color: '#e6dbc4',
              border: '1px solid rgba(196, 149, 90, 0.4)',
              borderRadius: 4,
              padding: '6px 12px',
              cursor: 'pointer',
            }}
          >
            Dismiss
          </button>
        </div>
      ))}
    </div>
  );
}
