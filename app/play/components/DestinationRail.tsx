'use client';

import React, { useMemo, useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ZONE_LABELS, type ZoneId } from '@/app/shared/types/gameCard';
import { legalDestinations, type TapMoveState, type ZoneOwner } from '@/app/play/lib/tapToMoveCore';

interface DestinationRailProps {
  state: TapMoveState;
  format: 'T1' | 'T2' | 'Paragon';
  cardName?: string;
  /** Height of the player's hand band in screen px. The rail floats ABOVE it
   *  rather than over it: a card is usually armed FROM the hand, so covering
   *  the hand would hide the card just picked and block re-arming another. */
  handBandHeight?: number;
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
  state, format, cardName, handBandHeight = 0, onPick, onCancel,
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
          className="pointer-events-auto absolute inset-x-0 z-[300] flex items-center gap-2
                     border-y border-neutral-700 bg-neutral-900/95 px-2 py-1 backdrop-blur"
          style={{ bottom: handBandHeight }}
          initial={{ y: '100%', opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: '100%', opacity: 0 }}
          transition={{ type: 'spring', damping: 30, stiffness: 320 }}
          data-testid="destination-rail"
        >
          {/* One compact row. Three stacked rows were ~130px tall, which on a
              393px-high phone buried the entire hand band. */}
          <div className="flex shrink-0 gap-1">
            {sides.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setSide(s)}
                data-testid={`destination-side-${s}`}
                className={
                  'min-h-[44px] rounded-md px-2 text-[12px] font-semibold ' +
                  (side === s
                    ? 'bg-neutral-700 text-neutral-50'
                    : 'text-neutral-400 active:bg-neutral-800')
                }
              >
                {s === 'my' ? 'Mine' : s === 'opponent' ? 'Theirs' : 'Shared'}
              </button>
            ))}
          </div>

          <div className="flex flex-1 gap-2 overflow-x-auto">
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

          <button
            type="button"
            onClick={onCancel}
            data-testid="destination-rail-cancel"
            aria-label={`Cancel moving ${cardName ?? 'card'}`}
            className="min-h-[44px] min-w-[44px] shrink-0 px-2 text-[12px] text-neutral-400 active:text-neutral-100"
          >
            Cancel
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
