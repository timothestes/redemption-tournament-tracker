'use client';

import { useState } from 'react';

interface DebugOverlayProps {
  text: string;
  tone?: 'amber' | 'muted';
}

export function DebugOverlay({ text, tone = 'amber' }: DebugOverlayProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    });
  };

  const textColor = tone === 'amber' ? 'text-amber-200/30' : 'text-muted-foreground/50';
  const hoverColor = tone === 'amber' ? 'hover:text-amber-200/60' : 'hover:text-foreground/70';

  return (
    <div className={`fixed bottom-2 right-3 z-50 font-mono text-[10px] ${textColor} flex items-center gap-2 select-none`}>
      <span className="pointer-events-none">{text}</span>
      <button
        type="button"
        onClick={handleCopy}
        title="Copy debug info"
        className={`p-0.5 rounded transition-colors ${hoverColor}`}
      >
        {copied ? (
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
          </svg>
        ) : (
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
            <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
          </svg>
        )}
      </button>
    </div>
  );
}
