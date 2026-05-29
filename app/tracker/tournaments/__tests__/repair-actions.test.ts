import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { assertParticipantTotalsConsistent } from './_invariants';

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
    // Either error message proves rejection — "not the tournament host" if
    // RLS lets them see the tournament row, "match … not found" if RLS
    // blocks the inner SELECT before the host check runs. Both reject.
    expect(error!.message).toMatch(/not the tournament host|not found/);
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

  it('invariant: participants.match_points equals recomputed value', async () => {
    await assertParticipantTotalsConsistent(admin, tournamentId, 'repair_match_score');
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

    await assertParticipantTotalsConsistent(admin, tId, 'regenerate-with-new-bye');
  });
});

// Layer 1 coverage for the two client-side bye-swap handlers in
// components/ui/TournamentRounds.tsx. These tests don't render the React
// component — they call the same Supabase mutations the handlers do, plus
// the recompute_participant_totals RPC, and assert the resulting state.
//
// Why this matters: the handlers used to do incremental math against per-match
// snapshots that go stale after Repair past result. When the snapshots were
// stale, participant.match_points came out wrong. The fix routes them through
// the recompute RPC; these tests pin that behavior.
(skip ? describe.skip : describe)('client swap handlers — recompute via RPC after structural mutation', () => {
  let tId: string;
  let hostId: string;
  let hostEmail: string;
  let pIds: string[] = [];
  let r1MatchAdamFrankId: string;
  let r2MatchAdamSamId: string;
  let r2ByeFrankId: number;
  let r1ByeTimId: number;
  let hostClient: any;

  beforeAll(async () => {
    const host = await admin!.auth.admin.createUser({
      email: `host-swap-${Date.now()}@test.local`, password: 'testpass1234', email_confirm: true,
    });
    hostId = host.data.user!.id;
    hostEmail = host.data.user!.email!;

    const t = await admin!.from('tournaments').insert({
      name: 'Swap Recompute Test', host_id: hostId, has_started: true, n_rounds: 3,
      current_round: 2, max_score: 5, bye_points: 3, bye_differential: 0,
    }).select().single();
    tId = t.data!.id;

    const parts = await admin!.from('participants').insert([
      { tournament_id: tId, name: 'adam' },
      { tournament_id: tId, name: 'frank' },
      { tournament_id: tId, name: 'sam' },
      { tournament_id: tId, name: 'nathan' },
      { tournament_id: tId, name: 'tim' },
    ]).select();
    pIds = parts.data!.map((p) => p.id);

    // R1: post-edit state — frank won 5-4 over adam, sam won 4-3 over nathan, tim bye.
    const r1Matches = await admin!.from('matches').insert([
      { tournament_id: tId, round: 1, match_order: 1, player1_id: pIds[0], player2_id: pIds[1], player1_score: 4, player2_score: 5, winner_id: pIds[1], is_tie: false },
      { tournament_id: tId, round: 1, match_order: 2, player1_id: pIds[2], player2_id: pIds[3], player1_score: 4, player2_score: 3, winner_id: pIds[2], is_tie: false },
    ]).select();
    r1MatchAdamFrankId = r1Matches.data![0].id;

    const r1Byes = await admin!.from('byes').insert({ tournament_id: tId, round_number: 1, participant_id: pIds[4], match_points: 3, differential: 0 }).select();
    r1ByeTimId = r1Byes.data![0].id;
    await admin!.from('rounds').insert({ tournament_id: tId, round_number: 1, is_completed: true });

    // R2 generated (unscored): adam vs sam, nathan vs tim. frank has the bye.
    const r2Matches = await admin!.from('matches').insert([
      { tournament_id: tId, round: 2, match_order: 1, player1_id: pIds[0], player2_id: pIds[2] },
      { tournament_id: tId, round: 2, match_order: 2, player1_id: pIds[3], player2_id: pIds[4] },
    ]).select();
    r2MatchAdamSamId = r2Matches.data![0].id;

    const r2Byes = await admin!.from('byes').insert({ tournament_id: tId, round_number: 2, participant_id: pIds[1], match_points: 3, differential: 0 }).select();
    r2ByeFrankId = r2Byes.data![0].id;
    await admin!.from('rounds').insert({ tournament_id: tId, round_number: 2, is_completed: false });

    // Seed correct totals (R1 win/loss + R2 bye placement matches above).
    await admin!.from('participants').update({ match_points: 0, differential: -1 }).eq('id', pIds[0]); // adam: R1 loss, no bye
    await admin!.from('participants').update({ match_points: 6, differential: 1 }).eq('id', pIds[1]);  // frank: R1 win + R2 bye = 6 (the bug state)
    await admin!.from('participants').update({ match_points: 2, differential: 1 }).eq('id', pIds[2]);  // sam: partial win
    await admin!.from('participants').update({ match_points: 1, differential: -1 }).eq('id', pIds[3]); // nathan: partial loss
    await admin!.from('participants').update({ match_points: 3, differential: 0 }).eq('id', pIds[4]);  // tim: R1 bye

    hostClient = createClient(SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      auth: { persistSession: false },
    });
    await hostClient.auth.signInWithPassword({ email: hostEmail, password: 'testpass1234' });
  });

  afterAll(async () => {
    if (!admin) return;
    await admin.from('tournaments').delete().eq('id', tId);
    await admin.auth.admin.deleteUser(hostId);
  });

  it('handleSwapPlayerWithBye effect: swap match player with bye holder, totals consistent', async () => {
    // Mirrors components/ui/TournamentRounds.tsx → handleSwapPlayerWithBye:
    // swap adam (R2 match P1) with frank (R2 bye holder). Adam goes to the
    // bye, frank goes into the match. Then call recompute via RPC.
    await hostClient.from('matches').update({
      player1_id: pIds[1], // frank takes adam's seat
      player1_score: null,
      player2_score: null,
    }).eq('id', r2MatchAdamSamId);

    await hostClient.from('byes').update({
      participant_id: pIds[0], // adam takes the bye
      match_points: 3,
      differential: 0,
    }).eq('id', r2ByeFrankId);

    const { error } = await hostClient.rpc('recompute_participant_totals', { p_tournament_id: tId });
    expect(error).toBeFalsy();

    const parts = await admin!.from('participants').select('id, name, match_points, differential').eq('tournament_id', tId);
    const byName = Object.fromEntries(parts.data!.map((p: any) => [p.name, p]));
    // adam: 0 (R1 loss) + 3 (new R2 bye) = 3
    expect(Number(byName.adam.match_points)).toBe(3);
    // frank: 3 (R1 win) + 0 (no longer has bye) = 3, the 6 is gone
    expect(Number(byName.frank.match_points)).toBe(3);

    await assertParticipantTotalsConsistent(admin, tId, 'handleSwapPlayerWithBye');
  });

  it('handleSwapPlayersWithBye effect: swap two byes, totals consistent', async () => {
    // Mirrors components/ui/TournamentRounds.tsx → handleSwapPlayersWithBye:
    // swap participant_id between R1 bye (tim) and R2 bye (adam after the
    // previous test). Then call recompute. After this:
    //   R1 bye holder = adam, R2 bye holder = tim.
    // Note tim's R1 bye is already-completed, so this is mostly a contrived
    // case for testing the handler, but exercises the same call shape.
    await Promise.all([
      hostClient.from('byes').update({ participant_id: pIds[4] /* tim */ }).eq('id', r2ByeFrankId),
      hostClient.from('byes').update({ participant_id: pIds[0] /* adam */ }).eq('id', r1ByeTimId),
    ]);

    const { error } = await hostClient.rpc('recompute_participant_totals', { p_tournament_id: tId });
    expect(error).toBeFalsy();

    const parts = await admin!.from('participants').select('id, name, match_points, differential').eq('tournament_id', tId);
    const byName = Object.fromEntries(parts.data!.map((p: any) => [p.name, p]));
    // adam: 0 (R1 loss) + 3 (R1 bye now) = 3 (was 3 from R2 bye, swapped to R1 bye, total same)
    expect(Number(byName.adam.match_points)).toBe(3);
    // tim: 0 (no match) + 3 (R2 bye now) = 3 (was 3 from R1 bye, swapped to R2, total same)
    expect(Number(byName.tim.match_points)).toBe(3);
    // frank: 3 (R1 win) + 0 (no bye) = 3
    expect(Number(byName.frank.match_points)).toBe(3);

    await assertParticipantTotalsConsistent(admin, tId, 'handleSwapPlayersWithBye');
  });

  it('recompute_participant_totals rejects non-host callers', async () => {
    const other = await admin!.auth.admin.createUser({
      email: `other-swap-${Date.now()}@test.local`, password: 'testpass1234', email_confirm: true,
    });
    const otherClient = createClient(SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      auth: { persistSession: false },
    });
    await otherClient.auth.signInWithPassword({ email: other.data.user!.email!, password: 'testpass1234' });

    const { error } = await otherClient.rpc('recompute_participant_totals', { p_tournament_id: tId });
    expect(error).toBeTruthy();
    // Either error message proves rejection (see comment on the analogous
    // assertion in the repair_match_score auth test).
    expect(error!.message).toMatch(/not the tournament host|not found/);

    await admin!.auth.admin.deleteUser(other.data.user!.id);
  });
});
