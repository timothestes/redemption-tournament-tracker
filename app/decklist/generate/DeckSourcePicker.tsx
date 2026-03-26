"use client";

import { useEffect, useState, useCallback } from "react";
import { loadUserDecksAction, loadDeckByIdAction, DeckData, DeckCardData } from "../actions";
import { createClient } from "@/utils/supabase/client";

/**
 * Convert DeckCardData[] from the database into Lackey-format text.
 */
function deckCardsToLackeyText(cards: DeckCardData[]): string {
  const main = cards
    .filter((c) => !c.is_reserve)
    .sort((a, b) => a.card_name.localeCompare(b.card_name));
  const reserve = cards
    .filter((c) => c.is_reserve)
    .sort((a, b) => a.card_name.localeCompare(b.card_name));

  const lines: string[] = [];
  for (const card of main) {
    lines.push(`${card.quantity}\t${card.card_name}`);
  }
  if (reserve.length > 0) {
    lines.push("");
    lines.push("Reserve:");
    for (const card of reserve) {
      lines.push(`${card.quantity}\t${card.card_name}`);
    }
  }
  return lines.join("\n");
}

/** Map deck format string to the generate page's deckType value */
function formatToDeckType(format?: string): string | null {
  if (!format) return null;
  const fmt = format.toLowerCase();
  if (fmt.includes("paragon")) return "paragon";
  if (fmt.includes("type 2") || fmt === "t2") return "type_2";
  if (fmt.includes("type 1") || fmt === "t1") return "type_1";
  return null;
}

function formatDeckType(format?: string): string {
  if (!format) return "T1";
  const fmt = format.toLowerCase();
  if (fmt.includes("paragon")) return "Paragon";
  if (fmt.includes("type 2") || fmt === "t2") return "T2";
  return "T1";
}

function getDeckTypeBadgeClasses(format?: string): string {
  const t = formatDeckType(format);
  if (t === "T2")
    return "px-1.5 py-0.5 bg-purple-100 dark:bg-purple-900/60 text-purple-700 dark:text-purple-300 rounded text-[11px] font-semibold leading-none";
  if (t === "Paragon")
    return "px-1.5 py-0.5 bg-amber-100 dark:bg-amber-900/60 text-amber-700 dark:text-amber-300 rounded text-[11px] font-semibold leading-none";
  return "px-1.5 py-0.5 bg-blue-100 dark:bg-blue-900/60 text-blue-700 dark:text-blue-300 rounded text-[11px] font-semibold leading-none";
}

interface DeckSourcePickerProps {
  /** Controlled textarea value */
  value: string;
  /** Called when the user types in the textarea */
  onChange: (value: string) => void;
  /** Called when a saved deck is selected (text, deckName, deckType, deckId) */
  onDeckSelected: (text: string, deckName: string, deckType: string | null, deckId?: string) => void;
  /** Currently loaded deck name */
  loadedDeckName?: string | null;
  /** Clear the loaded deck indicator */
  onClearLoaded?: () => void;
  /** Additional class for the textarea (e.g. focus ring color) */
  textareaClassName?: string;
}

