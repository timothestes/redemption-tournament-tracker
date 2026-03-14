import React, { useState, useCallback } from "react";
import { Deck } from "../types/deck";

interface MatchedCard {
  card_name: string;
  card_key: string;
  quantity: number;
  price: number;
}

interface UnmatchedCard {
  card_name: string;
  card_key: string;
  quantity: number;
  reason: 'no_match' | 'sold_out';
}

interface CartResult {
  cartUrl: string | null;
  matched: MatchedCard[];
  unmatched: UnmatchedCard[];
  matchedTotal: number;
  unmatchedTotal: number;
}

type BuyScope = "all" | "main" | "reserve";

interface BuyDeckModalProps {
  deck: Deck;
  onClose: () => void;
}

export default function BuyDeckModal({ deck, onClose }: BuyDeckModalProps) {
  const [scope, setScope] = useState<BuyScope>("all");
  const [result, setResult] = useState<CartResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showUnavailable, setShowUnavailable] = useState(false);

  const mainCards = deck.cards.filter(dc => !dc.isReserve);
  const reserveCards = deck.cards.filter(dc => dc.isReserve);
  const hasReserve = reserveCards.length > 0;

  const scopedCards = scope === "main" ? mainCards : scope === "reserve" ? reserveCards : deck.cards;

  const fetchCart = useCallback(async () => {
    setLoading(true);
    setError(null);
    setShowUnavailable(false);
    try {
      const cards = scopedCards.map(dc => ({
        card_key: `${dc.card.name}|${dc.card.set}|${dc.card.imgFile}`,
        card_name: dc.card.name,
        quantity: dc.quantity,
      }));

      const res = await fetch("/api/ytg-cart", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cards }),
      });

      if (!res.ok) throw new Error("Failed to build cart");
      const data: CartResult = await res.json();
      setResult(data);
    } catch {
      setError("Could not build cart. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [scopedCards]);

  // Fetch on first render
  React.useEffect(() => {
    fetchCart();
  }, []);

  // Re-fetch when scope changes
  const handleScopeChange = (newScope: BuyScope) => {
    setScope(newScope);
    setResult(null);
  };

  React.useEffect(() => {
    if (!result && !loading) {
      fetchCart();
    }
  }, [scope]);

  const matchedPrice = result?.matched.reduce((sum, m) => sum + m.price * m.quantity, 0) ?? 0;
  const soldOut = result?.unmatched.filter(c => c.reason === 'sold_out') ?? [];
  const noMatch = result?.unmatched.filter(c => c.reason === 'no_match') ?? [];

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-[60] bg-black/50" onClick={onClose} />

      {/* Modal */}
      <div className="fixed inset-x-4 top-1/2 -translate-y-1/2 z-[61] mx-auto max-w-md bg-white dark:bg-gray-800 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-700 overflow-hidden md:inset-x-auto md:w-full">
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

        {/* Scope selector */}
        {hasReserve && (
          <div className="px-4 pt-3 flex gap-1">
            {(["all", "main", "reserve"] as BuyScope[]).map((s) => (
              <button
                key={s}
                onClick={() => handleScopeChange(s)}
                className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                  scope === s
                    ? "bg-gray-900 dark:bg-white text-white dark:text-gray-900"
                    : "bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400"
                }`}
              >
                {s === "all" ? "All Cards" : s === "main" ? "Main Deck" : "Reserve"}
              </button>
            ))}
          </div>
        )}

        {/* Body */}
        <div className="px-4 py-3">
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
                  <span className="font-semibold text-gray-900 dark:text-white">{result.matchedTotal}</span>
                  {" of "}
                  <span className="font-semibold text-gray-900 dark:text-white">{result.matchedTotal + result.unmatchedTotal}</span>
                  {" cards in stock"}
                </span>
                {matchedPrice > 0 && (
                  <span className="text-sm font-semibold text-green-600 dark:text-green-400">
                    ${matchedPrice.toFixed(2)}
                  </span>
                )}
              </div>

              {/* Unavailable cards */}
              {result.unmatched.length > 0 && (
                <div className="mb-3">
                  <button
                    onClick={() => setShowUnavailable(!showUnavailable)}
                    className="text-xs font-medium text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 flex items-center gap-1"
                  >
                    <svg className={`w-3 h-3 transition-transform ${showUnavailable ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                    {result.unmatched.length} card{result.unmatched.length !== 1 ? "s" : ""} unavailable
                  </button>
                  {showUnavailable && (
                    <div className="mt-1.5 max-h-40 overflow-y-auto space-y-0.5">
                      {/* Sold out cards */}
                      {soldOut.length > 0 && (
                        <>
                          {noMatch.length > 0 && (
                            <div className="text-[10px] font-semibold text-red-500 dark:text-red-400 uppercase tracking-wide pt-1">Sold Out</div>
                          )}
                          {soldOut.map((card, i) => (
                            <div key={`so-${i}`} className="flex items-center justify-between py-0.5 text-xs text-red-500 dark:text-red-400">
                              <span className="truncate">{card.card_name}</span>
                              {card.quantity > 1 && <span className="ml-2 flex-shrink-0">x{card.quantity}</span>}
                            </div>
                          ))}
                        </>
                      )}
                      {/* No match cards */}
                      {noMatch.length > 0 && (
                        <>
                          {soldOut.length > 0 && (
                            <div className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide pt-1.5">Not Listed</div>
                          )}
                          {noMatch.map((card, i) => (
                            <div key={`nm-${i}`} className="flex items-center justify-between py-0.5 text-xs text-gray-500 dark:text-gray-400">
                              <span className="truncate">{card.card_name}</span>
                              {card.quantity > 1 && <span className="ml-2 flex-shrink-0">x{card.quantity}</span>}
                            </div>
                          ))}
                        </>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Cart warning */}
              <p className="text-[11px] text-gray-400 dark:text-gray-500 mb-3">
                This will replace your current YTG cart.
              </p>

              {/* Open cart button */}
              {result.cartUrl ? (
                <a
                  href={result.cartUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center gap-2 w-full py-2.5 rounded-lg bg-green-600 hover:bg-green-700 text-white text-sm font-semibold transition-colors"
                  onClick={onClose}
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 100 4 2 2 0 000-4z" />
                  </svg>
                  Open YTG Cart
                </a>
              ) : (
                <div className="text-center py-2 text-sm text-gray-500 dark:text-gray-400">
                  No cards currently in stock on YTG
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}
