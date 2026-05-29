import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

const skip = !SUPABASE_URL || !SUPABASE_SERVICE_ROLE;

const admin = skip ? null : createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE, {
  auth: { persistSession: false },
});

let tournamentId: string;
let hostUserId: string;
let participantIds: string[] = [];

(skip ? describe.skip : describe)('repair_match_score RPC', () => {
  beforeAll(async () => {
    const host = await admin!.auth.admin.createUser({
      email: `host-${Date.now()}@test.local`, password: 'testpass1234', email_confirm: true,
    });
    hostUserId = host.data.user!.id;
    const t = await admin!.from('tournaments').insert({
      name: 'Repair Test', host_id: hostUserId, has_started: true, n_rounds: 3,
      current_round: 2, max_score: 5,
    }).select().single();
    tournamentId = t.data!.id;

    const parts = await admin!.from('participants').insert([
      { tournament_id: tournamentId, name: 'A' },
      { tournament_id: tournamentId, name: 'B' },
      { tournament_id: tournamentId, name: 'C' },
      { tournament_id: tournamentId, name: 'D' },
    ]).select();
    participantIds = parts.data!.map(p => p.id);

    await admin!.from('matches').insert([
      { tournament_id: tournamentId, round: 1, match_order: 1, player1_id: participantIds[0], player2_id: participantIds[1], player1_score: 5, player2_score: 0, winner_id: participantIds[0], is_tie: false },
      { tournament_id: tournamentId, round: 1, match_order: 2, player1_id: participantIds[2], player2_id: participantIds[3], player1_score: 5, player2_score: 2, winner_id: participantIds[2], is_tie: false },
    ]);

    await admin!.from('rounds').insert({ tournament_id: tournamentId, round_number: 1, is_completed: true });
  });

  afterAll(async () => {
    if (!admin) return;
    await admin.from('tournaments').delete().eq('id', tournamentId);
    await admin.auth.admin.deleteUser(hostUserId);
  });

  it('rejects calls from non-host users', async () => {
    const other = await admin!.auth.admin.createUser({
      email: `other-${Date.now()}@test.local`, password: 'testpass1234', email_confirm: true,
    });
    const otherClient = createClient(SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      auth: { persistSession: false },
    });
    await otherClient.auth.signInWithPassword({ email: other.data.user!.email!, password: 'testpass1234' });

    const matchA = await admin!.from('matches').select('id').eq('tournament_id', tournamentId).eq('round', 1).limit(1).single();
    const { error } = await otherClient.rpc('repair_match_score', {
      p_match_id: matchA.data!.id, p_new_p1_score: 5, p_new_p2_score: 3,
    });

    expect(error).toBeTruthy();
    expect(error!.message).toMatch(/not the tournament host/);
    await admin!.auth.admin.deleteUser(other.data.user!.id);
  });

  it('writes the corrected score and inserts an audit row', async () => {
    const matchA = await admin!.from('matches').select('id').eq('player1_id', participantIds[0]).single();
    const hostUserInfo = await admin!.auth.admin.getUserById(hostUserId);
    const hostClient = createClient(SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      auth: { persistSession: false },
    });
    await hostClient.auth.signInWithPassword({
      email: hostUserInfo.data.user!.email!, password: 'testpass1234',
    });

    const { data, error } = await hostClient.rpc('repair_match_score', {
      p_match_id: matchA.data!.id, p_new_p1_score: 5, p_new_p2_score: 3, p_reason: 'reported wrong',
    });

    expect(error).toBeFalsy();
    expect(data).toMatchObject({ round: 1, old: { p1: 5, p2: 0 }, new: { p1: 5, p2: 3 } });

    const audit = await admin!.from('match_edits').select('*').eq('match_id', matchA.data!.id);
    expect(audit.data!.length).toBe(1);
    expect(audit.data![0].reason).toBe('reported wrong');
  });

  it('recomputes participant totals correctly', async () => {
    const a = await admin!.from('participants').select('match_points, differential').eq('id', participantIds[0]).single();
    expect(Number(a.data!.match_points)).toBe(3);
    expect(Number(a.data!.differential)).toBe(2);
  });
});

