'use client';

import { useEffect, useRef, useState } from 'react';
import type { CountPromptRequest } from '../types/gameActions';

interface CountPromptDialogProps {
  req: CountPromptRequest;
  /** Screen-px X (relative to the positioned canvas container) to center on —
   *  the play mat's midline. Defaults to the container's own midline, which
   *  includes the sidebar piles and so sits right of the board. */
  centerX?: number;
}

export function CountPromptDialog({ req, centerX }: CountPromptDialogProps) {
  const [count, setCount] = useState(req.defaultCount);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') req.onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [req]);

  const max = req.maxCount ?? Infinity;
  const verb = req.confirmVerb ?? 'Draw';

  const confirm = () => {
    if (count < 1 || !Number.isFinite(count)) return;
    req.onConfirm(Math.min(max, Math.floor(count)));
  };

  return (
    <div
      style={{
        position: 'absolute',
        top: '50%',
        left: centerX ?? '50%',
        transform: 'translate(-50%, -50%)',
        zIndex: 900,
        pointerEvents: 'auto',
      }}
    >
      <div
        style={{
          background: 'var(--gf-bg)',
          border: '1px solid var(--gf-border)',
          borderRadius: 8,
          padding: '18px 22px',
          minWidth: 320,
          boxShadow: '0 8px 32px rgba(0,0,0,0.7)',
        }}
        onContextMenu={(e) => e.preventDefault()}
      >
        <div style={{ fontSize: 12, color: 'var(--gf-text-dim)', marginBottom: 4 }}>
          {req.cardName}
        </div>
        <div
          style={{
            fontSize: 15,
            color: 'var(--gf-text-bright)',
            fontFamily: 'var(--font-cinzel), Georgia, serif',
            marginBottom: 14,
          }}
        >
          {req.title}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          <button
            onClick={() => setCount((c) => Math.max(1, c - 1))}
            style={stepBtnStyle}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--gf-hover)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
            aria-label="Decrease"
          >
            −
          </button>
          <input
            ref={inputRef}
            type="number"
            min={1}
            max={Number.isFinite(max) ? max : undefined}
            value={Number.isFinite(count) ? count : ''}
            onChange={(e) => {
              const v = parseInt(e.target.value, 10);
              setCount(Number.isFinite(v) ? Math.min(max, v) : NaN);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') confirm();
            }}
            style={{
              flex: 1,
              padding: '8px 10px',
              background: 'rgba(0,0,0,0.35)',
              border: '1px solid var(--gf-border)',
              borderRadius: 6,
              color: 'var(--gf-text-bright)',
              fontSize: 18,
              textAlign: 'center',
              fontFamily: 'var(--font-cinzel), Georgia, serif',
            }}
          />
          <button
            onClick={() => setCount((c) => Math.min(max, Number.isFinite(c) ? c + 1 : 1))}
            style={stepBtnStyle}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--gf-hover)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
            aria-label="Increase"
          >
            +
          </button>
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button
            onClick={req.onCancel}
            style={cancelBtnStyle}
            onMouseEnter={(e) => { e.currentTarget.style.background = '#733232'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = '#5a2727'; }}
          >
            Cancel
          </button>
          <button
            onClick={confirm}
            disabled={!Number.isFinite(count) || count < 1}
            style={{
              ...confirmBtnStyle,
              opacity: !Number.isFinite(count) || count < 1 ? 0.5 : 1,
              cursor: !Number.isFinite(count) || count < 1 ? 'not-allowed' : 'pointer',
            }}
            onMouseEnter={(e) => {
              if (Number.isFinite(count) && count >= 1) e.currentTarget.style.background = '#3a7332';
            }}
            onMouseLeave={(e) => { e.currentTarget.style.background = '#2d5a27'; }}
          >
            {verb} {Number.isFinite(count) && count >= 1 ? Math.min(max, count) : ''}
          </button>
        </div>
      </div>
    </div>
  );
}

const stepBtnStyle: React.CSSProperties = {
  width: 36,
  height: 36,
  background: 'transparent',
  border: '1px solid var(--gf-border)',
  borderRadius: 6,
  color: 'var(--gf-text-bright)',
  fontSize: 20,
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

const confirmBtnStyle: React.CSSProperties = {
  padding: '9px 18px',
  background: '#2d5a27',
  border: '1px solid #4a8a42',
  borderRadius: 6,
  color: '#c4e8bf',
  fontSize: 14,
  fontFamily: 'var(--font-cinzel), Georgia, serif',
};

const cancelBtnStyle: React.CSSProperties = {
  padding: '9px 18px',
  background: '#5a2727',
  border: '1px solid #8a4242',
  borderRadius: 6,
  color: '#e8bfbf',
  fontSize: 14,
  fontFamily: 'var(--font-cinzel), Georgia, serif',
  cursor: 'pointer',
};
