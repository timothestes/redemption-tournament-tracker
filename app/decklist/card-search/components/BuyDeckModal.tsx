import React, { useState, useCallback, useEffect, useRef } from "react";
import { useIsAdmin } from "@/hooks/useIsAdmin";

/** Generic card item that both Deck and PublicDeck formats can provide */
export interface BuyDeckCard {
  card_name: string;
  card_key: string;
  quantity: number;
  isReserve: boolean;
}

interface MatchedCard {
  card_name: string;
  card_key: string;
  quantity: number;
  price: number;
  variant_id: string;
  original_card_name?: string;
  original_card_key?: string;
  original_price?: number;
  cheaper_alternative?: {
    card_name: string;
    price: number;
    source: string;
  };
}

interface UnmatchedCard {
  card_name: string;
  card_key: string;
  quantity: number;
  reason: 'no_match' | 'sold_out';
  debug?: string;
  cheaper_alternative?: {
    card_name: string;
    price: number;
    source: string;
  };
}

interface CartResult {
  cartUrl: string | null;
  matched: MatchedCard[];
  unmatched: UnmatchedCard[];
  matchedTotal: number;
  unmatchedTotal: number;
}

type BuyScope = "all" | "main" | "reserve";

type BuyMode = "exact" | "budget";

interface BuyDeckModalProps {
  cards: BuyDeckCard[];
  onClose: () => void;
  initialMode?: BuyMode;
}