// Regression for the "forgetful frank" scoring bug: when Re-pair Round
// reassigned a bye from one player to another, participant.match_points kept
// the old bye holder's +3 and the new bye holder didn't get credit. Root
// cause: regenerate_current_round_pairings deleted/inserted byes but never
// recomputed participants from history.
(skip ? describe.skip : describe)('regenerate_current_round_pairings — recomputes after bye reassignment', () => {
  let tId: string;
  let hostId: string;
  let pIds: string[] = [];

  beforeAll(async () => {
    const host = await admin!.auth.admin.createUser({
      email: `host-regen-${Date.now()}@test.local`, password: 'testpass1234', email_confirm: true,
    });
    hostId = host.data.user!.id;

    const t = await admin!.from('tournaments').insert({
      name: 'Regen Recompute Test', host_id: hostId, has_started: true, n_rounds: 3,
      current_round: 2, max_score: 5, bye_points: 3, bye_differential: 0,
    }).select().single();
    tId = t.data!.id;

    // 5 players. P0=adam, P1=frank, P2=sam, P3=nathan, P4=tim.
    const parts = await admin!.from('participants').insert([
      { tournament_id: tId, name: 'adam' },
      { tournament_id: tId, name: 'frank' },
      { tournament_id: tId, name: 'sam' },
      { tournament_id: tId, name: 'nathan' },
      { tournament_id: tId, name: 'tim' },
    ]).select();
    pIds = parts.data!.map((p) => p.id);

    // R1: adam beats frank 5-0 (post-edit it's 4-5, frank wins), sam beats nathan 4-3, tim bye.
    // The match scores already reflect the POST-repair state — frank won 5-4.
    await admin!.from('matches').insert([
      { tournament_id: tId, round: 1, match_order: 1, player1_id: pIds[0], player2_id: pIds[1], player1_score: 4, player2_score: 5, winner_id: pIds[1], is_tie: false },
      { tournament_id: tId, round: 1, match_order: 2, player1_id: pIds[2], player2_id: pIds[3], player1_score: 4, player2_score: 3, winner_id: pIds[2], is_tie: false },
    ]);
    await admin!.from('byes').insert({ tournament_id: tId, round_number: 1, participant_id: pIds[4], match_points: 3, differential: 0 });
    await admin!.from('rounds').insert({ tournament_id: tId, round_number: 1, is_completed: true });

    // R2: frank has the bye initially (assigned BEFORE the R1 edits when frank was the loser).
    // adam vs sam, nathan vs tim. Unscored.
    await admin!.from('matches').insert([
      { tournament_id: tId, round: 2, match_order: 1, player1_id: pIds[0], player2_id: pIds[2] },
      { tournament_id: tId, round: 2, match_order: 2, player1_id: pIds[3], player2_id: pIds[4] },
    ]);
    await admin!.from('byes').insert({ tournament_id: tId, round_number: 2, participant_id: pIds[1], match_points: 3, differential: 0 });
    await admin!.from('rounds').insert({ tournament_id: tId, round_number: 2, is_completed: false });

    // Simulate the corrupt state right before re-pair: frank carries 6 MP
    // (3 from his R1 win + 3 stale bye contribution that was added when the
    // R1 edit ran while the R2 bye was still pointing at him). adam has 0
    // (R1 loss, no bye yet). This is the state the user ran into.
    await admin!.from('participants').update({ match_points: 0, differential: -1 }).eq('id', pIds[0]);
    await admin!.from('participants').update({ match_points: 6, differential: 1 }).eq('id', pIds[1]);
    await admin!.from('participants').update({ match_points: 2, differential: 1 }).eq('id', pIds[2]);
    await admin!.from('participants').update({ match_points: 1, differential: -1 }).eq('id', pIds[3]);
    await admin!.from('participants').update({ match_points: 3, differential: 0 }).eq('id', pIds[4]);
  });

  afterAll(async () => {
    if (!admin) return;
    await admin.from('tournaments').delete().eq('id', tId);
    await admin.auth.admin.deleteUser(hostId);
  });

  it('re-pairing R2 with the bye reassigned recomputes all participant totals from history', async () => {
    const hostUserInfo = await admin!.auth.admin.getUserById(hostId);
    const hostClient = createClient(SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      auth: { persistSession: false },
    });
    await hostClient.auth.signInWithPassword({
      email: hostUserInfo.data.user!.email!, password: 'testpass1234',
    });

    // Re-pair R2: adam gets the bye now (lowest MP post-repair), frank plays sam, nathan plays tim.
    const { error } = await hostClient.rpc('regenerate_current_round_pairings', {
      p_tournament_id: tId,
      p_pairings: [
        { player1_id: pIds[1], player2_id: pIds[2], match_order: 1 },
        { player1_id: pIds[3], player2_id: pIds[4], match_order: 2 },
      ],
      p_bye_id: pIds[0],
      p_unlock: false,
    });
    expect(error).toBeFalsy();

    const result = await admin!.from('participants').select('id, name, match_points, differential').eq('tournament_id', tId);
    const byName = Object.fromEntries(result.data!.map((p: any) => [p.name, p]));

    // adam: 0 (R1 loss to frank's max) + 3 (NEW R2 bye) = 3.
    expect(Number(byName.adam.match_points)).toBe(3);
    expect(Number(byName.adam.differential)).toBe(-1);
    // frank: 3 (R1 max-score win) + 0 (no longer has bye) = 3. The 6 is gone.
    expect(Number(byName.frank.match_points)).toBe(3);
    expect(Number(byName.frank.differential)).toBe(1);
    // sam, nathan, tim unchanged.
    expect(Number(byName.sam.match_points)).toBe(2);
    expect(Number(byName.nathan.match_points)).toBe(1);
    expect(Number(byName.tim.match_points)).toBe(3);
  });
});
