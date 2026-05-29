"use client";

import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent } from "./dialog";

export interface PickerMatch {
  id: string;
  round: number;
  player1Name: string;
  player2Name: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  completedRounds: number[];
  matches: PickerMatch[];
  onPick: (matchId: string) => void;
  /** Current (in-progress) round. The picker defaults to the previous round
   * (currentRound − 1) since that's the most likely target for a correction. */
  currentRound?: number | null;
}

export function RepairPastResultPicker({ open, onClose, completedRounds, matches, onPick, currentRound }: Props) {
  // Newest-completed first, independent of the caller's ordering.
  const rounds = useMemo(
    () => [...completedRounds].sort((a, b) => b - a),
    [completedRounds]
  );

  // Default to the previous round (current − 1) — the round just finished and
  // the most likely one to correct — falling back to the most recent completed
  // round when current − 1 isn't a completed round.
  const defaultRound = useMemo<number | "">(() => {
    if (rounds.length === 0) return "";
    const prev = (currentRound ?? 0) - 1;
    return rounds.includes(prev) ? prev : rounds[0];
  }, [rounds, currentRound]);

  const [round, setRound] = useState<number | "">(defaultRound);
  const [search, setSearch] = useState("");

  // Re-seed the selection to the previous round each time the picker opens (and
  // once the completed-rounds list arrives after mount). Clearing search avoids
  // a stale filter hiding that round's matches.
  useEffect(() => {
    if (open) {
      setRound(defaultRound);
      setSearch("");
    }
  }, [open, defaultRound]);

  const filtered = useMemo(() => {
    if (round === "") return [];
    const lc = search.trim().toLowerCase();
    return matches
      .filter(m => m.round === round)
      .filter(m => !lc || m.player1Name.toLowerCase().includes(lc) || m.player2Name.toLowerCase().includes(lc));
  }, [round, search, matches]);

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent size="md" className="rounded-t-lg sm:rounded-lg bg-card border border-border p-4">
        <h2 className="text-lg font-medium text-foreground">Edit a past result</h2>

        {completedRounds.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">Loading completed rounds…</p>
        ) : (
          <>
            <label className="block mt-3 text-sm text-muted-foreground">Round</label>
            <select
              value={round}
              onChange={(e) => setRound(e.target.value === "" ? "" : Number(e.target.value))}
              className="mt-1 w-full px-3 py-2 rounded-md border border-border bg-background text-foreground"
            >
              {rounds.map(r => (
                <option key={r} value={r}>Round {r}</option>
              ))}
            </select>

            <label className="block mt-3 text-sm text-muted-foreground">Search player</label>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Player name"
              className="mt-1 w-full px-3 py-2 rounded-md border border-border bg-background text-foreground"
            />

            <ul className="mt-3 max-h-60 overflow-y-auto divide-y divide-border">
              {filtered.map(m => (
                <li key={m.id}>
                  <button
                    type="button"
                    onClick={() => { onPick(m.id); onClose(); }}
                    className="w-full text-left px-2 py-3 hover:bg-muted text-sm text-foreground"
                  >
                    {m.player1Name} vs {m.player2Name}
                  </button>
                </li>
              ))}
              {filtered.length === 0 && (
                <li className="px-2 py-3 text-sm text-muted-foreground">No matches found.</li>
              )}
            </ul>
          </>
        )}

        <div className="mt-4 flex justify-end">
          <button type="button" onClick={onClose} className="px-3 py-2 rounded-md border border-border text-foreground">Close</button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
