"use client";

import { useState, useEffect } from "react";
import { setUsernameAction, checkUsernameAvailableAction } from "../actions";

interface UsernameModalProps {
  onSuccess: (username: string) => void;
  onClose: () => void;
}

export default function UsernameModal({ onSuccess, onClose }: UsernameModalProps) {
  const [username, setUsername] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Handle ESC key to close modal
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [onClose]);

  // Debounced availability check
  useEffect(() => {
    const trimmed = username.trim();
    if (trimmed.length < 3 || !/^[a-zA-Z0-9_-]+$/.test(trimmed)) {
      setAvailable(null);
      return;
    }
    setChecking(true);
    const timeout = setTimeout(async () => {
      const result = await checkUsernameAvailableAction(trimmed);
      setAvailable(result.available);
      setChecking(false);
    }, 400);
    return () => clearTimeout(timeout);
  }, [username]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const result = await setUsernameAction(username);
    setSubmitting(false);
    if (result.success) {
      onSuccess(username.trim());
    } else {
      setError(result.error || "Failed to set username");
    }
  }

  const trimmed = username.trim();
  const isValidLength = trimmed.length >= 3 && trimmed.length <= 24;
  const isValidChars = /^[a-zA-Z0-9_-]*$/.test(trimmed);
  const canSubmit = isValidLength && isValidChars && available === true && !submitting;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
            Choose a Username
          </h3>
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
            Your username will be displayed on your public decks so the community
            can see who built them.
          </p>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit}>
          <div className="px-6 py-4">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Username
            </label>
            <input
              type="text"
              value={username}
              onChange={(e) => { setUsername(e.target.value.replace(/[^a-zA-Z0-9_-]/g, "")); setError(null); }}
              placeholder="Enter a username..."
              autoFocus
              name="deck-display-alias"
              autoComplete="one-time-code"
              maxLength={24}
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <div className="flex items-center justify-between mt-1">
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Letters, numbers, underscores, and hyphens
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {trimmed.length}/24
              </p>
            </div>

            {/* Availability indicator */}
            {trimmed.length >= 3 && isValidChars && (
              <div className="mt-2 text-sm">
                {checking ? (
                  <span className="text-gray-500">Checking availability...</span>
                ) : available === true ? (
                  <span className="text-green-600 dark:text-green-400">Username is available</span>
                ) : available === false ? (
                  <span className="text-red-600 dark:text-red-400">Username is already taken</span>
                ) : null}
              </div>
            )}

            {/* Validation messages */}
            {trimmed.length > 0 && !isValidChars && (
              <p className="mt-2 text-sm text-red-600 dark:text-red-400">
                Only letters, numbers, underscores, and hyphens are allowed
              </p>
            )}

            {/* Server error */}
            {error && (
              <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>
            )}
          </div>

          {/* Footer */}
          <div className="bg-gray-50 dark:bg-gray-900/50 px-6 py-4 flex gap-3 justify-end border-t border-gray-200 dark:border-gray-700">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!canSubmit}
              className="px-4 py-2 text-sm font-medium text-white bg-green-700 hover:bg-green-800 disabled:bg-gray-400 disabled:cursor-not-allowed rounded-lg transition-colors"
            >
              {submitting ? "Setting..." : "Set Username & Continue"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
