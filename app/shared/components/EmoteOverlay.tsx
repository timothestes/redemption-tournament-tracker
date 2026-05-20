'use client';

import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { ThumbsUp } from 'lucide-react';

export interface EmoteRow {
  id: bigint;
  gameId: bigint;
  senderId: bigint;
  kind: string;
  createdAt: { microsSinceUnixEpoch: bigint };
}

export interface EmoteOverlayProps {
  emotes: EmoteRow[];
  /** Local player id. Own emotes anchor at the bottom, opponent's at the top.
   *  Pass `null` for spectator view (all emotes anchor to the bottom). */
  myPlayerId: bigint | null;
}

interface ActiveEmote {
  id: string;
  kind: string;
  fromOpponent: boolean;
  offsetX: number;
}

// Struck-medallion palette — solid, high-contrast, no glow.
const GOLD = '#e8c474';
const GOLD_DEEP = '#a87a26';
const STONE_TOP = '#3a2a16';
const STONE_BOT = '#120b04';
const RIM = '#6b4a1f';
const RIM_HI = '#c89a4c';

const LIFETIME_MS = 2400;
const SLAM_MS = 150;
const HOLD_MS = 1500;
const EXIT_MS = 700;

export function EmoteOverlay({ emotes, myPlayerId }: EmoteOverlayProps) {
  const seenIds = useRef<Set<string> | null>(null);
  const [active, setActive] = useState<ActiveEmote[]>([]);

  useEffect(() => {
    if (seenIds.current === null) {
      seenIds.current = new Set(emotes.map(e => e.id.toString()));
      return;
    }
    const fresh: ActiveEmote[] = [];
    for (const e of emotes) {
      const key = e.id.toString();
      if (!seenIds.current.has(key)) {
        seenIds.current.add(key);
        fresh.push({
          id: key,
          kind: e.kind,
          fromOpponent: myPlayerId !== null && e.senderId !== myPlayerId,
          offsetX: (Math.random() - 0.5) * 20,
        });
      }
    }
    if (fresh.length === 0) return;
    setActive(prev => [...prev, ...fresh]);
    const timeouts = fresh.map(f =>
      setTimeout(() => {
        setActive(prev => prev.filter(a => a.id !== f.id));
      }, LIFETIME_MS),
    );
    return () => timeouts.forEach(clearTimeout);
  }, [emotes, myPlayerId]);

  return (
    <>
      {active.map(a => (
        <EmoteInstance key={a.id} emote={a} />
      ))}
    </>
  );
}

function EmoteInstance({ emote }: { emote: ActiveEmote }) {
  const { fromOpponent, offsetX, kind } = emote;

  // Self emote: smaller, subtler. Opponent emote: larger, dominant.
  const size = fromOpponent ? 88 : 64;
  const exitY = fromOpponent ? 36 : -36; // opponent drifts further into your space; self drifts up
  const entryY = fromOpponent ? -28 : 28;
  const peakOpacity = fromOpponent ? 1 : 0.85;

  const anchorStyle: React.CSSProperties = fromOpponent
    ? { position: 'fixed', top: 88, left: '50%', transform: 'translateX(-50%)' }
    : { position: 'fixed', bottom: 92, left: '50%', transform: 'translateX(-50%)' };

  // Keyframe schedule — entry (slam) → hold → exit (drift)
  const t1 = SLAM_MS / LIFETIME_MS;
  const t2 = (SLAM_MS + 60) / LIFETIME_MS; // settle from overshoot
  const t3 = (SLAM_MS + HOLD_MS) / LIFETIME_MS; // start exit
  // exit ends at 1.0

  const renderIcon = (px: number) =>
    kind === 'thumbs_up' ? (
      <ThumbsUp size={px} strokeWidth={2} color={GOLD} fill={GOLD_DEEP} />
    ) : null;

  return (
    <div style={{ ...anchorStyle, pointerEvents: 'none', zIndex: 250 }} aria-hidden>
      <motion.div
        initial={{ opacity: 0, x: offsetX, y: entryY, scale: 0.55 }}
        animate={{
          opacity: [0, peakOpacity, peakOpacity, peakOpacity, 0],
          y: [entryY, 0, 0, 0, exitY],
          scale: [0.55, 1.12, 1, 1, 0.96],
        }}
        transition={{
          duration: LIFETIME_MS / 1000,
          times: [0, t1, t2, t3, 1],
          ease: ['easeOut', 'easeOut', 'linear', 'easeIn'],
        }}
        style={{
          position: 'absolute',
          left: -size / 2,
          top: -size / 2,
          width: size,
          height: size,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {/* Solid medallion — sharp edges, no blur. Inner stone, two rims. */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            borderRadius: '50%',
            background: `linear-gradient(180deg, ${STONE_TOP} 0%, ${STONE_BOT} 100%)`,
            boxShadow: [
              `inset 0 1px 0 ${RIM_HI}`,                // top highlight (bevel)
              `inset 0 -1px 1px rgba(0,0,0,0.85)`,      // bottom shadow (bevel)
              `0 0 0 1px ${RIM}`,                       // outer rim (crisp)
              `0 0 0 3px rgba(0,0,0,0.55)`,             // outer ring (separation from bg)
              `0 6px 14px rgba(0,0,0,0.65)`,            // ground shadow
            ].join(', '),
          }}
        />
        {/* Icon — crisp, no glow */}
        <div
          style={{
            position: 'relative',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            filter: 'drop-shadow(0 1px 1px rgba(0,0,0,0.9))',
          }}
        >
          {renderIcon(Math.round(size * 0.55))}
        </div>
      </motion.div>
    </div>
  );
}
