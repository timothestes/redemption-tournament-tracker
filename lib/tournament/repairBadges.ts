interface EditRow { match_id: string; round: number; }
interface MatchRow { id: string; round: number; player1_id: string; player2_id: string; }

/**
 * Return the set of participant ids who should show an "amended" badge
 * for the given round (i.e., they played in a match that has at least
 * one match_edits row for that round).
 */
export function participantsWithAmendedBadge(
  edits: EditRow[],
  matches: MatchRow[],
  round: number,
): Set<string> {
  const editedMatchIds = new Set(
    edits.filter(e => e.round === round).map(e => e.match_id),
  );
  const out = new Set<string>();
  for (const m of matches) {
    if (m.round !== round) continue;
    if (!editedMatchIds.has(m.id)) continue;
    out.add(m.player1_id);
    out.add(m.player2_id);
  }
  return out;
}
