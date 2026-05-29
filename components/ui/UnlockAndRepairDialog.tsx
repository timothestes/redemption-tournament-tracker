"use client";

import { useState } from "react";
import { regenerateCurrentRoundPairingsAction } from "@/app/tracker/tournaments/repair-actions";

export interface ScoredMatch {
  id: string;
  player1Name: string;
  player2Name: string;
  player1Score: number;
  player2Score: number;
}

interface Props {
  open: boolean;
  onClose: () => void;
  tournamentId: string;
  scoredMatches: ScoredMatch[];
  onComplete?: () => void;
}

export function UnlockAndRepairDialog({ open, onClose, tournamentId, scoredMatches, onComplete }: Props) {
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const close = () => {
    setConfirmed(false);
    setError(null);
    onClose();
  };

  const handleSubmit = async () => {
    setBusy(true);
    setError(null);
    const result = await regenerateCurrentRoundPairingsAction({ tournamentId, unlock: true });
    setBusy(false);
    if (!result.ok) {
      setError(result.error ?? "Failed");
      return;
    }
    setConfirmed(false);
    onClose();
    onComplete?.();
  };

  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-background/80">
      <div className="w-full max-w-md rounded-t-lg sm:rounded-lg bg-card border border-border p-4">
        <h2 className="text-lg font-medium text-foreground">Unlock &amp; regenerate?</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Unlocking will discard the following {scoredMatches.length} result{scoredMatches.length === 1 ? "" : "s"} and regenerate pairings:
        </p>
        <ul className="mt-2 space-y-1 text-sm text-foreground max-h-40 overflow-y-auto">
          {scoredMatches.map(m => (
            <li key={m.id}>
              {m.player1Name} vs {m.player2Name}: {m.player1Score}-{m.player2Score}
            </li>
          ))}
        </ul>
        <label className="mt-3 flex items-start gap-2 text-sm text-foreground">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
            className="mt-1"
          />
          <span>I confirm these results will be permanently deleted.</span>
        </label>
        {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={close} className="px-3 py-2 rounded-md border border-border text-foreground">Cancel</button>
          <button
            type="button"
            disabled={!confirmed || busy}
            onClick={handleSubmit}
            className="px-3 py-2 rounded-md bg-destructive text-destructive-foreground disabled:bg-muted disabled:text-muted-foreground"
          >
            {busy ? "Unlocking…" : "Unlock and regenerate"}
          </button>
        </div>
      </div>
    </div>
  );
}
