"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/utils/supabase/client";

interface EditRow {
  id: string;
  round: number;
  old_player1_score: number;
  old_player2_score: number;
  new_player1_score: number;
  new_player2_score: number;
  edited_at: string;
  reason: string | null;
  match_id: string;
}

interface MatchRow {
  id: string;
  player1: { name: string } | null;
  player2: { name: string } | null;
}

interface Props {
  tournamentId: string;
}

export function AuditLogPanel({ tournamentId }: Props) {
  const [rows, setRows] = useState<EditRow[]>([]);
  const [matches, setMatches] = useState<Record<string, MatchRow>>({});

  useEffect(() => {
    const fetch = async () => {
      const client = createClient();
      const { data: edits } = await client
        .from("match_edits")
        .select("*")
        .eq("tournament_id", tournamentId)
        .order("edited_at", { ascending: false });
      const editList = (edits ?? []) as EditRow[];
      setRows(editList);

      if (editList.length > 0) {
        const matchIds = editList.map(e => e.match_id);
        const { data: m } = await client
          .from("matches")
          .select("id, player1:participants!matches_player1_id_fkey(name), player2:participants!matches_player2_id_fkey(name)")
          .in("id", matchIds);
        const map: Record<string, MatchRow> = {};
        ((m ?? []) as unknown as MatchRow[]).forEach((row) => { map[row.id] = row; });
        setMatches(map);
      }
    };
    fetch();
  }, [tournamentId]);

  if (rows.length === 0) {
    return (
      <section className="rounded-md border border-border bg-card p-4">
        <h3 className="text-sm font-medium text-foreground">Audit log</h3>
        <p className="mt-1 text-sm text-muted-foreground">No edits yet.</p>
      </section>
    );
  }

  return (
    <section className="rounded-md border border-border bg-card p-4">
      <h3 className="text-sm font-medium text-foreground mb-2">Audit log</h3>
      <ul className="divide-y divide-border">
        {rows.map((r) => {
          const m = matches[r.match_id];
          const p1Name = m?.player1?.name ?? "?";
          const p2Name = m?.player2?.name ?? "?";
          return (
            <li key={r.id} className="py-2 text-sm">
              <div className="text-foreground">
                Round {r.round}: {p1Name} vs {p2Name}
              </div>
              <div className="text-muted-foreground">
                {r.old_player1_score}-{r.old_player2_score} → {r.new_player1_score}-{r.new_player2_score}
              </div>
              <div className="text-xs text-muted-foreground">
                {new Date(r.edited_at).toLocaleString()}
                {r.reason ? ` · ${r.reason}` : ""}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