export default function DeckSourcePicker({
  value,
  onChange,
  onDeckSelected,
  loadedDeckName,
  onClearLoaded,
  textareaClassName = "",
}: DeckSourcePickerProps) {
  const [mode, setMode] = useState<"paste" | "decks">("paste");
  const [isLoggedIn, setIsLoggedIn] = useState<boolean | null>(null);
  const [decks, setDecks] = useState<DeckData[]>([]);
  const [deckCount, setDeckCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingDeckId, setLoadingDeckId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  // Check auth + preload deck count on mount
  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data: { user } }) => {
      setIsLoggedIn(!!user);
      if (user) {
        // Preload deck count so we can show it on the button
        loadUserDecksAction().then((result) => {
          if (result.success && result.decks) {
            setDecks(result.decks as DeckData[]);
            setDeckCount(result.decks.length);
          }
        });
      }
    });
  }, []);

  const loadDecks = useCallback(async () => {
    if (decks.length > 0) return; // Already loaded
    setLoading(true);
    setError(null);
    try {
      const result = await loadUserDecksAction();
      if (result.success && result.decks) {
        setDecks(result.decks as DeckData[]);
        setDeckCount(result.decks.length);
      } else {
        setError(result.error || "Failed to load decks");
      }
    } catch {
      setError("Failed to load decks");
    } finally {
      setLoading(false);
    }
  }, [decks.length]);

  const handleSwitchToDecks = () => {
    setMode("decks");
    setSearchQuery("");
    setError(null);
    loadDecks();
  };

  const handleSelectDeck = async (deck: DeckData) => {
    if (!deck.id) return;
    setLoadingDeckId(deck.id);
    try {
      const result = await loadDeckByIdAction(deck.id);
      if (result.success && result.deck) {
        const text = deckCardsToLackeyText(result.deck.cards || []);
        const deckType = formatToDeckType(deck.format);
        onDeckSelected(text, deck.name, deckType, deck.id);
        setMode("paste");
      } else {
        setError(result.error || "Failed to load deck");
      }
    } catch {
      setError("Failed to load deck");
    } finally {
      setLoadingDeckId(null);
    }
  };

  const filteredDecks = decks.filter((d) =>
    d.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const showDeckOption = isLoggedIn === true;

  return (
    <div>
      {/* Source toggle + loaded indicator */}
      <div className="flex items-center justify-between mb-2">
        <label className="block text-sm font-medium">
          Decklist <span className="text-red-500">*</span>
        </label>
        {loadedDeckName && mode === "paste" && (
          <span className="inline-flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded">
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            {loadedDeckName}
            {onClearLoaded && (
              <button
                type="button"
                onClick={() => {
                  onClearLoaded();
                  onChange("");
                }}
                className="ml-0.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </span>
        )}
      </div>

      {/* Source buttons — only show if logged in with decks */}
      {showDeckOption && (
        <div className="flex gap-2 mb-3">
          <button
            type="button"
            onClick={() => setMode("paste")}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md border transition-colors ${
              mode === "paste"
                ? "bg-gray-900 dark:bg-white text-white dark:text-gray-900 border-gray-900 dark:border-white"
                : "bg-transparent text-gray-600 dark:text-gray-400 border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800"
            }`}
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
            Paste text
          </button>
          <button
            type="button"
            onClick={handleSwitchToDecks}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md border transition-colors ${
              mode === "decks"
                ? "bg-gray-900 dark:bg-white text-white dark:text-gray-900 border-gray-900 dark:border-white"
                : "bg-transparent text-gray-600 dark:text-gray-400 border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800"
            }`}
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
            </svg>
            My saved decks
            {deckCount !== null && deckCount > 0 && (
              <span className="text-[11px] bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300 px-1.5 py-0.5 rounded-full leading-none font-semibold">
                {deckCount}
              </span>
            )}
          </button>
        </div>
      )}

      {/* Paste mode: textarea */}
      {mode === "paste" && (
        <div>
          {!showDeckOption && (
            <p className="text-xs text-gray-500 mb-2">
              Paste from{" "}
              <a
                href="https://landofredemption.com/installing-lackey-with-redemption-plugin/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-500 hover:underline"
              >
                Lackey
              </a>
            </p>
          )}
          <textarea
            value={value}
            onChange={(e) => {
              onChange(e.target.value);
              if (loadedDeckName && onClearLoaded) onClearLoaded();
            }}
            className={`w-full h-64 p-3 font-mono text-sm border rounded-lg bg-background ${textareaClassName}`}
            placeholder="1&#9;Card Name"
            required
          />
        </div>
      )}

      {/* Decks mode: inline deck picker */}
      {mode === "decks" && (
        <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden bg-white dark:bg-gray-900">
          {/* Search */}
          <div className="px-4 py-2.5 border-b border-gray-200 dark:border-gray-700">
            <div className="flex items-center gap-2">
              <svg className="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                type="text"
                placeholder="Search decks..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                autoFocus
                className="w-full text-sm bg-transparent border-none outline-none placeholder:text-gray-400 dark:placeholder:text-gray-500 text-gray-900 dark:text-white"
              />
            </div>
          </div>

          {/* Deck list */}
          <div className="max-h-[17rem] overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center py-10 text-sm text-gray-500">
                <svg className="animate-spin mr-2 h-4 w-4" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                Loading decks...
              </div>
            ) : error ? (
              <div className="py-10 text-center text-sm text-red-500">{error}</div>
            ) : filteredDecks.length === 0 ? (
              <div className="py-10 text-center">
                <p className="text-sm text-gray-500">
                  {searchQuery ? "No decks match your search" : "No saved decks yet"}
                </p>
                {!searchQuery && (
                  <p className="text-xs text-gray-400 mt-1">
                    Build a deck in the{" "}
                    <a href="/decklist/card-search" className="text-blue-500 hover:underline">
                      deck builder
                    </a>{" "}
                    to use it here
                  </p>
                )}
              </div>
            ) : (
              <div>
                {filteredDecks.map((deck) => {
                  const isLoadingThis = loadingDeckId === deck.id;
                  return (
                    <button
                      key={deck.id}
                      type="button"
                      onClick={() => handleSelectDeck(deck)}
                      disabled={!!loadingDeckId}
                      className="w-full text-left px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors border-b border-gray-100 dark:border-gray-800 last:border-b-0 disabled:opacity-50"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-gray-900 dark:text-white truncate">
                              {deck.name}
                            </span>
                            <span className={getDeckTypeBadgeClasses(deck.format)}>
                              {formatDeckType(deck.format)}
                            </span>
                          </div>
                          <div className="flex items-center gap-3 mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                            <span>{deck.card_count || 0} cards</span>
                            {deck.updated_at && (
                              <span>
                                {new Date(deck.updated_at).toLocaleDateString()}
                              </span>
                            )}
                          </div>
                        </div>
                        {isLoadingThis ? (
                          <svg className="animate-spin h-4 w-4 text-gray-400 flex-shrink-0" viewBox="0 0 24 24" fill="none">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                          </svg>
                        ) : (
                          <svg className="w-4 h-4 text-gray-300 dark:text-gray-600 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                          </svg>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
