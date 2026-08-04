"use client";

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { planSkuBackfill, executeSkuBackfill, type BackfillExecRow } from '../actions';
import type { BackfillRow, BackfillSkip } from '@/lib/shopify/skuBackfill';

type Plan = { toWrite: BackfillRow[]; skippedPermanent: BackfillSkip[]; blocked: BackfillSkip[]; count: number };
const CHUNK = 40; // matches aliasBatch's default per-document cost-cap sizing

export default function BackfillPanel() {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [planning, setPlanning] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [done, setDone] = useState(0);
  const [failures, setFailures] = useState<BackfillExecRow[]>([]);
  const [succeeded, setSucceeded] = useState(0);
  const [error, setError] = useState<string | null>(null);

  async function doPlan() {
    setPlanning(true); setError(null); setFailures([]); setSucceeded(0); setDone(0);
    try { setPlan(await planSkuBackfill()); }
    catch (err) { setError(err instanceof Error ? err.message : 'Plan failed'); }
    finally { setPlanning(false); }
  }

  async function execute(rows: BackfillRow[]) {
    setExecuting(true); setError(null); setDone(0); setFailures([]);
    let ok = 0;
    const failed: BackfillExecRow[] = [];
    try {
      for (let i = 0; i < rows.length; i += CHUNK) {
        const results = await executeSkuBackfill(rows.slice(i, i + CHUNK));
        for (const r of results) {
          if (r.variantOk === true && r.metafieldOk === true) ok++;
          else failed.push(r);
        }
        setDone(Math.min(i + CHUNK, rows.length));
        setSucceeded(ok);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Execute failed');
    } finally {
      setFailures(failed);
      setExecuting(false);
    }
  }

  return (
    <section className="rounded-lg bg-muted/40 p-4 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">SKU backfill</h2>
          <p className="text-xs text-muted-foreground">
            Writes cardSku + rtt_card_key onto confirmed-mapped products missing a SKU. One-time; pass 0 self-matches afterward.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={doPlan} disabled={planning || executing}>
          {planning ? 'Planning…' : 'Plan SKU backfill'}
        </Button>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}

      {plan && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-4 text-sm">
            <span><span className="font-semibold tabular-nums">{plan.count}</span> products to write</span>
            <span className="text-muted-foreground">
              {plan.skippedPermanent.length} non-primary mappings skipped — permanent by design
            </span>
            {plan.blocked.length > 0 && (
              <span className="text-amber-600 dark:text-amber-400">{plan.blocked.length} blocked (fix + re-plan)</span>
            )}
          </div>
          {plan.toWrite.length > 0 && (
            <div className="overflow-x-auto rounded-md bg-background">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-muted-foreground">
                    <th className="p-2">SKU</th><th className="p-2">Card key</th><th className="p-2">Product</th>
                  </tr>
                </thead>
                <tbody>
                  {plan.toWrite.slice(0, 20).map(r => (
                    <tr key={r.productId} className="odd:bg-muted/30">
                      <td className="p-2 font-mono">{r.sku}</td>
                      <td className="p-2">{r.cardKey}</td>
                      <td className="p-2 tabular-nums">{r.productId}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {plan.toWrite.length > 20 && (
                <p className="p-2 text-xs text-muted-foreground">…and {plan.toWrite.length - 20} more</p>
              )}
            </div>
          )}
          {plan.blocked.length > 0 && (
            <ul className="text-xs text-muted-foreground space-y-0.5">
              {plan.blocked.slice(0, 10).map(b => (
                <li key={`${b.productId}-${b.cardKey}`}>{b.cardKey}: {b.reason}</li>
              ))}
            </ul>
          )}
          <div className="flex items-center gap-3">
            <Button size="sm" disabled={executing || plan.toWrite.length === 0}
              onClick={() => execute(plan.toWrite)}>
              {executing ? `Writing ${done}/${plan.toWrite.length}…` : `Execute (${plan.toWrite.length})`}
            </Button>
            {(succeeded > 0 || failures.length > 0) && !executing && (
              <span className="text-sm tabular-nums">
                {succeeded} ok{failures.length > 0 ? `, ${failures.length} failed` : ''}
              </span>
            )}
            {failures.length > 0 && !executing && (
              <Button variant="outline" size="sm" onClick={() => execute(failures)}>
                Retry {failures.length} failed
              </Button>
            )}
          </div>
          {failures.length > 0 && (
            <ul className="text-xs text-destructive space-y-0.5">
              {failures.slice(0, 15).map(f => <li key={f.productId}>{f.sku}: {f.error}</li>)}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
