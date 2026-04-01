'use client';

interface ConsentDialogProps {
  requesterName: string;
  zoneName: string;
  requestType?: 'search' | 'reveal';
  onAllow: () => void;
  onDeny: () => void;
}

export function ConsentDialog({ requesterName, zoneName, requestType = 'search', onAllow, onDeny }: ConsentDialogProps) {
  return (
    <div
      style={{
        position: 'fixed',
        top: 12,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 900,
        pointerEvents: 'auto',
      }}
    >
      <div
        style={{
          background: 'var(--gf-bg)',
          border: '1px solid var(--gf-border)',
          borderRadius: 8,
          padding: '12px 20px',
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          boxShadow: '0 8px 32px rgba(0,0,0,0.7)',
        }}
      >
        <div style={{ fontSize: 13, color: 'var(--gf-text)', lineHeight: 1.4 }}>
          {requestType === 'reveal' ? (
            <><strong style={{ color: 'var(--gf-accent)' }}>{requesterName}</strong> wants to reveal your <strong style={{ color: 'var(--gf-text-bright)' }}>hand</strong></>
          ) : (
            <><strong style={{ color: 'var(--gf-accent)' }}>{requesterName}</strong> wants to search your <strong style={{ color: 'var(--gf-text-bright)' }}>{zoneName}</strong></>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
          <button
            onClick={onAllow}
            style={{
              padding: '6px 16px',
              background: '#2d5a27',
              border: '1px solid #4a8a42',
              borderRadius: 6,
              color: '#c4e8bf',
              fontSize: 12,
              fontFamily: 'var(--font-cinzel), Georgia, serif',
              cursor: 'pointer',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = '#3a7332'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = '#2d5a27'; }}
          >
            Allow
          </button>
          <button
            onClick={onDeny}
            style={{
              padding: '6px 16px',
              background: '#5a2727',
              border: '1px solid #8a4242',
              borderRadius: 6,
              color: '#e8bfbf',
              fontSize: 12,
              fontFamily: 'var(--font-cinzel), Georgia, serif',
              cursor: 'pointer',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = '#733232'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = '#5a2727'; }}
          >
            Deny
          </button>
        </div>
      </div>
    </div>
  );
}
