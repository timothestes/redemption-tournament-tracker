'use client';

interface SpectatorBarProps {
  code: string;
  spectatorCount: number;
}

export function SpectatorBar({ code, spectatorCount }: SpectatorBarProps) {
  return (
    <div className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between bg-background/90 backdrop-blur border-b border-border px-4 py-2 text-sm">
      <span className="font-medium text-foreground">
        Spectating Game{' '}
        <span className="font-mono tracking-wider text-primary">{code}</span>
      </span>
      <span className="text-muted-foreground">
        {spectatorCount} {spectatorCount === 1 ? 'spectator' : 'spectators'}
      </span>
    </div>
  );
}
