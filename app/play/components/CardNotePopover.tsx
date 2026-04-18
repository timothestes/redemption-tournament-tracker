'use client';

import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';

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
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onCancel();
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [onCancel]);

  const left = Math.max(8, Math.min(x, window.innerWidth - WIDTH - 8));
  const top = Math.max(8, Math.min(y, window.innerHeight - HEIGHT - 8));

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
          fontSize: 13,
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
        <span>Enter to save · Esc to cancel</span>
        <span>{value.length} / {MAX_LEN}</span>
      </div>
    </motion.div>
  );
}
