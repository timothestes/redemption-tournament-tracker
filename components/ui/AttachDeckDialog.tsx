"use client";

import { useState, useEffect, useRef } from "react";
import { Search, X, BookOpen } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogBody,
} from "./dialog";
import { searchDecksForTournamentAction, type DeckSearchResult } from "../../app/tracker/tournaments/actions";

interface AttachDeckDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  participantName: string;
  onSelect: (deck: DeckSearchResult) => void;
}

function formatDeckType(format?: string | null): string {
  if (!format) return "T1";
  const fmt = format.toLowerCase();
  if (fmt.includes("paragon")) return "Paragon";
  if (fmt.includes("type 2") || fmt.includes("multi") || fmt === "t2") return "T2";
  return "T1";
}

function getDeckTypeBadgeClasses(format?: string | null): string {
  const deckType = formatDeckType(format);
  if (deckType === "T2") {
    return "px-1.5 py-0.5 bg-purple-100 dark:bg-purple-900 text-purple-800 dark:text-purple-200 rounded text-xs font-medium";
  }
  if (deckType === "Paragon") {
    return "px-1.5 py-0.5 bg-amber-100 dark:bg-amber-900 text-amber-800 dark:text-amber-200 rounded text-xs font-medium";
  }
  return "px-1.5 py-0.5 bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 rounded text-xs font-medium";
}

export default function AttachDeckDialog({
  open,
  onOpenChange,
  participantName,
  onSelect,
}: AttachDeckDialogProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<DeckSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Focus input on open
  useEffect(() => {
    if (open) {
      setQuery("");
      setResults([]);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [open]);

  // Debounced search
  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }

    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      const res = await searchDecksForTournamentAction(query);
      if (res.success) {
        setResults(res.decks);
      }
      setLoading(false);
    }, 300);

    return () => clearTimeout(debounceRef.current);
  }, [query]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md" className="max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Attach Deck</DialogTitle>
          <DialogDescription>
            Search your decks or public decks for <strong>{participantName}</strong>
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="flex flex-col gap-3 flex-1 min-h-0">
          {/* Search input */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by deck name..."
              className="w-full pl-9 pr-9 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-sm"
            />
            {query && (
              <button
                onClick={() => setQuery("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          {/* Results */}
          <div className="flex-1 overflow-y-auto min-h-0 -mx-6 px-6">
            {loading && (
              <div className="flex items-center justify-center py-8">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-gray-900 dark:border-gray-100" />
              </div>
            )}

            {!loading && query && results.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-8">
                No decks found for &ldquo;{query}&rdquo;
              </p>
            )}

            {!loading && !query && (
              <div className="text-center py-8">
                <BookOpen className="w-8 h-8 text-muted-foreground/50 mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">
                  Type to search your decks and public community decks
                </p>
              </div>
            )}

            {!loading && results.length > 0 && (
              <div className="space-y-1">
                {results.map((deck) => (
                  <button
                    key={deck.id}
                    onClick={() => {
                      onSelect(deck);
                      onOpenChange(false);
                    }}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700/50 transition-colors text-left group"
                  >
                    {/* Preview thumbnail */}
                    <div className="w-8 h-10 rounded bg-gray-200 dark:bg-gray-700 flex-shrink-0 overflow-hidden flex items-center justify-center">
                      {deck.preview_card_1 ? (
                        <img
                          src={`${process.env.NEXT_PUBLIC_BLOB_BASE_URL}/card-images/${deck.preview_card_1.replace(/\.jpe?g$/i, "")}.jpg`}
                          alt=""
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <BookOpen className="w-4 h-4 text-muted-foreground/40" />
                      )}
                    </div>

                    {/* Deck info */}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{deck.name}</p>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span className={getDeckTypeBadgeClasses(deck.format)}>
                          {formatDeckType(deck.format)}
                        </span>
                        <span>{deck.card_count} cards</span>
                        {deck.username && (
                          <span className="truncate">by {deck.username}</span>
                        )}
                      </div>
                    </div>

                    {/* Select indicator */}
                    <span className="text-xs text-primary opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                      Select
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
