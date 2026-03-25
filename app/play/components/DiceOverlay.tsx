'use client';

import { useState, useEffect, useRef } from 'react';
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

// ---------------------------------------------------------------------------
// Animation constants
// ---------------------------------------------------------------------------

const TUMBLE_DURATION_MS = 600;
const DISPLAY_DURATION_MS = 3000;
const TUMBLE_FRAMES = 10;

// ---------------------------------------------------------------------------
// d20 SVG shape
// ---------------------------------------------------------------------------

function D20Face({ value, sides, size }: { value: number; sides: number; size: number }) {
  const label = String(value);
  const sidesLabel = `d${sides}`;

  return (
    <svg width={size} height={size} viewBox="0 0 100 100">
      {/* Outer polygon body */}
      <polygon
        points="50,4 96,27 96,73 50,96 4,73 4,27"
        fill="#1a1308"
        stroke="#c4955a"
        strokeWidth={2}
      />
      {/* Inner inset polygon */}
      <polygon
        points="50,12 88,31 88,69 50,88 12,69 12,31"
        fill="none"
        stroke="rgba(196,149,90,0.18)"
        strokeWidth={1}
      />
      {/* Die type label (small, top) */}
      <text
        x="50"
        y="28"
        textAnchor="middle"
        fontFamily="Georgia, serif"
        fontSize="11"
        fill="rgba(196,149,90,0.6)"
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
// Main overlay component
// ---------------------------------------------------------------------------

export default function DiceOverlay({
  lastDiceRoll,
  myPlayer,
  opponentPlayer,
  identityHex,
}: DiceOverlayProps) {
  const [activeRoll, setActiveRoll] = useState<{
    id: number;
    data: DiceRollData;
    rollerName: string;
    isMe: boolean;
  } | null>(null);
  const [displayValue, setDisplayValue] = useState(1);
  const [isTumbling, setIsTumbling] = useState(false);

  const rollIdRef = useRef(0);
  const prevLastDiceRollRef = useRef<string>('');

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

    setIsTumbling(true);
    setDisplayValue(Math.floor(Math.random() * (parsed.sides || 20)) + 1);
    setActiveRoll({ id, data: parsed, rollerName, isMe });

    // Tumble through random faces
    let frame = 0;
    const interval = setInterval(() => {
      frame++;
      setDisplayValue(Math.floor(Math.random() * (parsed.sides || 20)) + 1);
      if (frame >= TUMBLE_FRAMES) {
        clearInterval(interval);
        setDisplayValue(parsed.result);
        setIsTumbling(false);
      }
    }, TUMBLE_DURATION_MS / TUMBLE_FRAMES);

    // Auto-dismiss
    const dismissTimer = setTimeout(() => {
      setActiveRoll((prev) => (prev?.id === id ? null : prev));
    }, TUMBLE_DURATION_MS + DISPLAY_DURATION_MS);

    return () => {
      clearInterval(interval);
      clearTimeout(dismissTimer);
    };
  }, [lastDiceRoll, identityHex, myPlayer, opponentPlayer]);

  const dieSize = 96;

  return (
    <AnimatePresence>
      {activeRoll && (
        <motion.div
          key={activeRoll.id}
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -20, transition: { duration: 0.25 } }}
          transition={{ duration: 0.15 }}
          style={{
            position: 'fixed',
            bottom: 68, // sits above the 52px TurnIndicator bar with a small gap
            left: 16,
            zIndex: 500,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            pointerEvents: 'none',
            gap: 0,
          }}
        >
          {/* Die with tumble animation */}
          <motion.div
            key={`die-${activeRoll.id}`}
            initial={{ scale: 0.4, rotate: -90, opacity: 0 }}
            animate={
              isTumbling
                ? { scale: [0.4, 1.15, 0.95, 1.05, 1], rotate: [-90, 60, -20, 8, 0], opacity: 1 }
                : { scale: 1, rotate: 0, opacity: 1 }
            }
            transition={
              isTumbling
                ? { duration: TUMBLE_DURATION_MS / 1000, ease: 'easeOut' }
                : { duration: 0.12 }
            }
            style={{
              filter:
                'drop-shadow(0 4px 20px rgba(0,0,0,0.8)) drop-shadow(0 0 10px rgba(196,149,90,0.3))',
            }}
          >
            <D20Face
              value={displayValue}
              sides={activeRoll.data.sides}
              size={dieSize}
            />
          </motion.div>

          {/* Roller name + result label — fades in after tumble */}
          <AnimatePresence>
            {!isTumbling && (
              <motion.div
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2, delay: 0.05 }}
                style={{
                  position: 'absolute',
                  top: dieSize + 10,
                  left: '50%',
                  transform: 'translateX(-50%)',
                  textAlign: 'center',
                  whiteSpace: 'nowrap',
                  pointerEvents: 'none',
                }}
              >
                <div
                  style={{
                    fontFamily: 'var(--font-cinzel), Georgia, serif',
                    fontSize: 11,
                    letterSpacing: '0.07em',
                    textTransform: 'uppercase',
                    color: activeRoll.isMe ? '#c4955a' : '#4a7ab5',
                    textShadow: '0 1px 6px rgba(0,0,0,0.9)',
                    lineHeight: 1.3,
                  }}
                >
                  {activeRoll.rollerName}
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
                  rolled {activeRoll.data.result}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
