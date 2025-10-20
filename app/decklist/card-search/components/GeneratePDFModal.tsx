"use client";

import { useState, useEffect } from "react";
import { Deck } from "../types/deck";
import { generateDeckText } from "../utils/deckImportExport";

interface GeneratePDFModalProps {
  deck: Deck;
  onClose: () => void;
}

export default function GeneratePDFModal({ deck, onClose }: GeneratePDFModalProps) {
  const [deckType, setDeckType] = useState("type_1");
  const [name, setName] = useState("");
  const [event, setEvent] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ url: string; message: string } | null>(null);
  const [showAlignment, setShowAlignment] = useState(false);
  const [mCount, setMCount] = useState(false);

  const decklist = generateDeckText(deck);

  // Handle ESC key to close modal
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  const validateForm = (): { valid: boolean; message?: string } => {
    if (!name?.trim()) {
      return { valid: false, message: "Player name is required" };
    }

    if (name.length > 50) {
      return { valid: false, message: "Player name must be 50 characters or less" };
    }

    if (!event?.trim()) {
      return { valid: false, message: "Event name is required" };
    }

    if (event.length > 100) {
      return { valid: false, message: "Event name must be 100 characters or less" };
    }

    return { valid: true };
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    
    const validation = validateForm();
    if (!validation.valid) {
      setError(validation.message || "Invalid form data");
      return;
    }

    setLoading(true);
    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_TOURNAMENT_API_ENDPOINT}/v1/generate-decklist`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          decklist,
          decklist_type: deckType,
          name,
          event,
          show_alignment: showAlignment,
          m_count: mCount,
        }),
      });

      const data = await response.json();

      if (data.status === "error") {
        throw new Error(data.message);
      }

      setSuccess({
        url: data.data.downloadUrl,
        message: data.message,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate PDF");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-6 py-4 flex items-center justify-between">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
            Generate PDF
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
          >
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="px-6 py-4">
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Deck Name Display */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Deck
              </label>
              <div className="px-3 py-2 bg-gray-50 dark:bg-gray-900 rounded border border-gray-300 dark:border-gray-600 text-gray-900 dark:text-white">
                {deck.name}
              </div>
            </div>

            {/* Player Name */}
            <div>
              <label htmlFor="name" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Player Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={50}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
                placeholder="Enter player name"
              />
            </div>

            {/* Event Name */}
            <div>
              <label htmlFor="event" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Event Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                id="event"
                value={event}
                onChange={(e) => setEvent(e.target.value)}
                maxLength={100}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
                placeholder="Enter event name"
              />
            </div>

            {/* Deck Type */}
            <div>
              <label htmlFor="deckType" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Deck Type
              </label>
              <select
                id="deckType"
                value={deckType}
                onChange={(e) => setDeckType(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
              >
                <option value="type_1">Type 1</option>
                <option value="type_2">Type 2</option>
              </select>
            </div>

            {/* Options */}
            <div className="space-y-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showAlignment}
                  onChange={(e) => setShowAlignment(e.target.checked)}
                  className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <span className="text-sm text-gray-700 dark:text-gray-300">
                  Show Card Alignments
                </span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={mCount}
                  onChange={(e) => setMCount(e.target.checked)}
                  className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <span className="text-sm text-gray-700 dark:text-gray-300">
                  M Count
                </span>
              </label>
            </div>

            {/* Error Message */}
            {error && (
              <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded text-red-700 dark:text-red-400 text-sm">
                {error}
              </div>
            )}

            {/* Success Message */}
            {success && (
              <div className="p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded text-green-700 dark:text-green-400 text-sm">
                <p className="font-medium mb-2">{success.message}</p>
                <a
                  href={success.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-blue-600 dark:text-blue-400 hover:underline"
                >
                  Download PDF
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                </a>
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-3 pt-4">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading}
                className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white rounded transition-colors disabled:cursor-not-allowed"
              >
                {loading ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Generating...
                  </span>
                ) : (
                  "Generate PDF"
                )}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
