"use client";

import { useState } from "react";
import { regenerateCurrentRoundPairingsAction } from "@/app/tracker/tournaments/repair-actions";
import { Dialog, DialogContent } from "./dialog";

interface Props {
  tournamentId: string;
  currentRound: number;
  scoredMatchCount: number;
  isRoundCompleted: boolean;
  onComplete?: () => void;
  onUnlockRequest?: () => void;
  /** When true, the inline button trigger is omitted and the dialog is
   * controlled by `open` / `onOpenChange` — used when an overflow menu owns
   * the trigger. */
  hideTrigger?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function RegeneratePairingsButton({
  tournamentId,
  currentRound,
  scoredMatchCount,
  isRoundCompleted,
  onComplete,
  onUnlockRequest,
  hideTrigger = false,
  open: controlledOpen,
  onOpenChange,
}: Props) {
  const isControlled = controlledOpen !== undefined;
  const [internalOpen, setInternalOpen] = useState(false);
  const open = isControlled ? controlledOpen : internalOpen;
  const setOpen = (v: boolean) => {
    if (isControlled) onOpenChange?.(v);
    else setInternalOpen(v);
  };
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const enabled = !isRoundCompleted && scoredMatchCount === 0;
  const tooltip = !enabled
    ? "Re-pair is unavailable because results have already been submitted."
    : undefined;

  const handleSubmit = async () => {
    setBusy(true);
    setError(null);
    const result = await regenerateCurrentRoundPairingsAction({ tournamentId });
    setBusy(false);
    if (!result.ok) {
      setError(result.error ?? "Failed");
      return;
    }
    setOpen(false);
    setConfirmed(false);
    onComplete?.();
  };

  return (
    <>
      {!hideTrigger && (
        <div className="inline-flex items-center gap-2">
          <button
            type="button"
            disabled={!enabled}
            onClick={() => setOpen(true)}
            title={tooltip}
            className="px-3 py-2 rounded-md border border-border bg-background text-foreground hover:bg-muted disabled:bg-muted disabled:text-muted-foreground disabled:cursor-not-allowed text-sm"
          >
            Re-pair current round
          </button>
          {!enabled && scoredMatchCount > 0 && onUnlockRequest && (
            <button
              type="button"
              onClick={onUnlockRequest}
              className="text-sm underline text-muted-foreground hover:text-foreground"
            >
              Unlock and re-pair…
            </button>
          )}
        </div>
      )}

      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next) {
            setOpen(false);
            setConfirmed(false);
            setError(null);
          }
        }}
      >
        <DialogContent size="md" className="rounded-t-lg sm:rounded-lg bg-card border border-border p-4">
          <h2 className="text-lg font-medium text-foreground">
            Re-pair Round {currentRound}?
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            This will replace the current pairings using the corrected
            standings. The existing pairings will be discarded.
          </p>
          <label className="mt-3 flex items-start gap-2 text-sm text-foreground">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
              className="mt-1"
            />
            <span>I confirm no players have started current-round matches.</span>
          </label>
          {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setConfirmed(false);
                setError(null);
              }}
              className="px-3 py-2 rounded-md border border-border text-foreground"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!confirmed || busy}
              onClick={handleSubmit}
              className="px-3 py-2 rounded-md bg-primary text-primary-foreground disabled:bg-muted disabled:text-muted-foreground"
            >
              {busy ? "Re-pairing…" : "Re-pair"}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
