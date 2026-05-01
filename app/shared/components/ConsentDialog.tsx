'use client';

interface ConsentDialogProps {
  requesterName: string;
  zoneName: string;
  requestType?: 'search' | 'reveal' | 'priority' | 'action';
  /** For requestType='action' — a human sentence fragment like "shuffle your deck" */
  actionDescription?: string;
  onAllow: () => void;
  onDeny: () => void;
}

export function ConsentDialog({ requesterName, zoneName, requestType = 'search', actionDescription, onAllow, onDeny }: ConsentDialogProps) {
  return (
    <div
      style={{
        position: 'absolute',
        top: '50%',
        left: '50%',
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
          padding: '16px 22px',
          display: 'flex',
          alignItems: 'center',
          gap: 18,
          boxShadow: '0 8px 32px rgba(0,0,0,0.7)',
        }}
      >
        <div style={{ fontSize: 15, color: 'var(--gf-text)', lineHeight: 1.4, maxWidth: 480 }}>
          {requestType === 'priority' ? (
            <><strong style={{ color: 'var(--gf-accent)' }}>{requesterName}</strong> is requesting <strong style={{ color: 'var(--gf-text-bright)' }}>action priority</strong></>
          ) : requestType === 'reveal' ? (
            <><strong style={{ color: 'var(--gf-accent)' }}>{requesterName}</strong> wants to reveal your <strong style={{ color: 'var(--gf-text-bright)' }}>hand</strong></>
          ) : requestType === 'action' ? (
            <><strong style={{ color: 'var(--gf-accent)' }}>{requesterName}</strong> wants to <strong style={{ color: 'var(--gf-text-bright)' }}>{actionDescription ?? 'perform an action on your deck'}</strong></>
          ) : (
            <><strong style={{ color: 'var(--gf-accent)' }}>{requesterName}</strong> wants to search your <strong style={{ color: 'var(--gf-text-bright)' }}>{zoneName}</strong></>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
          <button
            onClick={onAllow}
            style={{
              padding: '9px 18px',
              background: '#2d5a27',
              border: '1px solid #4a8a42',
              borderRadius: 6,
              color: '#c4e8bf',
              fontSize: 14,
              fontFamily: 'var(--font-cinzel), Georgia, serif',
              cursor: 'pointer',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = '#3a7332'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = '#2d5a27'; }}
          >
            {requestType === 'priority' ? 'Grant' : 'Allow'}
          </button>
          <button
            onClick={onDeny}
            style={{
              padding: '9px 18px',
              background: '#5a2727',
              border: '1px solid #8a4242',
              borderRadius: 6,
              color: '#e8bfbf',
              fontSize: 14,
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