export default function BuyDeckModal({ cards: allCards, onClose, initialMode }: BuyDeckModalProps) {
  const { isAdmin } = useIsAdmin();
  const [scope, setScope] = useState<BuyScope>("all");
  const [mode, setMode] = useState<BuyMode>(initialMode ?? "exact");
  const [result, setResult] = useState<CartResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;
  const [showUnavailable, setShowUnavailable] = useState(!isMobile);
  const [showEdit, setShowEdit] = useState(!isMobile);
  const [excludedKeys, setExcludedKeys] = useState<Set<string>>(new Set());

  // Lock body scroll when modal is open
  useEffect(() => {
    const original = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = original; };
  }, []);

  // Swipe-to-dismiss state for mobile bottom sheet
  const sheetRef = useRef<HTMLDivElement>(null);
  const [dragY, setDragY] = useState(0);
  const dragStartY = useRef<number | null>(null);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    dragStartY.current = e.touches[0].clientY;
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (dragStartY.current === null) return;
    const dy = e.touches[0].clientY - dragStartY.current;
    if (dy > 0) { // Only allow dragging down
      setDragY(dy);
    }
  }, []);

  const handleTouchEnd = useCallback(() => {
    if (dragY > 100) {
      onClose(); // Dismiss if dragged more than 100px
    } else {
      setDragY(0); // Snap back
    }
    dragStartY.current = null;
  }, [dragY, onClose]);

  const mainCards = allCards.filter(c => !c.isReserve);
  const reserveCards = allCards.filter(c => c.isReserve);
  const hasReserve = reserveCards.length > 0;

  const scopedCards = scope === "main" ? mainCards : scope === "reserve" ? reserveCards : allCards;

  const fetchCart = useCallback(async () => {
    setLoading(true);
    setError(null);
    setShowUnavailable(false);
    try {
      const cards = scopedCards.map(c => ({
        card_key: c.card_key,
        card_name: c.card_name,
        quantity: c.quantity,
      }));

      const res = await fetch("/api/ytg-cart", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cards, useBudget: mode === "budget" }),
      });

      if (!res.ok) throw new Error("Failed to build cart");
      const data: CartResult = await res.json();
      setResult(data);
    } catch {
      setError("Could not build cart. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [scopedCards, mode]);

  // Fetch on first render
  React.useEffect(() => {
    fetchCart();
  }, []);

  // Re-fetch when scope changes
  const handleScopeChange = (newScope: BuyScope) => {
    setScope(newScope);
    setResult(null);
    setExcludedKeys(new Set());
    setShowEdit(false);
  };

  React.useEffect(() => {
    if (!result && !loading) {
      fetchCart();
    }
  }, [scope]);

  const handleModeChange = (newMode: BuyMode) => {
    setMode(newMode);
    setResult(null);
    setExcludedKeys(new Set());
    setShowEdit(false);
  };

  React.useEffect(() => {
    if (!result && !loading) {
      fetchCart();
    }
  }, [mode]);

  // Derived: selected cards (matched minus excluded)
  const selectedMatched = result?.matched.filter(m => !excludedKeys.has(m.card_key)) ?? [];
  const selectedPrice = selectedMatched.reduce((sum, m) => sum + m.price * m.quantity, 0);
  const selectedCount = selectedMatched.reduce((sum, m) => sum + m.quantity, 0);
  // Build cart URL client-side from selected cards
  const selectedCartUrl = selectedMatched.length > 0
    ? `https://www.yourturngames.biz/cart/${selectedMatched.map(m => `${m.variant_id}:${m.quantity}`).join(',')}`
    : null;

  const soldOut = result?.unmatched.filter(c => c.reason === 'sold_out') ?? [];
  const noMatch = result?.unmatched.filter(c => c.reason === 'no_match') ?? [];

  const hasExclusions = excludedKeys.size > 0;

  const toggleCard = (cardKey: string) => {
    setExcludedKeys(prev => {
      const next = new Set(prev);
      if (next.has(cardKey)) next.delete(cardKey);
      else next.add(cardKey);
      return next;
    });
  };

  const selectAll = () => setExcludedKeys(new Set());
  const deselectAll = () => {
    if (!result) return;
    setExcludedKeys(new Set(result.matched.map(m => m.card_key)));
  };

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-[60] bg-black/50" onClick={onClose} />

      {/* Modal — bottom sheet on mobile, centered on desktop */}
      <div
        ref={sheetRef}
        className="fixed inset-x-0 bottom-0 z-[61] max-h-[85vh] flex flex-col bg-white dark:bg-gray-800 rounded-t-xl shadow-2xl border border-gray-200 dark:border-gray-700 md:inset-x-auto md:bottom-auto md:top-1/2 md:-translate-y-1/2 md:mx-auto md:max-w-md md:rounded-xl md:max-h-[80vh] md:inset-x-4 lg:inset-x-0"
        style={dragY > 0 ? { transform: `translateY(${dragY}px)`, transition: dragStartY.current !== null ? 'none' : 'transform 0.2s ease-out' } : undefined}
      >
        {/* Mobile drag handle — swipe down to dismiss */}
        <div
          className="flex justify-center pt-2 pb-0 md:hidden cursor-grab active:cursor-grabbing"
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          <div className="w-10 h-1 rounded-full bg-gray-300 dark:bg-gray-600" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-2">
            <img src="/sponsors/ytg-dark.png" alt="YTG" className="h-5 w-5 object-contain hidden dark:block" />
            <img src="/sponsors/ytg-light.png" alt="YTG" className="h-5 w-5 object-contain dark:hidden" />
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Buy on Your Turn Games</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-md text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Controls */}
        <div className="px-4 pt-3">
          {/* Exact / Cheapest toggle */}
          <div className="flex gap-1">
            {(["exact", "budget"] as BuyMode[]).map((m) => (
              <button
                key={m}
                onClick={() => handleModeChange(m)}
                className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                  mode === m
                    ? "bg-gray-900 dark:bg-white text-white dark:text-gray-900"
                    : "bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400"
                }`}
              >
                {m === "exact" ? "Exact Cards" : "Cheapest Versions"}
              </button>
            ))}
          </div>
        </div>

        {/* Body — scrollable */}
        <div className="px-4 py-3 overflow-y-auto flex-1 min-h-0">
          {loading && (
            <div className="flex items-center justify-center py-8 gap-2 text-sm text-gray-500 dark:text-gray-400">
              <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Checking live inventory...
            </div>
          )}

          {error && (
            <div className="py-6 text-center text-sm text-red-500 dark:text-red-400">{error}</div>
          )}

          {result && !loading && (
            <>
              {/* Summary stats */}
              <div className="flex items-baseline justify-between mb-3">
                <span className="text-sm text-gray-600 dark:text-gray-400">
                  {hasExclusions ? (
                    <>
                      <span className="font-semibold text-gray-900 dark:text-white">{selectedCount}</span>
                      {" of "}
                      <span className="font-semibold text-gray-900 dark:text-white">{result.matchedTotal}</span>
                      {" selected"}
                    </>
                  ) : (
                    <>
                      <span className="font-semibold text-gray-900 dark:text-white">{result.matchedTotal}</span>
                      {" of "}
                      <span className="font-semibold text-gray-900 dark:text-white">{result.matchedTotal + result.unmatchedTotal}</span>
                      {" cards in stock"}
                    </>
                  )}
                </span>
                {selectedPrice > 0 && (
                  <span className="text-sm font-semibold text-green-600 dark:text-green-400">
                    ${selectedPrice.toFixed(2)}
                  </span>
                )}
              </div>

              {/* Edit selection toggle */}
              {result.matched.length > 1 && (
                <button
                  onClick={() => setShowEdit(!showEdit)}
                  className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 mb-2 flex items-center gap-1"
                >
                  <svg className={`w-3 h-3 transition-transform ${showEdit ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                  {showEdit ? "Hide card list" : "Edit selection"}
                </button>
              )}

              {/* Editable card list */}
              {showEdit && (
                <div className="mb-3">
                  <label className="flex items-center gap-2 py-1.5 mb-1 cursor-pointer border-b border-gray-200 dark:border-gray-700">
                    <input
                      type="checkbox"
                      checked={excludedKeys.size === 0}
                      ref={(el) => { if (el) el.indeterminate = excludedKeys.size > 0 && excludedKeys.size < (result?.matched.length ?? 0); }}
                      onChange={() => excludedKeys.size === 0 ? deselectAll() : selectAll()}
                      className="h-3.5 w-3.5 rounded border-gray-300 dark:border-gray-600 text-green-600 flex-shrink-0 focus:outline-none focus:ring-0"
                    />
                    <span className="text-xs font-medium text-gray-600 dark:text-gray-400">
                      {excludedKeys.size === 0 ? 'Deselect all' : excludedKeys.size === result?.matched.length ? 'Select all' : `${selectedCount} of ${result?.matchedTotal} selected`}
                    </span>
                  </label>
                  <div className="-mx-1 px-1">
                    {result.matched.map((card, i) => {
                      const isSelected = !excludedKeys.has(card.card_key);
                      return (
                        <label
                          key={`${card.card_key}-${i}`}
                          className="flex items-center gap-2 py-1 cursor-pointer min-h-[32px]"
                        >
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleCard(card.card_key)}
                            className="h-3.5 w-3.5 rounded border-gray-300 dark:border-gray-600 text-green-600 flex-shrink-0 focus:outline-none focus:ring-0"
                          />
                          <span className={`text-xs flex-1 min-w-0 ${isSelected ? 'text-gray-900 dark:text-white' : 'text-gray-400 dark:text-gray-500 line-through'}`}>
                            <span className="block truncate">{card.card_name}</span>
                            {card.original_card_name && (
                              <span className={`block text-[10px] ${isSelected ? 'text-gray-400 dark:text-gray-500' : 'text-gray-300 dark:text-gray-600'}`}>
                                was {card.original_card_name}{card.original_price !== undefined ? ` (save $${(card.original_price - card.price).toFixed(2)} ea)` : ""}
                              </span>
                            )}
                            {card.cheaper_alternative && isSelected && (
                              <span className="block text-[10px] text-muted-foreground">
                                Cheaper from {card.cheaper_alternative.source}: ${card.cheaper_alternative.price.toFixed(2)}
                              </span>
                            )}
                          </span>
                          {card.quantity > 1 && (
                            <span className={`text-xs flex-shrink-0 ${isSelected ? 'text-gray-500 dark:text-gray-400' : 'text-gray-300 dark:text-gray-600'}`}>
                              x{card.quantity}
                            </span>
                          )}
                          <span className={`text-xs flex-shrink-0 tabular-nums ${isSelected ? 'text-gray-500 dark:text-gray-400' : 'text-gray-300 dark:text-gray-600'}`}>
                            ${(card.price * card.quantity).toFixed(2)}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Unavailable cards */}
              {result.unmatched.length > 0 && (
                <div className="mb-3">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setShowUnavailable(!showUnavailable)}
                      className="text-xs font-medium text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 flex items-center gap-1"
                    >
                      <svg className={`w-3 h-3 transition-transform ${showUnavailable ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                      {result.unmatched.length} card{result.unmatched.length !== 1 ? "s" : ""} unavailable
                    </button>
                    {showUnavailable && isAdmin && (
                      <button
                        onClick={() => {
                          const lines = result.unmatched.map(c => {
                            const parts = [c.card_name];
                            if (c.quantity > 1) parts[0] += ` x${c.quantity}`;
                            parts.push(`  reason: ${c.reason}`);
                            if (c.debug) parts.push(`  debug: ${c.debug}`);
                            if (c.cheaper_alternative) parts.push(`  alt: ${c.cheaper_alternative.source} $${c.cheaper_alternative.price.toFixed(2)}`);
                            return parts.join('\n');
                          });
                          navigator.clipboard.writeText(lines.join('\n\n'));
                        }}
                        className="text-[10px] text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 underline"
                      >
                        Copy debug
                      </button>
                    )}
                  </div>
                  {showUnavailable && (
                    <div className="mt-1.5 max-h-40 overflow-y-auto space-y-0.5">
                      {/* Sold out cards */}
                      {soldOut.length > 0 && (
                        <>
                          <div className="text-[10px] font-semibold text-red-500 dark:text-red-400 uppercase tracking-wide pt-1">
                            Sold out on YTG ({soldOut.length})
                          </div>
                          {soldOut.map((card, i) => (
                            <div key={`so-${i}`} className="py-0.5 text-xs text-red-500 dark:text-red-400">
                              <div className="flex items-center justify-between">
                                <span className="truncate">{card.card_name}</span>
                                {card.quantity > 1 && <span className="ml-2 flex-shrink-0">x{card.quantity}</span>}
                              </div>
                              {isAdmin && card.debug && (
                                <div className="text-[10px] text-gray-500 dark:text-gray-500 mt-0.5">{card.debug}</div>
                              )}
                              {card.cheaper_alternative && (
                                <div className="text-[10px] text-muted-foreground mt-0.5">
                                  Available from {card.cheaper_alternative.source} for ${card.cheaper_alternative.price.toFixed(2)}
                                </div>
                              )}
                            </div>
                          ))}
                        </>
                      )}
                      {/* No match cards */}
                      {noMatch.length > 0 && (
                        <>
                          <div className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide pt-1.5">
                            Not listed on YTG ({noMatch.length})
                          </div>
                          {noMatch.map((card, i) => (
                            <div key={`nm-${i}`} className="py-0.5 text-xs text-gray-500 dark:text-gray-400">
                              <div className="flex items-center justify-between">
                                <span className="truncate">{card.card_name}</span>
                                {card.quantity > 1 && <span className="ml-2 flex-shrink-0">x{card.quantity}</span>}
                              </div>
                              {isAdmin && card.debug && (
                                <div className="text-[10px] text-gray-500 dark:text-gray-500 mt-0.5">{card.debug}</div>
                              )}
                              {card.cheaper_alternative && (
                                <div className="text-[10px] text-muted-foreground mt-0.5">
                                  Available from {card.cheaper_alternative.source} for ${card.cheaper_alternative.price.toFixed(2)}
                                </div>
                              )}
                            </div>
                          ))}
                        </>
                      )}
                    </div>
                  )}
                </div>
              )}

            </>
          )}
        </div>

        {/* Sticky footer — cart warning + CTA */}
        {result && !loading && (
          <div className="px-4 py-3 border-t border-gray-200 dark:border-gray-700 flex-shrink-0">
            <p className="text-[11px] text-gray-400 dark:text-gray-500 mb-2">
              This will replace your current YTG cart.
            </p>
            {selectedCartUrl ? (
              <a
                href={selectedCartUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 w-full py-2.5 rounded-lg bg-green-600 hover:bg-green-700 text-white text-sm font-semibold transition-colors"
                onClick={onClose}
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 100 4 2 2 0 000-4z" />
                </svg>
                Open YTG Cart{hasExclusions ? ` (${selectedCount})` : ''}
              </a>
            ) : (
              <div className="text-center py-2 text-sm text-gray-500 dark:text-gray-400">
                {hasExclusions ? "No cards selected" : "No cards currently in stock on YTG"}
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}
