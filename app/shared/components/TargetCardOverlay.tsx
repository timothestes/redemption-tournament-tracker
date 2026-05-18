'use client';

import { useEffect } from 'react';

export interface TargetCardOverlayProps {
  prompt: string;
  onCancel: () => void;
}

/**
 * Banner overlay shown while the canvas is in "click a card to target" mode.
 * Dimming and per-card click interception happen inside GameCardNode (Konva
 * primitives); this component is pure DOM chrome for the prompt + cancel UX.
 */
export function TargetCardOverlay({ prompt, onCancel }: TargetCardOverlayProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return (
    <div
      style={{
        position: 'fixed',
        top: 16,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 50,
        background: 'rgba(0, 0, 0, 0.85)',
        color: '#fff',
        padding: '10px 16px',
        borderRadius: 8,
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        fontSize: 14,
        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
        pointerEvents: 'auto',
      }}
    >
      <span>{prompt}</span>
      <span style={{ opacity: 0.6, fontSize: 12 }}>Esc to cancel</span>
      <button
        onClick={onCancel}
        style={{
          background: 'rgba(255, 255, 255, 0.15)',
          color: '#fff',
          border: 'none',
          padding: '4px 10px',
          borderRadius: 4,
          fontSize: 12,
          cursor: 'pointer',
        }}
      >
        Cancel
      </button>
    </div>
  );
}
