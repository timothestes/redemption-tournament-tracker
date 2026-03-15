'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

// --- Dice pip layouts (classic western die face patterns) ---
// Each face is an array of [cx, cy] positions within a 0-100 coordinate space
const PIP_POSITIONS: Record<number, [number, number][]> = {
  1: [[50, 50]],
  2: [[28, 28], [72, 72]],
  3: [[28, 28], [50, 50], [72, 72]],
  4: [[28, 28], [72, 28], [28, 72], [72, 72]],
  5: [[28, 28], [72, 28], [50, 50], [28, 72], [72, 72]],
  6: [[28, 28], [72, 28], [28, 50], [72, 50], [28, 72], [72, 72]],
};

function DieFace({ value, size }: { value: number; size: number }) {
  const pips = PIP_POSITIONS[value] || [];
  const pipRadius = size * 0.09;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {/* Die body */}
      <rect
        x={2}
        y={2}
        width={size - 4}
        height={size - 4}
        rx={size * 0.12}
        ry={size * 0.12}
        fill="#1a1308"
        stroke="#c4955a"
        strokeWidth={2}
      />
      {/* Inner inset */}
      <rect
        x={6}
        y={6}
        width={size - 12}
        height={size - 12}
        rx={size * 0.09}
        ry={size * 0.09}
        fill="none"
        stroke="rgba(196, 149, 90, 0.15)"
        strokeWidth={1}
      />
      {/* Pips */}
      {pips.map(([cx, cy], i) => (
        <circle
          key={i}
          cx={(cx / 100) * size}
          cy={(cy / 100) * size}
          r={pipRadius}
          fill="#e8d5a3"
        />
      ))}
    </svg>
  );
}

// --- Global event system (same pattern as GameToast) ---
type RollListener = (value: number) => void;
const rollListeners: RollListener[] = [];

export function triggerDiceRoll() {
  const result = Math.floor(Math.random() * 6) + 1;
  rollListeners.forEach(fn => fn(result));
  return result;
}

// How long the tumble animation runs before landing
const TUMBLE_DURATION_MS = 500;
// How long the final result stays visible
const DISPLAY_DURATION_MS = 3000;
// How many random faces flash during the tumble
const TUMBLE_FRAMES = 8;

export function DiceRollOverlay() {
  const [roll, setRoll] = useState<{ id: number; value: number } | null>(null);
  const [tumbleFace, setTumbleFace] = useState<number>(1);
  const [isTumbling, setIsTumbling] = useState(false);
  const rollIdRef = useRef(0);

  useEffect(() => {
    const handler: RollListener = (value) => {
      const id = ++rollIdRef.current;
      setIsTumbling(true);
      setRoll({ id, value });

      // Rapid-fire random faces during tumble
      let frame = 0;
      const interval = setInterval(() => {
        frame++;
        setTumbleFace(Math.floor(Math.random() * 6) + 1);
        if (frame >= TUMBLE_FRAMES) {
          clearInterval(interval);
          setTumbleFace(value);
          setIsTumbling(false);
        }
      }, TUMBLE_DURATION_MS / TUMBLE_FRAMES);

      // Auto-dismiss after tumble + display
      setTimeout(() => {
        setRoll(prev => prev?.id === id ? null : prev);
      }, TUMBLE_DURATION_MS + DISPLAY_DURATION_MS);
    };

    rollListeners.push(handler);
    return () => {
      const idx = rollListeners.indexOf(handler);
      if (idx >= 0) rollListeners.splice(idx, 1);
    };
  }, []);

  const dieSize = 80;

  return (
    <AnimatePresence>
      {roll && (
        <motion.div
          key={roll.id}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.25 } }}
          transition={{ duration: 0.1 }}
          style={{
            position: 'fixed',
            bottom: 80,
            left: 24,
            zIndex: 950,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            pointerEvents: 'none',
          }}
        >
          {/* Die with tumble animation */}
          <motion.div
            initial={{ scale: 0.3, rotate: -120, opacity: 0 }}
            animate={
              isTumbling
                ? {
                    scale: [0.3, 1.1, 0.95, 1.05, 1],
                    rotate: [-120, 80, -30, 10, 0],
                    opacity: 1,
                  }
                : { scale: 1, rotate: 0, opacity: 1 }
            }
            exit={{ scale: 0.8, opacity: 0, y: 20 }}
            transition={
              isTumbling
                ? { duration: TUMBLE_DURATION_MS / 1000, ease: 'easeOut' }
                : { duration: 0.15 }
            }
            style={{
              filter: 'drop-shadow(0 4px 24px rgba(0,0,0,0.7)) drop-shadow(0 0 8px rgba(196,149,90,0.25))',
            }}
          >
            <DieFace value={tumbleFace} size={dieSize} />
          </motion.div>

          {/* Result label — positioned absolutely so it doesn't shift the die */}
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
                  width: dieSize,
                  textAlign: 'center',
                  fontFamily: 'var(--font-cinzel), Georgia, serif',
                  fontSize: 14,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  color: 'var(--gf-text-bright)',
                  textShadow: '0 2px 8px rgba(0,0,0,0.8)',
                }}
              >
                Rolled a {roll.value}
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
