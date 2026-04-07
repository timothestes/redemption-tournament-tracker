"use client";

import { useState } from "react";
import { Deck } from "../types/deck";
import { generateDeckText } from "../utils/deckImportExport";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
} from "@/components/ui/dialog";

interface GenerateDeckImageModalProps {
  deck: Deck;
  onClose: () => void;
  isLegal?: boolean | null;
}

export default function GenerateDeckImageModal({ deck, onClose, isLegal }: GenerateDeckImageModalProps) {
  const deckType = deck.format?.toLowerCase().includes("paragon")
    ? "paragon"
    : deck.format?.toLowerCase().includes("type 2")
    ? "type_2"
    : "type_1";

  const totalCards = deck.cards.reduce((sum, card) => sum + card.quantity, 0);

  const [nCardColumns, setNCardColumns] = useState(totalCards >= 100 ? 15 : 10);
  const [mCount, setMCount] = useState(false);
  const [aodCount, setAodCount] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ url: string } | null>(null);

  const decklist = generateDeckText(deck);

  const handleGenerate = async () => {
    setError(null);
    setSuccess(null);
    setLoading(true);

    try {
      // If we don't have legality yet, check it now
      let legalityResult = isLegal;
      if (legalityResult == null) {
        try {
          const checkBody = deck.id
            ? { deckId: deck.id }
            : { decklist, decklist_type: deckType };
          const checkRes = await fetch("/api/deckcheck", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(checkBody),
          });
          if (checkRes.ok) {
            const checkData = await checkRes.json();
            legalityResult = checkData.valid ?? null;
          }
        } catch {
          // Deckcheck failed — proceed without legality
        }
      }

      const response = await fetch(`${process.env.NEXT_PUBLIC_TOURNAMENT_API_ENDPOINT}/v1/generate-decklist-image`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          decklist,
          decklist_type: deckType,
          n_card_columns: nCardColumns,
          m_count: mCount,
          aod_count: aodCount,
          ...(deck.id ? { deck_id: deck.id } : {}),
          ...(legalityResult != null ? { is_legal: legalityResult } : {}),
        }),
      });

      const data = await response.json();
      if (data.status === "error") throw new Error(data.message);

      setSuccess({ url: data.data.downloadUrl });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate image");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={true} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent size="lg" className="max-w-md">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                Generate Deck Image
              </h3>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {deck.name}
              </p>
            </div>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 p-1"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </DialogHeader>

        <div className="px-6 py-5">
          {!success ? (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1.5">Layout Columns</label>
                <select
                  value={nCardColumns}
                  onChange={(e) => setNCardColumns(parseInt(e.target.value))}
                  className="w-full px-3 py-2 border border-border rounded-lg bg-card text-sm"
                >
                  <option value={6}>6 columns</option>
                  <option value={8}>8 columns</option>
                  <option value={10}>10 columns</option>
                  <option value={12}>12 columns</option>
                  <option value={15}>15 columns</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Options</label>
                <div className="flex flex-wrap gap-x-5 gap-y-2">
                  <label className="inline-flex items-center gap-2 text-sm cursor-pointer select-none" title="Average number of unique brigades when randomly drawing 8 non-lost soul cards">
                    <input type="checkbox" checked={mCount} onChange={(e) => setMCount(e.target.checked)} className="rounded border-gray-300 dark:border-gray-600 text-blue-600 bg-transparent" />
                    Matthew count
                  </label>
                  <label className="inline-flex items-center gap-2 text-sm cursor-pointer select-none" title="Average number of Daniel cards in the top 9 cards of a randomly shuffled deck">
                    <input type="checkbox" checked={aodCount} onChange={(e) => setAodCount(e.target.checked)} className="rounded border-gray-300 dark:border-gray-600 text-blue-600 bg-transparent" />
                    AoD count
                  </label>
                </div>
              </div>

              {error && (
                <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
              )}

              <DialogFooter className="justify-end gap-2 pt-2">
                <button
                  onClick={onClose}
                  disabled={loading}
                  className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleGenerate}
                  disabled={loading}
                  className="px-4 py-2 bg-gray-900 dark:bg-white text-white dark:text-gray-900 rounded-lg text-sm font-medium hover:bg-gray-800 dark:hover:bg-gray-100 transition-colors disabled:opacity-50 inline-flex items-center gap-2"
                >
                  {loading ? (
                    <>
                      <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                      Generating...
                    </>
                  ) : (
                    "Generate Image"
                  )}
                </button>
              </DialogFooter>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center flex-shrink-0">
                  <svg className="w-4 h-4 text-green-600 dark:text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <div>
                  <p className="text-sm font-semibold text-gray-900 dark:text-white">Image ready</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">Your deck image has been generated</p>
                </div>
              </div>

              <DialogFooter className="justify-end gap-2">
                <button
                  onClick={onClose}
                  className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                >
                  Close
                </button>
                <a
                  href={success.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-4 py-2 bg-gray-900 dark:bg-white text-white dark:text-gray-900 rounded-lg text-sm font-medium hover:bg-gray-800 dark:hover:bg-gray-100 transition-colors inline-flex items-center gap-2"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                  Open Image
                </a>
              </DialogFooter>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
