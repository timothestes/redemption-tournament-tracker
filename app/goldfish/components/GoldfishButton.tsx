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
        className="inline-flex items-center justify-center rounded-lg px-2.5 self-stretch border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
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
      className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors disabled:opacity-50"
    >
      {icon}
      {loading ? 'Loading...' : 'Practice'}
    </button>
  );
}
