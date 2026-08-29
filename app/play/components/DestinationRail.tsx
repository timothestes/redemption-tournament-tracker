'use client';

import React, { useMemo, useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ZONE_LABELS, type ZoneId } from '@/app/shared/types/gameCard';
import { legalDestinations, type TapMoveState, type ZoneOwner } from '@/app/play/lib/tapToMoveCore';

interface DestinationRailProps {
  state: TapMoveState;
  format: 'T1' | 'T2' | 'Paragon';
  cardName?: string;
  onPick: (zone: ZoneId, owner: ZoneOwner) => void;
  onCancel: () => void;
}

/** Short labels - the full ZONE_LABELS strings overflow a chip. */
const SHORT_LABELS: Partial<Record<ZoneId, string>> = {
  'land-of-redemption': 'LoR',
  'land-of-bondage': 'LoB',
  'soul-deck': 'Soul Deck',
};

function label(zone: ZoneId): string {
  return SHORT_LABELS[zone] ?? ZONE_LABELS[zone];
}

/**
 * Chip bar listing every legal destination for the armed card, INCLUDING
 * destinations currently off-screen.
 *
 * This is the answer to the reachability problem a pan/zoom camera creates:
 * with the rail, moving a card to the opponent's side never depends on what
 * the camera happens to be showing.
 */
export function DestinationRail({
  state, format, cardName, onPick, onCancel,
}: DestinationRailProps) {
  const [side, setSide] = useState<ZoneOwner>('my');

  // Reset to my own side whenever a new card is armed, so the rail never
  // opens on a stale tab from the previous move.
  const armedId = state.kind === 'armed' ? state.cardId : null;
  useEffect(() => { setSide('my'); }, [armedId]);

  const destinations = useMemo(() => {
    if (state.kind !== 'armed') return [];
    return legalDestinations(state.sourceZone, state.sourceOwner, format);
  }, [state, format]);

  const visible = destinations.filter((d) => d.owner === side);
  const hasShared = destinations.some((d) => d.owner === 'shared');
  const sides: ZoneOwner[] = hasShared ? ['my', 'opponent', 'shared'] : ['my', 'opponent'];

  return (
    <AnimatePresence>
      {state.kind === 'armed' && (
        <motion.div
          className="pointer-events-auto absolute inset-x-0 bottom-0 z-40
                     border-t border-neutral-700 bg-neutral-900/95 backdrop-blur
                     pb-[env(safe-area-inset-bottom)]"
          initial={{ y: '100%' }}
          animate={{ y: 0 }}
          exit={{ y: '100%' }}
          transition={{ type: 'spring', damping: 30, stiffness: 320 }}
          data-testid="destination-rail"
        >
          <div className="flex items-center justify-between px-3 pt-2">
            <span className="truncate text-[13px] font-medium text-neutral-200">
              Move {cardName ?? 'card'} to&hellip;
            </span>
            <button
              type="button"
              onClick={onCancel}
              data-testid="destination-rail-cancel"
              className="min-h-[44px] min-w-[44px] px-3 text-[13px] text-neutral-400 active:text-neutral-100"
            >
              Cancel
            </button>
          </div>

          <div className="flex gap-2 px-3 pt-1">
            {sides.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setSide(s)}
                data-testid={`destination-side-${s}`}
                className={
                  'min-h-[44px] rounded-md px-3 text-[13px] font-medium ' +
                  (side === s
                    ? 'bg-neutral-700 text-neutral-50'
                    : 'text-neutral-400 active:bg-neutral-800')
                }
              >
                {s === 'my' ? 'Mine' : s === 'opponent' ? 'Theirs' : 'Shared'}
              </button>
            ))}
          </div>

          <div className="flex gap-2 overflow-x-auto px-3 py-2">
            {visible.map((d) => (
              <button
                key={`${d.owner}:${d.zone}`}
                type="button"
                onClick={() => onPick(d.zone, d.owner)}
                data-testid={`destination-${d.owner}-${d.zone}`}
                className="min-h-[44px] shrink-0 rounded-lg border border-neutral-600
                           bg-neutral-800 px-4 text-[14px] font-medium text-neutral-100
                           active:bg-neutral-700"
              >
                {label(d.zone)}
              </button>
            ))}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
