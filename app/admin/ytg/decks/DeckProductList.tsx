"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { unlinkProduct } from "./actions";
import type { DeckProductRow } from "./actions";

export default function DeckProductList({ products }: { products: DeckProductRow[] }) {
  const [q, setQ] = useState("");
  const [unlinkArm, setUnlinkArm] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return products;
    return products.filter((p) => p.title.toLowerCase().includes(needle));
  }, [q, products]);

  const doUnlink = (productId: string) => {
    startTransition(async () => {
      const res = await unlinkProduct(productId);
      if (res.success === false) setError(res.error ?? "unlink failed");
      else { setError(""); router.refresh(); }
      setUnlinkArm(null);
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Deck products</h2>
          <p className="text-sm text-muted-foreground">
            Pull a product&apos;s contents into a public decklist — the deck becomes the
            source of truth for store inventory.
          </p>
        </div>
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by title…"
          className="sm:max-w-xs"
        />
      </div>

      {error && (
        <div className="px-4 py-2 rounded-md bg-destructive/10 text-destructive text-sm">{error}</div>
      )}

      <div className="rounded-lg bg-muted/30 divide-y divide-background overflow-hidden">
        {filtered.map((p) => (
          <div key={p.productId} className="flex items-center gap-3 px-3 py-2">
            {p.imageUrl ? (
              <img src={p.imageUrl} alt="" className="w-10 h-10 rounded object-cover shrink-0" />
            ) : (
              <div className="w-10 h-10 rounded bg-muted shrink-0" />
            )}
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium text-sm">{p.title}</div>
              <div className="flex flex-wrap items-center gap-2 mt-0.5 text-xs text-muted-foreground">
                <span className="px-1.5 py-0.5 rounded bg-muted">{p.productType}</span>
                {p.price != null && <span>${Number(p.price).toFixed(2)}</span>}
                <span
                  className={`px-1.5 py-0.5 rounded ${
                    p.inventory > 0
                      ? "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  {p.inventory} in stock
                </span>
                {p.status !== null && p.status !== "active" && (
                  <span className="px-1.5 py-0.5 rounded bg-muted">{p.status}</span>
                )}
              </div>
            </div>
            {p.linkedDeckId ? (
              <div className="flex items-center gap-2 shrink-0">
                <Link
                  className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
                  href={`/decklist/${p.linkedDeckId}`}
                >
                  View deck
                </Link>
                <Link className="text-sm hover:underline" href={`/admin/ytg/decks/${p.productId}`}>
                  Replace contents
                </Link>
                {unlinkArm === p.productId ? (
                  <Button size="sm" variant="destructive" disabled={pending} onClick={() => doUnlink(p.productId)}>
                    Confirm unlink
                  </Button>
                ) : (
                  <Button size="sm" variant="ghost" onClick={() => setUnlinkArm(p.productId)}>
                    Unlink
                  </Button>
                )}
              </div>
            ) : (
              <Link href={`/admin/ytg/decks/${p.productId}`} className="shrink-0">
                <Button size="sm">Pull contents</Button>
              </Link>
            )}
          </div>
        ))}
        {filtered.length === 0 && (
          <div className="px-3 py-8 text-center text-sm text-muted-foreground">
            No deck products match. Deck products appear here after a product sync
            (types: Contender/Challenger/Champion Deck).
          </div>
        )}
      </div>
    </div>
  );
}
