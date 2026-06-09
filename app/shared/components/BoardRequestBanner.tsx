'use client';

import type { ReactNode } from 'react';
import { useToastKeyboardNav, toastFocusShadow } from './toastKeyboardNav';

interface BoardRequestBannerProps {
  /** The request description (may include <strong> emphasis). */
  message: ReactNode;
  /** Affirmative button label — "Approve", "Grant", etc. */
  affirmLabel: string;
  onAffirm: () => void;
  onDeny: () => void;
  /** Outer width cap (Three Nails uses a wider message). */
  maxWidth?: number;
}

/**
 * Center-of-board consent banner shared by the Three Nails reset, action
 * priority, and initiative requests. The affirmative button is the default
 * (Enter); Escape denies. ←/→ move the selection and the focused option is
 * highlighted.
 */
export function BoardRequestBanner({
  message,
  affirmLabel,
  onAffirm,
  onDeny,
  maxWidth,
}: BoardRequestBannerProps) {
  const { focusedIndex, setFocusedIndex } = useToastKeyboardNav({
    count: 2,
    defaultIndex: 0, // affirm
    onSelect: idx => (idx === 0 ? onAffirm() : onDeny()),
    onCancel: onDeny,
  });

  const affirmFocused = focusedIndex === 0;
  const denyFocused = focusedIndex === 1;

  return (
    <div
      style={{
        position: 'absolute',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        zIndex: 300,
        pointerEvents: 'auto',
      }}
    >
      <div
        style={{
          background: 'rgba(14, 10, 6, 0.95)',
          border: '1px solid rgba(196, 149, 90, 0.35)',
          borderRadius: 10,
          padding: '16px 24px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 12,
          boxShadow: '0 8px 40px rgba(0,0,0,0.7), 0 0 0 1px rgba(196, 149, 90, 0.08)',
          ...(maxWidth ? { maxWidth } : null),
        }}
      >
        <div
          style={{
            fontSize: 15,
            color: '#e8d5a3',
            fontFamily: 'var(--font-cinzel), Georgia, serif',
            letterSpacing: '0.06em',
            textAlign: 'center',
            lineHeight: 1.5,
          }}
        >
          {message}
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button
            onClick={onAffirm}
            onMouseEnter={() => setFocusedIndex(0)}
            style={{
              padding: '9px 20px',
              background: affirmFocused ? '#3a7332' : '#2d5a27',
              border: '1px solid #4a8a42',
              borderRadius: 6,
              color: '#c4e8bf',
              fontSize: 14,
              fontFamily: 'var(--font-cinzel), Georgia, serif',
              letterSpacing: '0.06em',
              cursor: 'pointer',
              boxShadow: affirmFocused ? toastFocusShadow('#6fbf63', 'rgba(74,138,66,0.55)') : 'none',
              transition: 'background 0.14s, box-shadow 0.14s',
            }}
          >
            {affirmLabel}
          </button>
          <button
            onClick={onDeny}
            onMouseEnter={() => setFocusedIndex(1)}
            style={{
              padding: '9px 20px',
              background: denyFocused ? '#733232' : '#5a2727',
              border: '1px solid #8a4242',
              borderRadius: 6,
              color: '#e8bfbf',
              fontSize: 14,
              fontFamily: 'var(--font-cinzel), Georgia, serif',
              letterSpacing: '0.06em',
              cursor: 'pointer',
              boxShadow: denyFocused ? toastFocusShadow('#c46a6a', 'rgba(138,66,66,0.55)') : 'none',
              transition: 'background 0.14s, box-shadow 0.14s',
            }}
          >
            Deny
          </button>
        </div>
      </div>
    </div>
  );
}
