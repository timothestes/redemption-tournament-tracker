"use client";

import { useState, useEffect } from "react";
import TopNav from "../../../components/top-nav";
import { useIsAdmin } from "../../../hooks/useIsAdmin";
import { useRouter } from "next/navigation";

interface ReviewItem {
  id: number;
  card_key: string;
  card_name: string;
  set_code: string;
  confidence: number | null;
  match_method: string | null;
  claude_reasoning: string | null;
  shopify_product_id: string | null;
  shopify_products: {
    id: string;
    title: string;
    handle: string;
    tags: string | null;
    price: number | null;
    inventory_quantity: number | null;
  } | null;
}

export default function PriceReviewPage() {
  const { isAdmin, loading: adminLoading } = useIsAdmin();
  const router = useRouter();
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState<Set<string>>(new Set());
  const [stats, setStats] = useState({ approved: 0, rejected: 0 });

  useEffect(() => {
    if (!adminLoading && !isAdmin) {
      router.push("/");
    }
  }, [isAdmin, adminLoading, router]);

  useEffect(() => {
    if (isAdmin) {
      loadReviewQueue();
    }
  }, [isAdmin]);

  async function loadReviewQueue() {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/review-queue");
      const data = await res.json();
      setItems(data.items ?? []);
    } catch {
      console.error("Failed to load review queue");
    }
    setLoading(false);
  }

  async function handleApprove(item: ReviewItem) {
    if (!item.shopify_product_id) return;
    setProcessing(prev => new Set(prev).add(item.card_key));

    try {
      const res = await fetch("/api/admin/approve-mapping", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          card_key: item.card_key,
          shopify_product_id: item.shopify_product_id,
        }),
      });
      if (res.ok) {
        setItems(prev => prev.filter(i => i.card_key !== item.card_key));
        setStats(prev => ({ ...prev, approved: prev.approved + 1 }));
      }
    } catch {
      console.error("Failed to approve");
    }
    setProcessing(prev => {
      const next = new Set(prev);
      next.delete(item.card_key);
      return next;
    });
  }

  async function handleReject(item: ReviewItem) {
    setProcessing(prev => new Set(prev).add(item.card_key));

    try {
      const res = await fetch("/api/admin/reject-mapping", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ card_key: item.card_key }),
      });
      if (res.ok) {
        setItems(prev => prev.filter(i => i.card_key !== item.card_key));
        setStats(prev => ({ ...prev, rejected: prev.rejected + 1 }));
      }
    } catch {
      console.error("Failed to reject");
    }
    setProcessing(prev => {
      const next = new Set(prev);
      next.delete(item.card_key);
      return next;
    });
  }

  if (adminLoading || !isAdmin) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
        <TopNav />
        <div className="p-8 text-center text-gray-500">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <TopNav />
      <div className="max-w-6xl mx-auto p-4 sm:p-6">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
            Price Match Review Queue
          </h1>
          <div className="flex items-center gap-4 text-sm">
            {stats.approved > 0 && (
              <span className="text-green-600 font-medium">
                {stats.approved} approved
              </span>
            )}
            {stats.rejected > 0 && (
              <span className="text-red-600 font-medium">
                {stats.rejected} rejected
              </span>
            )}
            <span className="text-gray-500">
              {items.length} remaining
            </span>
          </div>
        </div>

        {loading ? (
          <div className="text-center py-12 text-gray-500">Loading review queue...</div>
        ) : items.length === 0 ? (
          <div className="text-center py-12 text-gray-500">
            No items to review. All caught up!
          </div>
        ) : (
          <div className="space-y-3">
            {items.map((item) => (
              <div
                key={item.card_key}
                className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4"
              >
                <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                  {/* Card info */}
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-gray-900 dark:text-white truncate">
                      {item.card_name}
                    </div>
                    <div className="text-sm text-gray-500 dark:text-gray-400">
                      Set: {item.set_code} | Method: {item.match_method}
                      {item.confidence && ` | Confidence: ${(item.confidence * 100).toFixed(0)}%`}
                    </div>
                    {item.claude_reasoning && (
                      <div className="text-xs text-gray-400 dark:text-gray-500 mt-1 italic">
                        {item.claude_reasoning}
                      </div>
                    )}
                  </div>

                  {/* Suggested match */}
                  <div className="flex-1 min-w-0">
                    {item.shopify_products ? (
                      <div>
                        <div className="text-sm font-medium text-blue-600 dark:text-blue-400">
                          <a
                            href={`https://www.yourturngames.biz/products/${item.shopify_products.handle}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="hover:underline"
                          >
                            {item.shopify_products.title}
                          </a>
                        </div>
                        <div className="text-xs text-gray-500">
                          ${item.shopify_products.price?.toFixed(2)} | Stock: {item.shopify_products.inventory_quantity}
                        </div>
                      </div>
                    ) : (
                      <span className="text-sm text-gray-400">No match suggested</span>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button
                      onClick={() => handleApprove(item)}
                      disabled={processing.has(item.card_key) || !item.shopify_product_id}
                      className="px-3 py-1.5 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
                    >
                      Approve
                    </button>
                    <button
                      onClick={() => handleReject(item)}
                      disabled={processing.has(item.card_key)}
                      className="px-3 py-1.5 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
                    >
                      Reject
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
