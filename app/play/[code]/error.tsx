'use client';

import { useEffect } from 'react';

export default function GameError({
  error,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Game error:', error);
  }, [error]);

  // Detect SpacetimeDB SenderError for game-not-found
  const isGameNotFound =
    error.message?.includes('No waiting game found') ||
    error.message?.includes('SenderError');

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="rounded-lg border border-border bg-card p-8 text-center max-w-sm mx-4">
        {/* Visual anchor */}
        <div className="mb-4 flex justify-center">
          <div className="w-16 h-16 rounded-full bg-muted/50 flex items-center justify-center">
            {isGameNotFound ? (
              <svg className="w-8 h-8 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
              </svg>
            ) : (
              <svg className="w-8 h-8 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
              </svg>
            )}
          </div>
        </div>
        <p className="text-lg font-semibold font-cinzel mb-2">
          {isGameNotFound ? 'Game Not Found' : 'Something Went Wrong'}
        </p>
        <p className="text-sm text-muted-foreground">
          {isGameNotFound
            ? 'No waiting game was found with that code.'
            : (error.message || 'An unexpected error occurred.')}
        </p>
        {isGameNotFound && (
          <p className="text-xs text-muted-foreground/70 mt-1">
            The game may have ended, or the code may be wrong.
          </p>
        )}
        <a
          href="/play"
          className="mt-6 inline-block rounded-md border border-border px-5 py-2.5 text-sm font-medium hover:bg-muted transition-colors"
        >
          Back to Lobby
        </a>
      </div>
    </div>
  );
}
