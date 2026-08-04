"use client";

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { RefreshCw, Play } from 'lucide-react';

export default function MatchingDashboard({ byMethod, byStatus }: {
  byMethod: Record<string, number>;
  byStatus: Record<string, number>;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(label: string, url: string) {
    setBusy(label);
    setError(null);
    try {
      const res = await fetch(url, { method: 'POST' });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `${label} failed (${res.status})`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : `${label} failed`);
    } finally {
      setBusy(null);
    }
  }

  const methods = Object.entries(byMethod).sort((a, b) => b[1] - a[1]);
  const needsReview = byStatus['needs_review'] ?? 0;
  const unmatched = byStatus['unmatched'] ?? 0;

  return (
    <section className="rounded-lg bg-muted/40 p-4 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">Matching</h2>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled={busy !== null}
            onClick={() => run('Sync', '/api/admin/sync-shopify')}>
            <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${busy === 'Sync' ? 'animate-spin' : ''}`} />
            {busy === 'Sync' ? 'Syncing…' : 'Sync products'}
          </Button>
          <Button size="sm" disabled={busy !== null}
            onClick={() => run('Matching', '/api/admin/run-matching')}>
            <Play className="mr-1.5 h-3.5 w-3.5" />
            {busy === 'Matching' ? 'Matching…' : 'Run matching'}
          </Button>
        </div>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-md bg-background p-3">
          <div className="text-2xl font-semibold tabular-nums">{needsReview}</div>
          <div className="text-xs text-muted-foreground">needs review</div>
        </div>
        <div className="rounded-md bg-background p-3">
          <div className="text-2xl font-semibold tabular-nums">{unmatched}</div>
          <div className="text-xs text-muted-foreground">unmatched</div>
        </div>
        <div className="rounded-md bg-background p-3 col-span-2">
          <div className="text-xs text-muted-foreground mb-1.5">by match method</div>
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            {methods.map(([m, n]) => (
              <span key={m} className="text-xs tabular-nums">
                <span className="text-muted-foreground">{m}</span> {n}
              </span>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
