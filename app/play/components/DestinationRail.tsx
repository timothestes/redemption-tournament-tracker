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
  banish: 'Banish',
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
          {/* Armed-card name — a small tab riding the rail's top edge, so the
              player can see WHICH card the chips will move (pairs with the
              amber ring on the card itself). Absolute: costs no rail width. */}
          {cardName && (
            <span
              data-testid="destination-rail-card-name"
              className="pointer-events-none absolute -top-[22px] left-2 max-w-[60%] truncate
                         rounded-t-md border border-b-0 border-neutral-700 bg-neutral-900/95
                         px-2 py-0.5 text-[11px] font-medium text-amber-200/90"
            >
              {cardName}
            </span>
          )}
          {/* One compact row. Three stacked rows were ~130px tall, which on a
              393px-high phone buried the entire hand band. */}
          {/* Side selector — a segmented control, visually distinct from the
              destination chips so "which side" doesn't read as a destination.
              Unselected segments stay clearly legible (they looked disabled
              at neutral-400). */}
          <div
            role="group"
            aria-label="Whose side"
            className="flex shrink-0 overflow-hidden rounded-lg border border-neutral-500"
          >
            {sides.map((s, i) => (
              <button
                key={s}
                type="button"
                onClick={() => setSide(s)}
                data-testid={`destination-side-${s}`}
                aria-pressed={side === s}
                className={
                  'min-h-[44px] px-3 text-[12px] font-semibold ' +
                  (i > 0 ? 'border-l border-neutral-500 ' : '') +
                  (side === s
                    ? 'bg-neutral-200 text-neutral-900'
                    : 'bg-neutral-900 text-neutral-200 active:bg-neutral-700')
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
            className="min-h-[44px] min-w-[44px] shrink-0 rounded-lg border border-neutral-600
                       px-3 text-[12px] text-neutral-300 active:bg-neutral-800 active:text-neutral-100"
          >
            Cancel
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
