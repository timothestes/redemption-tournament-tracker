'use client';

import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface DiceOverlayProps {
  /** The final result value (1-N). `null` means no roll is active. */
  result: number | null;
  /** Number of sides on the die (6 for d6, 20 for d20, etc.) */
  sides: number;
  /** Display name of the person who rolled. Omit for goldfish (solo) mode. */
  rollerName?: string;
  /** Called when the overlay finishes its display cycle and should be cleared. */
  onDismiss: () => void;
}

// ---------------------------------------------------------------------------
// Animation constants
// ---------------------------------------------------------------------------

const TUMBLE_DURATION_MS = 500;
const DISPLAY_DURATION_MS = 3000;
const TUMBLE_FRAMES = 8;

// ---------------------------------------------------------------------------
// d6 pip layout — classic western die face positions in 0-100 coordinate space
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Polygon face for d20+ (or any die > 6 sides)
// ---------------------------------------------------------------------------

function PolygonFace({ value, sides, size }: { value: number; sides: number; size: number }) {
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
// Main component
// ---------------------------------------------------------------------------

export function DiceOverlay({ result, sides, rollerName, onDismiss }: DiceOverlayProps) {
  const [displayValue, setDisplayValue] = useState<number>(1);
  const [isTumbling, setIsTumbling] = useState(false);
  const [rollId, setRollId] = useState(0);
  const rollIdRef = useRef(0);
  const prevResultRef = useRef<number | null>(null);

  useEffect(() => {
    // Only trigger animation when result changes to a non-null value
    if (result === null || result === prevResultRef.current) return;
    prevResultRef.current = result;

    const id = ++rollIdRef.current;
    setRollId(id);
    setIsTumbling(true);
    setDisplayValue(Math.floor(Math.random() * sides) + 1);

    // Rapid-fire random faces during tumble
    let frame = 0;
    const interval = setInterval(() => {
      frame++;
      setDisplayValue(Math.floor(Math.random() * sides) + 1);
      if (frame >= TUMBLE_FRAMES) {
        clearInterval(interval);
        setDisplayValue(result);
        setIsTumbling(false);
      }
    }, TUMBLE_DURATION_MS / TUMBLE_FRAMES);

    // Auto-dismiss after tumble + display
    const dismissTimer = setTimeout(() => {
      onDismiss();
    }, TUMBLE_DURATION_MS + DISPLAY_DURATION_MS);

    return () => {
      clearInterval(interval);
      clearTimeout(dismissTimer);
    };
  }, [result, sides, onDismiss]);

  // Clear prev ref when result goes null (roll dismissed externally)
  useEffect(() => {
    if (result === null) {
      prevResultRef.current = null;
    }
  }, [result]);

  const isD6 = sides <= 6;
  const dieSize = isD6 ? 80 : 96;

  return (
    <AnimatePresence>
      {result !== null && (
        <motion.div
          key={rollId}
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -20, transition: { duration: 0.25 } }}
          transition={{ duration: 0.15 }}
          style={{
            position: 'fixed',
            bottom: 80,
            left: 24,
            zIndex: 950,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            pointerEvents: 'none',
            gap: 0,
          }}
        >
          {/* Die with tumble animation */}
          <motion.div
            key={`die-${rollId}`}
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
            {isD6 ? (
              <DieFace value={displayValue} size={dieSize} />
            ) : (
              <PolygonFace value={displayValue} sides={sides} size={dieSize} />
            )}
          </motion.div>

          {/* Result label — appears after tumble finishes */}
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
                {rollerName && (
                  <div
                    style={{
                      fontFamily: 'var(--font-cinzel), Georgia, serif',
                      fontSize: 11,
                      letterSpacing: '0.07em',
                      textTransform: 'uppercase',
                      color: '#c4955a',
                      textShadow: '0 1px 6px rgba(0,0,0,0.9)',
                      lineHeight: 1.3,
                    }}
                  >
                    {rollerName}
                  </div>
                )}
                <div
                  style={{
                    fontFamily: 'var(--font-cinzel), Georgia, serif',
                    fontSize: rollerName ? 10 : 14,
                    letterSpacing: rollerName ? '0.06em' : '0.08em',
                    textTransform: 'uppercase',
                    color: rollerName ? 'rgba(232,213,163,0.6)' : 'var(--gf-text-bright)',
                    textShadow: '0 2px 8px rgba(0,0,0,0.8)',
                    lineHeight: 1.3,
                  }}
                >
                  {rollerName ? `rolled ${result}` : `Rolled a ${result}`}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
