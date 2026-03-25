'use client';

interface ConsentDialogProps {
  requesterName: string;
  zoneName: string;
  onAllow: () => void;
  onDeny: () => void;
}

export function ConsentDialog({ requesterName, zoneName, onAllow, onDeny }: ConsentDialogProps) {
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 800,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0,0,0,0.7)',
      }}
    >
      <div
        style={{
          background: 'var(--gf-bg)',
          border: '1px solid var(--gf-border)',
          borderRadius: 8,
          padding: '24px 32px',
          maxWidth: 360,
          textAlign: 'center',
          boxShadow: '0 12px 40px rgba(0,0,0,0.8)',
        }}
      >
        <div
          style={{
            fontFamily: 'var(--font-cinzel), Georgia, serif',
            fontSize: 16,
            color: 'var(--gf-text-bright)',
            marginBottom: 8,
            letterSpacing: '0.05em',
          }}
        >
          Zone Search Request
        </div>
        <div
          style={{
            fontSize: 14,
            color: 'var(--gf-text)',
            marginBottom: 20,
            lineHeight: 1.5,
          }}
        >
          <strong style={{ color: 'var(--gf-accent)' }}>{requesterName}</strong> wants to search your <strong style={{ color: 'var(--gf-text-bright)' }}>{zoneName}</strong>.
        </div>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
          <button
            onClick={onAllow}
            style={{
              padding: '8px 24px',
              background: '#2d5a27',
              border: '1px solid #4a8a42',
              borderRadius: 6,
              color: '#c4e8bf',
              fontSize: 13,
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
              padding: '8px 24px',
              background: '#5a2727',
              border: '1px solid #8a4242',
              borderRadius: 6,
              color: '#e8bfbf',
              fontSize: 13,
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
