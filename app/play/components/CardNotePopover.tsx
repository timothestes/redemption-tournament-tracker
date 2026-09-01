'use client';

import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { useInputMode } from '@/app/shared/hooks/useInputMode';

const MAX_LEN = 40;
const WIDTH = 260;
const HEIGHT = 92;

interface CardNotePopoverProps {
  x: number;
  y: number;
  initialValue: string;
  onSave: (text: string) => void;
  onCancel: () => void;
}

export function CardNotePopover({ x, y, initialValue, onSave, onCancel }: CardNotePopoverProps) {
  const [value, setValue] = useState(initialValue);
  // Touch: iOS Safari auto-zooms the page when focusing an input whose font
  // is under 16px — keep the pointer build at 13px, raise touch to 16px.
  const isTouch = useInputMode() === 'touch';
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const valueRef = useRef(value);
  valueRef.current = value;

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  useEffect(() => {
    const handleClick = (e: MouseEvent | TouchEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onSave(valueRef.current.trim());
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('mousedown', handleClick);
    // Touch taps don't reliably synthesize mousedown (and the synthesized
    // click is suppressed elsewhere) — without this, a phone player had no
    // way to dismiss the note except the keyboard's Done.
    document.addEventListener('touchstart', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('touchstart', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [onSave, onCancel]);

  // Clamp against the VISUAL viewport: with the keyboard up on a phone,
  // window.innerHeight still reports the full layout height, and a note on a
  // card in the lower board opened underneath the keyboard — typing blind.
  // The keyboard opens AFTER mount (the focus effect above), so track the
  // visual viewport and re-clamp when it shrinks.
  const [viewportH, setViewportH] = useState(() =>
    typeof window !== 'undefined' ? (window.visualViewport?.height ?? window.innerHeight) : 0,
  );
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const onResize = () => setViewportH(vv.height);
    vv.addEventListener('resize', onResize);
    return () => vv.removeEventListener('resize', onResize);
  }, []);

  const left = Math.max(8, Math.min(x, window.innerWidth - WIDTH - 8));
  const top = Math.max(8, Math.min(y, viewportH - HEIGHT - 8));

  const handleSubmit = () => {
    onSave(value.trim());
  };

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={{ duration: 0.1 }}
      style={{
        position: 'fixed',
        left,
        top,
        width: WIDTH,
        background: 'var(--gf-bg)',
        border: '1px solid var(--gf-border)',
        borderRadius: 6,
        padding: 10,
        zIndex: 1000,
        boxShadow: '0 8px 24px rgba(0,0,0,0.6)',
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <input
        ref={inputRef}
        value={value}
        maxLength={MAX_LEN}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            handleSubmit();
          }
        }}
        placeholder="Add a note..."
        style={{
          width: '100%',
          padding: '6px 8px',
          background: 'var(--gf-bg-elevated, rgba(0,0,0,0.2))',
          border: '1px solid var(--gf-border)',
          borderRadius: 4,
          color: 'var(--gf-text)',
          fontSize: isTouch ? 16 : 13,
          fontFamily: 'var(--font-cinzel), Georgia, serif',
          outline: 'none',
        }}
      />
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginTop: 6,
          fontSize: 10,
          color: 'var(--gf-text-dim)',
        }}
      >
        <span>Enter or click away to save · Esc to cancel</span>
        <span>{value.length} / {MAX_LEN}</span>
      </div>
    </motion.div>
  );
}
