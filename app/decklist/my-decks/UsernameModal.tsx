"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/utils/supabase/client";
import { setUsernameAction, checkUsernameAvailableAction } from "../actions";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

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

  // Prefill username from OAuth provider metadata (e.g. Discord username)
  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user || username) return;
      const meta = user.user_metadata;
      const suggested = meta?.custom_claims?.global_name
        || meta?.full_name
        || meta?.name
        || meta?.user_name
        || meta?.preferred_username;
      if (suggested) {
        const sanitized = suggested.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 24);
        if (sanitized.length >= 3) {
          setUsername(sanitized);
        }
      }
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
    <Dialog open={true} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Choose a Username</DialogTitle>
          <DialogDescription>
            Your username will be displayed on your public decks so the community
            can see who built them.
          </DialogDescription>
        </DialogHeader>

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
              className="w-full px-4 py-2 border border-border rounded-lg bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <div className="flex items-center justify-between mt-1">
              <p className="text-xs text-muted-foreground">
                Letters, numbers, underscores, and hyphens
              </p>
              <p className="text-xs text-muted-foreground">
                {trimmed.length}/24
              </p>
            </div>

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

            {trimmed.length > 0 && !isValidChars && (
              <p className="mt-2 text-sm text-red-600 dark:text-red-400">
                Only letters, numbers, underscores, and hyphens are allowed
              </p>
            )}

            {error && (
              <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>
            )}
          </div>

          <DialogFooter className="bg-muted/50 justify-end">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-muted-foreground bg-card border border-border rounded-lg hover:bg-muted transition-colors"
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
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
