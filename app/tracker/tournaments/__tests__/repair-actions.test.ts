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
