import { describe, it, expect } from 'vitest';
import { participantsWithAmendedBadge } from '../repairBadges';

interface EditRow { match_id: string; round: number; }
interface MatchRow { id: string; round: number; player1_id: string; player2_id: string; }

describe('participantsWithAmendedBadge', () => {
  it('flags both players of an edited match for the matching round', () => {
    const edits: EditRow[] = [{ match_id: 'm1', round: 1 }];
    const matches: MatchRow[] = [{ id: 'm1', round: 1, player1_id: 'A', player2_id: 'B' }];
    expect(participantsWithAmendedBadge(edits, matches, 1)).toEqual(new Set(['A', 'B']));
  });

  it('returns empty for rounds with no edits', () => {
    const edits: EditRow[] = [{ match_id: 'm1', round: 1 }];
    const matches: MatchRow[] = [{ id: 'm1', round: 1, player1_id: 'A', player2_id: 'B' }];
    expect(participantsWithAmendedBadge(edits, matches, 2)).toEqual(new Set());
  });

  it('flags only matches in the requested round', () => {
    const edits: EditRow[] = [{ match_id: 'm1', round: 1 }, { match_id: 'm2', round: 2 }];
    const matches: MatchRow[] = [
      { id: 'm1', round: 1, player1_id: 'A', player2_id: 'B' },
      { id: 'm2', round: 2, player1_id: 'C', player2_id: 'D' },
    ];
    expect(participantsWithAmendedBadge(edits, matches, 1)).toEqual(new Set(['A', 'B']));
  });
});
