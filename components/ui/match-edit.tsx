"use client";

import { Button } from "./button";
import { Pencil } from "lucide-react";
import { Dispatch, FormEvent, SetStateAction, useEffect, useRef, useState } from "react";
import { createClient } from "../../utils/supabase/client";
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

    // Require an explicit choice — null sentinel guard. Without this, the
    // < / > comparisons below would treat null as 0 and silently submit a
    // 0–0 result the user never selected.
    if (player1Score === null || player2Score === null) {
      setError("Select a score for both players before submitting.");
      return;
    }

    if (mode === "repair") {
      if (
        player1Score < 0 || player2Score < 0 ||
        player1Score > tournament.max_score ||
        player2Score > tournament.max_score
      ) {
        setError(`Invalid scores. Scores must be between 0 and ${tournament.max_score}, inclusive.`);
        return;
      }
      if (player1Score === tournament.max_score && player2Score === tournament.max_score) {
        setError(`Score cannot be ${tournament.max_score}-${tournament.max_score}.`);
        return;
      }
      const { repairMatchScoreAction } = await import("@/app/tracker/tournaments/repair-actions");
      const result = await repairMatchScoreAction({
        matchId: match.id,
        newP1Score: player1Score,
        newP2Score: player2Score,
        reason: reason || undefined,
        tournamentId: tournament.id,
      });
      if (!result.ok) {
        setError(`Repair failed: ${result.error}`);
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

    if (
      isNaN(player2Score) ||
      player1Score < 0 ||
      player2Score < 0 ||
      player1Score > tournament.max_score ||
      player2Score > tournament.max_score
    ) {
      setError(`Invalid scores. Scores must be between 0 and ${tournament.max_score}, inclusive.`);
      return;
    }
    if (player1Score === tournament.max_score && player2Score === tournament.max_score) {
      setError(`Score cannot be ${tournament.max_score}-${tournament.max_score}.`);
      return;
    }
    const client = createClient();

    const player1 = await client
      .from("participants")
      .select("differential, match_points, id")
      .eq("id", match.player1_id.id)
      .single();
    const player2 = await client
      .from("participants")
      .select("differential, match_points, id")
      .eq("id", match.player2_id.id)
      .single();

    if (player1.error || player2.error) {
      console.log(player1.error, player2.error);
      return;
    }

    let player1_match_points, player2_match_points;
    let isTie = false;
    let winnerId: string | null = null;

    if (player2Score === player1Score) {
      player1_match_points = 1.5;
      player2_match_points = 1.5;
      isTie = true;
      winnerId = null;
    } else if (player1Score === tournament.max_score) {
      player1_match_points = 3;
      player2_match_points = 0;
      winnerId = match.player1_id.id;
    } else if (player2Score === tournament.max_score) {
      player1_match_points = 0;
      player2_match_points = 3;
      winnerId = match.player2_id.id;
    } else if (player1Score > player2Score) {
      player1_match_points = 2;
      player2_match_points = 1;
      winnerId = match.player1_id.id;
    } else if (player2Score > player1Score) {
      player1_match_points = 1;
      player2_match_points = 2;
      winnerId = match.player2_id.id;
    }

    // Update the match without modifying match_order
    const { data, error } = await client
      .from("matches")
      .update({
        player1_score: player1Score,
        player2_score: player2Score,
        differential:
          (player1.data.differential ?? 0) + (player1Score - player2Score),
        differential2:
          (player2.data.differential ?? 0) + (player2Score - player1Score),
        player1_match_points:
          (player1.data.match_points || 0) + player1_match_points,
        player2_match_points:
          (player2.data.match_points || 0) + player2_match_points,
        is_tie: isTie,
        winner_id: winnerId,
        updated_at: new Date(),
      })
      .eq("id", match.id);

    setMatchErrorIndex((prev) => prev.filter((i) => i !== index));

    if (!error) {
      setOpen(false);
    } else {
      console.log(error);
      setError("Failed to save match scores. Please try again.");
      return;
    }

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
      ? `Repair result for ${p1Name} vs ${p2Name}`
      : `Edit score: ${p1Name} vs ${p2Name}`;
  const triggerTitle =
    mode === "repair"
      ? "Repair past result"
      : isRoundActive
        ? "Edit match scores"
        : "Cannot input scores until round is started";

  return (
    <>
      {!isControlled && (
        <div className="flex items-center justify-center w-full h-full" title={triggerTitle}>
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
            {mode === "repair" ? "Repair result" : "Edit Match"}
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
              {mode === "repair" && (
                <div className="mb-4">
                  <label className="block text-sm text-muted-foreground mb-1">Reason (optional)</label>
                  <input
                    type="text"
                    maxLength={240}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Why are you repairing this?"
                    className="w-full px-3 py-2 rounded-md border border-border bg-background text-foreground"
                  />
                </div>
              )}
            </div>
            <div className="flex justify-end gap-3 mt-2">
              <Button type="submit" variant="success">
                {mode === "repair" ? "Repair" : "Update"}
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
