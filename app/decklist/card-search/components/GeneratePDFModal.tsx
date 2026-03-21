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

interface GeneratePDFModalProps {
  deck: Deck;
  onClose: () => void;
  isLegal?: boolean | null;
}

export default function GeneratePDFModal({ deck, onClose, isLegal }: GeneratePDFModalProps) {
  const initialDeckType = deck.format?.toLowerCase().includes("paragon")
    ? "paragon"
    : deck.format?.toLowerCase().includes("type 2") || deck.format?.toLowerCase().includes("multi")
    ? "type_2"
    : "type_1";

  const [deckType, setDeckType] = useState(initialDeckType);
  const [name, setName] = useState("");
  const [event, setEvent] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ url: string } | null>(null);
  const [showAlignment, setShowAlignment] = useState(initialDeckType === "type_2");
  const [mCount, setMCount] = useState(false);
  const [aodCount, setAodCount] = useState(false);

  const decklist = generateDeckText(deck);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (name && name.length > 50) {
      setError("Player name must be 50 characters or less");
      return;
    }
    if (event && event.length > 100) {
      setError("Event name must be 100 characters or less");
      return;
    }

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

      const response = await fetch(`${process.env.NEXT_PUBLIC_TOURNAMENT_API_ENDPOINT}/v1/generate-decklist`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          decklist,
          decklist_type: deckType,
          name,
          event,
          show_alignment: showAlignment,
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
      setError(err instanceof Error ? err.message : "Failed to generate PDF");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={true} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent size="lg" className="max-w-lg">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                Generate Tournament PDF
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
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium mb-1.5">Player Name</label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    maxLength={50}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-sm"
                    placeholder="Enter your name"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1.5">Event Name</label>
                  <input
                    type="text"
                    value={event}
                    onChange={(e) => setEvent(e.target.value)}
                    maxLength={100}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-sm"
                    placeholder="Tournament name"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1.5">Deck Type</label>
                <select
                  value={deckType}
                  onChange={(e) => setDeckType(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-sm"
                >
                  <option value="type_1">Type 1</option>
                  <option value="type_2">Type 2</option>
                  <option value="paragon">Paragon</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Options</label>
                <div className="flex flex-wrap gap-x-5 gap-y-2">
                  <label className="inline-flex items-center gap-2 text-sm cursor-pointer select-none">
                    <input type="checkbox" checked={showAlignment} onChange={(e) => setShowAlignment(e.target.checked)} className="rounded border-gray-300 dark:border-gray-600 text-blue-600 bg-transparent" />
                    Card alignments
                  </label>
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
                  type="button"
                  onClick={onClose}
                  disabled={loading}
                  className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
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
                    "Generate PDF"
                  )}
                </button>
              </DialogFooter>
            </form>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center flex-shrink-0">
                  <svg className="w-4 h-4 text-green-600 dark:text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <div>
                  <p className="text-sm font-semibold text-gray-900 dark:text-white">PDF ready</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">Your tournament PDF has been generated</p>
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
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  Download PDF
                </a>
              </DialogFooter>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
