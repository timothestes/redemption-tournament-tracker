// Recompute a round's table numbers after a manual repair (player swap,
// bye swap, re-pair). Deterministic: same helper the pairing paths use.
// Safe only pre-results — all repair flows are already gated to rounds
// with no scores entered.

import { assignTables } from "../../lib/tournament/tableAssignment";

type AnyClient = {
  from: (table: string) => any;
};

export async function reassignRoundTables(
  client: AnyClient,
  tournamentId: string,
  round: number,
): Promise<void> {
  const [{ data: t }, { data: parts }, { data: ms }] = await Promise.all([
    client
      .from("tournaments")
      .select("starting_table_number, numbering_mode")
      .eq("id", tournamentId)
      .single(),
    client
      .from("participants")
      .select("id, assigned_seat")
      .eq("tournament_id", tournamentId)
      .eq("dropped_out", false)
      .not("assigned_seat", "is", null),
    client
      .from("matches")
      .select(
        "id, player1_id, player2_id, match_order, player1_match_points, player2_match_points, differential, differential2",
      )
      .eq("tournament_id", tournamentId)
      .eq("round", round)
      .order("match_order", { ascending: true }),
  ]);
  if (!t || !ms || ms.length === 0) return;

  const pins = new Map<string, number>(
    (parts || []).map((p: any) => [p.id as string, p.assigned_seat as number]),
  );
  const rows = (ms || []).map((m: any) => ({
    id: m.id as string,
    player1Id: m.player1_id as string,
    player2Id: m.player2_id as string,
    matchOrder: (m.match_order ?? 0) as number,
  }));
  const byId = new Map<string, any>((ms || []).map((m: any) => [m.id as string, m]));

  const { matches: assigned, overriddenPins } = assignTables(rows, pins, {
    startingTableNumber: t.starting_table_number ?? 1,
    mode: t.numbering_mode === "seats" ? "seats" : "tables",
  });
  const overridden = new Set(overriddenPins);

  for (const m of assigned) {
    const orig = byId.get((m as any).id);
    if (!orig) continue;
    const swapped = orig.player1_id !== m.player1Id;
    // Pin-override flags are recomputed fresh here and always written — not
    // just on a chair swap — because the override decision must reflect
    // this reassignment, not linger from whatever was persisted before it
    // (spec: "Overridden pins" §).
    const patch: Record<string, unknown> = {
      table_number: m.tableNumber,
      player1_pin_overridden: overridden.has(m.player1Id),
      player2_pin_overridden: overridden.has(m.player2Id),
    };
    if (swapped) {
      // Chair-side swap: mirror handleSwapPlayers' same-match flip — swap the
      // per-side sibling columns along with the ids. Scores are null here
      // (repairs are pre-results), so they don't need swapping.
      patch.player1_id = m.player1Id;
      patch.player2_id = m.player2Id;
      patch.player1_match_points = orig.player2_match_points;
      patch.player2_match_points = orig.player1_match_points;
      patch.differential = orig.differential2;
      patch.differential2 = orig.differential;
    }
    await client.from("matches").update(patch).eq("id", (m as any).id);
  }
}
