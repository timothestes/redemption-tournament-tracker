"use client";

import { Button } from "./button";
import { Pencil } from "lucide-react";
import { Dispatch, FormEvent, SetStateAction, useEffect, useRef, useState } from "react";
import { createClient } from "../../utils/supabase/client";
import { saveMatchScore, validateScorePair } from "../../utils/tournament/saveMatchScore";
import { Dialog, DialogContent } from "./dialog";

export default function MatchEditModal({
  match,
  fetchCurrentRoundData,
  setMatchErrorIndex,
  isRoundActive,
  index,
  tournament,
  mode = "edit",
  open: controlledOpen,
  onOpenChange,
  onRepairSuccess,
  showReason,
}: {
  match: any;
  fetchCurrentRoundData?: any;
  setMatchErrorIndex: Dispatch<SetStateAction<number[]>>;
  isRoundActive: boolean;
  index: number;
  tournament: any;
  mode?: "edit" | "repair";
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onRepairSuccess?: () => void;
  /** Whether to show the "Reason" field. Only meaningful in repair mode.
   * Reserved for correcting a result in a PAST round (round < current round);
   * current-round score entry/fixes don't need a reason. Defaults to
   * `mode === "repair"` when not provided. */
  showReason?: boolean;
}) {
  const isControlled = controlledOpen !== undefined;
  const [internalOpen, setInternalOpen] = useState(false);
  const open = isControlled ? controlledOpen : internalOpen;
  const setOpen = (v: boolean) => {
    if (isControlled) {
      onOpenChange?.(v);
    } else {
      setInternalOpen(v);
    }
  };
  // Explicit null sentinel for "no choice yet" — never conflate with 0.
  // The ScoreSelector compares strictly against the selected score, so an
  // unscored match opens with no button highlighted at all.
  const [player1Score, setPlayer1Score] = useState<number | null>(
    match.player1_score ?? null,
  );
  const [player2Score, setPlayer2Score] = useState<number | null>(
    match.player2_score ?? null,
  );
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Unsaved-edit guard: prevent backdrop click from silently discarding
  // score changes. ESC and the explicit Cancel button are still valid exits
  // even while dirty (handled below + the user clicking Cancel calls
  // setOpen(false) directly, bypassing the guard).
  const hasUnsavedChanges =
    player1Score !== (match.player1_score ?? null) ||
    player2Score !== (match.player2_score ?? null);

  // Suppress the next onOpenChange(false) call when ESC fires, so the
  // primitive's ESC handler can close the dialog even while the unsaved
  // edits guard is in effect.
  const allowNextClose = useRef(false);

  useEffect(() => {
    if (!open) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") allowNextClose.current = true;
    };
    document.addEventListener("keydown", handleEscape, { capture: true });
    return () => document.removeEventListener("keydown", handleEscape, { capture: true } as any);
  }, [open]);

  // Always seed both scores from the match on open so reopening an already-
  // scored match preselects the saved value. Use a null sentinel for unset
  // scores — never default to 0, which would visually claim a choice the
  // user hasn't made and risk a silent "0–0" submission.
  const handleOpenModal = () => {
    if (isRoundActive || mode === "repair") {
      setPlayer1Score(match.player1_score ?? null);
      setPlayer2Score(match.player2_score ?? null);
      setReason("");
      setError(null);
      setOpen(true);
    }
  };

  const handleDialogOpenChange = (next: boolean) => {
    // The Dialog primitive fires onOpenChange(false) for both ESC and
    // backdrop clicks. If the user has unsaved score changes, block the
    // backdrop close path so a stray click can't discard pending input.
    // ESC sets allowNextClose so it remains a valid exit.
    if (!next && hasUnsavedChanges && !allowNextClose.current) return;
    allowNextClose.current = false;
    setOpen(next);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    // Covers the null sentinel ("no choice yet" — never conflate with 0), the
    // 0..max_score range, and the unreachable max–max pair.
    const invalid = validateScorePair(player1Score, player2Score, tournament.max_score);
    if (invalid) {
      setError(invalid);
      return;
    }
    // Past the guard both scores are numbers; TS can't narrow through the helper.
    if (player1Score === null || player2Score === null) return;

    if (mode === "repair") {
      const { repairMatchScoreAction } = await import("@/app/tracker/tournaments/repair-actions");
      const result = await repairMatchScoreAction({
        matchId: match.id,
        newP1Score: player1Score,
        newP2Score: player2Score,
        reason: reason || undefined,
        tournamentId: tournament.id,
      });
      if (!result.ok) {
        setError(`Edit failed: ${result.error}`);
        return;
      }
      // Await the parent's refresh BEFORE closing the modal so the table
      // re-renders with corrected scores. Without await, setOpen(false) fires
      // first and the table keeps the pre-repair data until manual refresh.
      await fetchCurrentRoundData?.();
      onRepairSuccess?.();
      setOpen(false);
      return;
    }

    const result = await saveMatchScore(createClient(), {
      matchId: match.id,
      player1Id: match.player1_id.id,
      player2Id: match.player2_id.id,
      player1Score,
      player2Score,
      maxScore: tournament.max_score,
    });

    setMatchErrorIndex((prev) => prev.filter((i) => i !== index));

    if (result.ok === false) {
      setError(result.error);
      return;
    }

    setOpen(false);
    fetchCurrentRoundData?.();
  };

  // Generate score options based on tournament.max_score
  const scoreOptions = Array.from({ length: tournament.max_score + 1 }, (_, i) => i);

  // Score selector component
  const ScoreSelector = ({
    player,
    selectedScore,
    setScore
  }: {
    player: string,
    selectedScore: number | null,
    setScore: (score: number) => void
  }) => {
    return (
      <div className="mb-4">
        <h3 className="text-lg text-muted-foreground font-normal mb-2">
          <span className="text-foreground font-medium">{player}</span> Lost Souls (score):
        </h3>
        <div className="flex gap-2">
          {scoreOptions.map((score) => (
            <button
              key={score}
              type="button"
              onClick={() => setScore(score)}
              className={`w-10 h-10 rounded-md flex items-center justify-center transition-colors border ${
                selectedScore === score
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-muted text-foreground hover:bg-muted border-border"
              }`}
            >
              {score}
            </button>
          ))}
        </div>
      </div>
    );
  };

  const p1Name = match.player1_id?.name ?? "Player 1";
  const p2Name = match.player2_id?.name ?? "Player 2";
  const triggerAriaLabel =
    mode === "repair"
      ? `Edit result for ${p1Name} vs ${p2Name}`
      : `Edit score: ${p1Name} vs ${p2Name}`;
  const triggerTitle =
    mode === "repair"
      ? "Edit a past result"
      : isRoundActive
        ? "Edit match scores"
        : "Cannot input scores until round is started";

  return (
    <>
      {!isControlled && (
        <div className="inline-flex items-center justify-center" title={triggerTitle}>
          <button
            className={`inline-flex items-center justify-center w-11 h-11 rounded-md transition-colors ${
              isRoundActive || mode === "repair"
                ? "text-foreground hover:text-primary hover:bg-muted cursor-pointer"
                : "text-muted-foreground/50"
            }`}
            onClick={handleOpenModal}
            disabled={!isRoundActive && mode !== "repair"}
            aria-label={triggerAriaLabel}
          >
            <Pencil size={20} />
          </button>
        </div>
      )}
      <Dialog open={open} onOpenChange={handleDialogOpenChange}>
        <DialogContent size="md" className="bg-card border-2 border-border py-8 px-8">
          <h2 className="text-xl font-bold mb-6 text-foreground">
            {mode === "repair" ? "Edit result" : "Edit Match"}
          </h2>
          <form onSubmit={handleSubmit} className="flex flex-col gap-6">
            <div className="block space-y-5">
              {error && (
                <p className="text-destructive text-sm" role="alert">
                  {error}
                </p>
              )}
              <ScoreSelector
                player={match.player1_id.name}
                selectedScore={player1Score}
                setScore={setPlayer1Score}
              />
              <ScoreSelector
                player={match.player2_id.name}
                selectedScore={player2Score}
                setScore={setPlayer2Score}
              />
              {player1Score === tournament.max_score && player2Score === tournament.max_score && (
                <p className="text-red-500 text-sm">
                  Score cannot be {tournament.max_score}-{tournament.max_score}.
                </p>
              )}
              {(showReason ?? mode === "repair") && (
                <div className="mb-4">
                  <label className="block text-sm text-muted-foreground mb-1">Reason (optional)</label>
                  <input
                    type="text"
                    maxLength={240}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Why are you editing this?"
                    className="w-full px-3 py-2 rounded-md border border-border bg-background text-foreground"
                  />
                </div>
              )}
            </div>
            <div className="flex justify-end gap-3 mt-2">
              <Button type="submit" variant="success">
                {mode === "repair" ? "Save" : "Update"}
              </Button>
              <Button type="button" variant="cancel" onClick={() => setOpen(false)}>
                Cancel
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
