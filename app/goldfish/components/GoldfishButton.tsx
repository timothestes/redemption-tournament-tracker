'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Play, Loader2 } from 'lucide-react';

interface GoldfishButtonProps {
  deckId?: string;
  deckName?: string;
  format?: string;
  iconOnly?: boolean;
}

export function GoldfishButton({ deckId, deckName, format, iconOnly = false }: GoldfishButtonProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  if (!deckId) return null;

  const href = `/goldfish/${deckId}${format ? `?format=${encodeURIComponent(format)}` : ''}`;

  const handleClick = () => {
    setLoading(true);
    router.push(href);
  };

  const icon = loading
    ? <Loader2 size={14} className="animate-spin" />
    : <Play size={14} fill="currentColor" />;

  if (iconOnly) {
    return (
      <button
        onClick={handleClick}
        disabled={loading}
        title="Practice this deck"
        className="inline-flex items-center justify-center rounded px-2 py-1.5 text-white bg-green-700 hover:bg-green-800 transition-colors disabled:opacity-70"
      >
        {icon}
      </button>
    );
  }

  return (
    <button
      onClick={handleClick}
      disabled={loading}
      title="Practice this deck"
      className="inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-sm font-medium text-white bg-green-700 hover:bg-green-800 transition-colors disabled:opacity-70"
    >
      {icon}
      {loading ? 'Loading...' : 'Practice'}
    </button>
  );
}
