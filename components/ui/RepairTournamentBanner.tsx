"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/utils/supabase/client";

interface Props {
  tournamentId: string;
  currentRound: number;
  isRoundActive: boolean;
}

export function RepairTournamentBanner({ tournamentId, currentRound, isRoundActive }: Props) {
  const [hasRecentEdit, setHasRecentEdit] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    setDismissed(false);
    if (!isRoundActive) {
      setHasRecentEdit(false);
      return;
    }
    const fetch = async () => {
      const client = createClient();
      const { data: round } = await client.from("rounds")
        .select("started_at")
        .eq("tournament_id", tournamentId)
        .eq("round_number", currentRound)
        .single();
      if (!round?.started_at) return;
      const { data: edits } = await client.from("match_edits_public")
        .select("match_id")
        .eq("tournament_id", tournamentId)
        .gte("edited_at", round.started_at)
        .limit(1);
      setHasRecentEdit((edits ?? []).length > 0);
    };
    fetch();
  }, [tournamentId, currentRound, isRoundActive]);

  if (!hasRecentEdit || dismissed) return null;

  return (
    <div role="status" className="rounded-md border border-border bg-muted px-4 py-2 flex items-center justify-between gap-4 mb-4">
      <p className="text-sm text-foreground">
        A previous-round result was repaired. Standings have been updated.
      </p>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        className="inline-flex items-center justify-center w-11 h-11 rounded-md text-muted-foreground hover:text-foreground hover:bg-background"
        aria-label="Dismiss"
      >
        ×
      </button>
    </div>
  );
}
