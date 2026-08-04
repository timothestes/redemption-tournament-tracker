"use client";

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { CheckCircle2 } from 'lucide-react';
import { findCard } from '@/lib/cards/lookup';
import { getCardImageUrl } from '@/app/shared/utils/cardImageUrl';
import { stripHtmlToText } from '@/lib/pricing/abilityText';
import { searchSingleProducts, clearStaleIdentity } from '../actions';

interface QueueProduct {
  id: string; title: string; handle: string; tags: string | null;
  price: number | null; inventory_quantity: number | null;
  body_html: string | null; sku: string | null;
}
interface QueueItem {
  card_key: string; card_name: string; set_code: string;
  confidence: number | null; match_method: string | null;
  shopify_product_id: string | null;
  shopify_products: QueueProduct | null;
}
type SearchHit = { id: string; title: string; handle: string; price: number | null; tags: string | null; sku: string | null };

function parseCardKey(cardKey: string): { name: string; set: string; imgFile: string } {
  const [name, set, imgFile] = cardKey.split('|');
  return { name: name ?? '', set: set ?? '', imgFile: imgFile ?? '' };
}

export default function ReviewQueue() {
  const [items, setItems] = useState<QueueItem[] | null>(null);
  const [total, setTotal] = useState(0);
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch('/api/admin/review-queue')
      .then(async res => {
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? `review-queue failed (${res.status})`);
        setItems(body.items ?? []);
        setTotal((body.items ?? []).length);
      })
      .catch(err => setError(err instanceof Error ? err.message : 'Failed to load queue'));
  }, []);

  const current = items && items.length > 0 ? items[Math.min(index, items.length - 1)] : null;

  const removeCurrent = useCallback(() => {
    if (!items || !current) return;
    const next = items.filter(i => i.card_key !== current.card_key);
    setItems(next);
    setIndex(i => Math.min(i, Math.max(0, next.length - 1)));
    setSearchOpen(false); setQuery(''); setHits([]);
  }, [items, current]);

  const approve = useCallback(async (productId: string) => {
    if (!current || busy) return;
    setBusy(true); setError(null);
    const oldProductId = current.shopify_product_id;
    try {
      const res = await fetch('/api/admin/approve-mapping', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ card_key: current.card_key, shopify_product_id: productId }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? 'Approve failed');
      // Re-mapping hygiene: if the card moved OFF a product that carries this
      // card's SKU/rtt_card_key, clear the stale identity so duplicate SKUs
      // are never born.
      if (oldProductId !== null && oldProductId !== productId) {
        await clearStaleIdentity(oldProductId, current.card_key);
      }
      removeCurrent();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Approve failed');
    } finally {
      setBusy(false);
    }
  }, [current, busy, removeCurrent]);

  const reject = useCallback(async () => {
    if (!current || busy) return;
    setBusy(true); setError(null);
    try {
      const res = await fetch('/api/admin/reject-mapping', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ card_key: current.card_key }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? 'Reject failed');
      removeCurrent();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reject failed');
    } finally {
      setBusy(false);
    }
  }, [current, busy, removeCurrent]);

  // Keyboard: A approve, R reject, / focus search, ←/→ navigate
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || e.metaKey || e.ctrlKey || e.altKey) return;
      if (!current) return;
      if (e.key === 'a' || e.key === 'A') {
        if (current.shopify_products) { e.preventDefault(); approve(current.shopify_products.id); }
      } else if (e.key === 'r' || e.key === 'R') {
        e.preventDefault(); reject();
      } else if (e.key === '/') {
        e.preventDefault(); setSearchOpen(true); setTimeout(() => searchRef.current?.focus(), 0);
      } else if (e.key === 'ArrowRight' && items) {
        e.preventDefault(); setIndex(i => Math.min(i + 1, items.length - 1));
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault(); setIndex(i => Math.max(i - 1, 0));
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [current, items, approve, reject]);

  useEffect(() => {
    if (!searchOpen || query.trim().length < 2) { setHits([]); return; }
    const t = setTimeout(() => {
      searchSingleProducts(query).then(setHits).catch(() => setHits([]));
    }, 250);
    return () => clearTimeout(t);
  }, [query, searchOpen]);

  if (error && items === null) return <section className="rounded-lg bg-muted/40 p-4 text-sm text-destructive">{error}</section>;
  if (items === null) return <section className="rounded-lg bg-muted/40 p-4 text-sm text-muted-foreground">Loading review queue…</section>;

  if (items.length === 0) {
    return (
      <section className="rounded-lg bg-muted/40 p-10 flex flex-col items-center gap-2 text-center">
        <CheckCircle2 className="h-8 w-8 text-green-600 dark:text-green-500" />
        <p className="font-semibold">Review queue clear</p>
        <p className="text-sm text-muted-foreground">
          {total > 0 ? `All ${total} mappings reviewed. Nice work.` : 'Nothing needs review right now.'}
        </p>
      </section>
    );
  }

  const item = current!;
  const card = parseCardKey(item.card_key);
  const cardData = findCard(card.name, card.set, card.imgFile);
  const product = item.shopify_products;
  const done = total - items.length;

  return (
    <section className="rounded-lg bg-muted/40 p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Review queue</h2>
        <span className="text-sm tabular-nums text-muted-foreground">{Math.min(done + 1, total)} of {total}</span>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="grid gap-4 md:grid-cols-2">
        {/* Card side */}
        <div className="rounded-md bg-background p-3 space-y-2">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">Card</div>
          <div className="flex gap-3">
            {card.imgFile && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={getCardImageUrl(card.imgFile)} alt={card.name} className="h-40 w-auto rounded-sm" />
            )}
            <div className="min-w-0 space-y-1">
              <p className="font-medium">{card.name}</p>
              <p className="text-xs text-muted-foreground">{card.set}{cardData ? ` · ${cardData.officialSet}` : ''}</p>
              {cardData && cardData.specialAbility && (
                <p className="text-xs leading-relaxed">{cardData.specialAbility}</p>
              )}
            </div>
          </div>
        </div>

        {/* Proposed product side */}
        <div className="rounded-md bg-background p-3 space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Proposed product</div>
            <div className="flex gap-1.5">
              <Badge variant="secondary">{item.match_method ?? 'unknown'}</Badge>
              <Badge variant="outline">{((item.confidence ?? 0) * 100).toFixed(0)}%</Badge>
            </div>
          </div>
          {product ? (
            <div className="space-y-1.5">
              <p className="font-medium">{product.title}</p>
              <p className="text-sm tabular-nums">${product.price ?? '—'} · stock {product.inventory_quantity ?? '—'}{product.sku ? ` · SKU ${product.sku}` : ''}</p>
              {product.tags && (
                <div className="flex flex-wrap gap-1">
                  {product.tags.split(',').slice(0, 8).map(t => (
                    <span key={t} className="rounded bg-muted px-1.5 py-0.5 text-[11px]">{t.trim()}</span>
                  ))}
                </div>
              )}
              {product.body_html && (
                <p className="text-xs leading-relaxed text-muted-foreground">{stripHtmlToText(product.body_html)}</p>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No product attached — use Pick different.</p>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={busy || !product} onClick={() => product && approve(product.id)}>
          Approve <kbd className="ml-1.5 text-[10px] opacity-70">A</kbd>
        </Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={reject}>
          Reject <kbd className="ml-1.5 text-[10px] opacity-70">R</kbd>
        </Button>
        <Button size="sm" variant="outline" disabled={busy}
          onClick={() => { setSearchOpen(v => !v); setTimeout(() => searchRef.current?.focus(), 0); }}>
          Pick different <kbd className="ml-1.5 text-[10px] opacity-70">/</kbd>
        </Button>
        <span className="ml-auto text-xs text-muted-foreground">←/→ navigate</span>
      </div>

      {searchOpen && (
        <div className="rounded-md bg-background p-3 space-y-2">
          <Input ref={searchRef} value={query} placeholder="Search Single products by title…"
            onChange={e => setQuery(e.target.value)} />
          <ul className="max-h-64 overflow-y-auto divide-y-0">
            {hits.map(h => (
              <li key={h.id}>
                <button type="button" disabled={busy}
                  className="w-full rounded px-2 py-1.5 text-left text-sm hover:bg-muted"
                  onClick={() => approve(h.id)}>
                  <span className="font-medium">{h.title}</span>
                  <span className="ml-2 text-xs text-muted-foreground tabular-nums">${h.price ?? '—'}{h.sku ? ` · ${h.sku}` : ''}</span>
                </button>
              </li>
            ))}
            {query.trim().length >= 2 && hits.length === 0 && (
              <li className="px-2 py-1.5 text-xs text-muted-foreground">No Single products match.</li>
            )}
          </ul>
        </div>
      )}
    </section>
  );
}
