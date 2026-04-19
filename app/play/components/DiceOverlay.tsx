'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DiceRollData {
  result: number;
  sides: number;
  rollerId: string; // player identity hex
}

interface DiceOverlayProps {
  lastDiceRoll: string; // JSON string: { result, sides, rollerId }
  myPlayer: { identity: unknown; displayName: string } | undefined;
  opponentPlayer: { identity: unknown; displayName: string } | undefined;
  identityHex: string | undefined;
}

interface ActiveRoll {
  id: number;
  data: DiceRollData;
  rollerName: string;
  isMe: boolean;
  displayValue: number;
  isTumbling: boolean;
}

// ---------------------------------------------------------------------------
// Animation constants
// ---------------------------------------------------------------------------

const TUMBLE_DURATION_MS = 600;
const DISPLAY_DURATION_MS = 3000;
const TUMBLE_FRAMES = 10;
const SPARK_COUNT = 8;

// ---------------------------------------------------------------------------
// Spark particles — burst outward when die lands
// ---------------------------------------------------------------------------

function SparkBurst({ color, size }: { color: string; size: number }) {
  const sparks = useMemo(() =>
    Array.from({ length: SPARK_COUNT }, (_, i) => {
      const angle = (i / SPARK_COUNT) * Math.PI * 2 + (Math.random() - 0.5) * 0.5;
      const dist = size * 0.5 + Math.random() * size * 0.4;
      return {
        x: Math.cos(angle) * dist,
        y: Math.sin(angle) * dist,
        delay: Math.random() * 0.06,
        s: 0.4 + Math.random() * 0.7,
      };
    }),
  [size]);

  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
      {sparks.map((sp, i) => (
        <motion.div
          key={i}
          initial={{ x: size / 2, y: size / 2, scale: sp.s, opacity: 1 }}
          animate={{ x: size / 2 + sp.x, y: size / 2 + sp.y, scale: 0, opacity: 0 }}
          transition={{ duration: 0.45, delay: sp.delay, ease: 'easeOut' }}
          style={{
            position: 'absolute',
            width: 3,
            height: 3,
            borderRadius: '50%',
            backgroundColor: color,
            boxShadow: `0 0 5px ${color}`,
          }}
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// d20 SVG shape
// ---------------------------------------------------------------------------

function D20Face({ value, sides, size, accent = '#c4955a' }: { value: number; sides: number; size: number; accent?: string }) {
  const label = String(value);
  const sidesLabel = `d${sides}`;

  return (
    <svg width={size} height={size} viewBox="0 0 100 100">
      {/* Outer polygon body */}
      <polygon
        points="50,4 96,27 96,73 50,96 4,73 4,27"
        fill="#1a1308"
        stroke={accent}
        strokeWidth={2}
      />
      {/* Inner inset polygon */}
      <polygon
        points="50,12 88,31 88,69 50,88 12,69 12,31"
        fill="none"
        stroke={`${accent}30`}
        strokeWidth={1}
      />
      {/* Die type label (small, top) */}
      <text
        x="50"
        y="28"
        textAnchor="middle"
        fontFamily="Georgia, serif"
        fontSize="11"
        fill={`${accent}99`}
        letterSpacing="1"
      >
        {sidesLabel}
      </text>
      {/* Result value (large, center) */}
      <text
        x="50"
        y="62"
        textAnchor="middle"
        fontFamily="Georgia, serif"
        fontSize="28"
        fontWeight="bold"
        fill="#e8d5a3"
      >
        {label}
      </text>
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Single die display (used for each roll slot)
// ---------------------------------------------------------------------------

function DieDisplay({ roll, dieSize }: { roll: ActiveRoll; dieSize: number }) {
  const sparkColor = roll.isMe ? '#c4955a' : '#4a7ab5';

  return (
    <div
      style={{
        position: 'relative',
        width: dieSize,
      }}
    >
      {/* Spark burst on landing */}
      <AnimatePresence>
        {!roll.isTumbling && (
          <SparkBurst color={sparkColor} size={dieSize} />
        )}
      </AnimatePresence>

      {/* Die with tumble animation */}
      <motion.div
        key={`die-${roll.id}`}
        initial={{ scale: 0.4, rotate: -90, opacity: 0 }}
        animate={
          roll.isTumbling
            ? { scale: [0.4, 1.15, 0.95, 1.05, 1], rotate: [-90, 60, -20, 8, 0], opacity: 1 }
            : { scale: [1.12, 1], rotate: 0, opacity: 1 }
        }
        transition={
          roll.isTumbling
            ? { duration: TUMBLE_DURATION_MS / 1000, ease: 'easeOut' }
            : { duration: 0.2, ease: 'easeOut' }
        }
        style={{
          filter: roll.isTumbling
            ? 'drop-shadow(0 4px 20px rgba(0,0,0,0.8)) drop-shadow(0 0 10px rgba(196,149,90,0.3))'
            : `drop-shadow(0 4px 20px rgba(0,0,0,0.8)) drop-shadow(0 0 14px ${sparkColor}40)`,
        }}
      >
        <D20Face value={roll.displayValue} sides={roll.data.sides} size={dieSize} accent={sparkColor} />
      </motion.div>

      {/* Roller name + result label — fades in after tumble, absolutely positioned below die */}
      <AnimatePresence>
        {!roll.isTumbling && (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2, delay: 0.05 }}
            style={{
              position: 'absolute',
              top: dieSize + 4,
              left: 0,
              width: dieSize,
              textAlign: 'center',
              pointerEvents: 'none',
            }}
          >
            {/* Countdown bar */}
            <div
              style={{
                width: '100%',
                height: 2,
                borderRadius: 1,
                backgroundColor: 'rgba(232,213,163,0.12)',
                marginBottom: 6,
                overflow: 'hidden',
              }}
            >
              <motion.div
                initial={{ width: '100%' }}
                animate={{ width: '0%' }}
                transition={{ duration: DISPLAY_DURATION_MS / 1000, ease: 'linear' }}
                style={{
                  height: '100%',
                  borderRadius: 1,
                  backgroundColor: roll.isMe ? 'rgba(196,149,90,0.5)' : 'rgba(74,122,181,0.5)',
                }}
              />
            </div>
            <div
              style={{
                fontFamily: 'var(--font-cinzel), Georgia, serif',
                fontSize: 11,
                letterSpacing: '0.07em',
                textTransform: 'uppercase',
                color: roll.isMe ? '#c4955a' : '#4a7ab5',
                textShadow: '0 1px 6px rgba(0,0,0,0.9)',
                lineHeight: 1.3,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {roll.rollerName}
            </div>
            <div
              style={{
                fontFamily: 'var(--font-cinzel), Georgia, serif',
                fontSize: 10,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                color: 'rgba(232,213,163,0.6)',
                textShadow: '0 1px 6px rgba(0,0,0,0.9)',
                lineHeight: 1.3,
              }}
            >
              rolled {roll.data.result}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main overlay component
// ---------------------------------------------------------------------------

export default function DiceOverlay({
  lastDiceRoll,
  myPlayer,
  opponentPlayer,
  identityHex,
}: DiceOverlayProps) {
  const [myRoll, setMyRoll] = useState<ActiveRoll | null>(null);
  const [opponentRoll, setOpponentRoll] = useState<ActiveRoll | null>(null);

  const rollIdRef = useRef(0);
  const prevLastDiceRollRef = useRef<string>(lastDiceRoll || '');
  // Per-slot timer refs so one player's roll can't cancel the other's dismiss
  const myTimersRef = useRef<{ interval?: ReturnType<typeof setInterval>; dismiss?: ReturnType<typeof setTimeout> }>({});
  const oppTimersRef = useRef<{ interval?: ReturnType<typeof setInterval>; dismiss?: ReturnType<typeof setTimeout> }>({});

  useEffect(() => {
    if (!lastDiceRoll || lastDiceRoll === '' || lastDiceRoll === prevLastDiceRollRef.current) {
      return;
    }
    prevLastDiceRollRef.current = lastDiceRoll;

    let parsed: DiceRollData;
    try {
      parsed = JSON.parse(lastDiceRoll) as DiceRollData;
    } catch {
      return;
    }

    // Resolve roller display name — rollerId is the Player table row ID (not identity hex)
    const myPlayerId = myPlayer ? String((myPlayer as any).id) : '';
    const isMe = parsed.rollerId === myPlayerId;

    let rollerName = 'Unknown';
    if (isMe) {
      rollerName = myPlayer?.displayName ?? 'You';
    } else {
      rollerName = opponentPlayer?.displayName ?? 'Opponent';
    }

    const id = ++rollIdRef.current;
    const setRoll = isMe ? setMyRoll : setOpponentRoll;
    const timers = isMe ? myTimersRef : oppTimersRef;

    // Clear only THIS slot's previous timers
    if (timers.current.interval) clearInterval(timers.current.interval);
    if (timers.current.dismiss) clearTimeout(timers.current.dismiss);

    const newRoll: ActiveRoll = {
      id,
      data: parsed,
      rollerName,
      isMe,
      displayValue: Math.floor(Math.random() * (parsed.sides || 20)) + 1,
      isTumbling: true,
    };
    setRoll(newRoll);

    // Tumble through random faces
    let frame = 0;
    timers.current.interval = setInterval(() => {
      frame++;
      const dv = frame >= TUMBLE_FRAMES
        ? parsed.result
        : Math.floor(Math.random() * (parsed.sides || 20)) + 1;
      setRoll((prev) => {
        if (!prev || prev.id !== id) return prev;
        return {
          ...prev,
          displayValue: dv,
          isTumbling: frame < TUMBLE_FRAMES,
        };
      });
      if (frame >= TUMBLE_FRAMES) {
        clearInterval(timers.current.interval);
      }
    }, TUMBLE_DURATION_MS / TUMBLE_FRAMES);

    // Auto-dismiss
    timers.current.dismiss = setTimeout(() => {
      setRoll((prev) => (prev?.id === id ? null : prev));
    }, TUMBLE_DURATION_MS + DISPLAY_DURATION_MS);
  }, [lastDiceRoll, identityHex, myPlayer, opponentPlayer]);

  // Cleanup on unmount only
  useEffect(() => {
    return () => {
      if (myTimersRef.current.interval) clearInterval(myTimersRef.current.interval);
      if (myTimersRef.current.dismiss) clearTimeout(myTimersRef.current.dismiss);
      if (oppTimersRef.current.interval) clearInterval(oppTimersRef.current.interval);
      if (oppTimersRef.current.dismiss) clearTimeout(oppTimersRef.current.dismiss);
    };
  }, []);

  const dieSize = 96;

  const hasAny = myRoll || opponentRoll;

  return (
    <AnimatePresence>
      {hasAny && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.25 } }}
          style={{
            position: 'fixed',
            bottom: 80,
            left: 16,
            zIndex: 950,
            pointerEvents: 'none',
            display: 'flex',
            gap: 12,
            alignItems: 'flex-end',
          }}
        >
          <AnimatePresence>
            {myRoll && (
              <motion.div
                key="my"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 20, transition: { duration: 0.25 } }}
                transition={{ duration: 0.15 }}
              >
                <DieDisplay roll={myRoll} dieSize={dieSize} />
              </motion.div>
            )}
          </AnimatePresence>
          <AnimatePresence>
            {opponentRoll && (
              <motion.div
                key="opp"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 20, transition: { duration: 0.25 } }}
                transition={{ duration: 0.15 }}
              >
                <DieDisplay roll={opponentRoll} dieSize={dieSize} />
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
