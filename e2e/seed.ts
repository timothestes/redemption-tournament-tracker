import { createClient } from "@supabase/supabase-js";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

export const adminAvailable = !!URL && !!SERVICE;

export const admin = adminAvailable
  ? createClient(URL, SERVICE, { auth: { persistSession: false } })
  : null;

export interface SeededTournament {
  tournamentId: string;
  hostEmail: string;
  hostPassword: string;
  participantIds: string[];
}

export async function seedTournamentWithCompletedRound1(): Promise<SeededTournament> {
  if (!admin) throw new Error("Seed helper requires SUPABASE_SERVICE_ROLE_KEY");

  const hostEmail = `host-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@e2e.test`;
  const hostPassword = "Testpass12345";
  const { data: hostUser, error: hostErr } = await admin.auth.admin.createUser({
    email: hostEmail, password: hostPassword, email_confirm: true,
  });
  if (hostErr || !hostUser?.user) throw new Error(`Failed to create host: ${hostErr?.message}`);

  const { data: tournament, error: tErr } = await admin.from("tournaments").insert({
    name: `E2E ${Date.now()}`, host_id: hostUser.user.id,
    has_started: true, n_rounds: 3, current_round: 2, max_score: 5,
  }).select().single();
  if (tErr || !tournament) throw new Error(`Failed to create tournament: ${tErr?.message}`);

  const { data: parts, error: pErr } = await admin.from("participants").insert([
    { tournament_id: tournament.id, name: "Alice" },
    { tournament_id: tournament.id, name: "Bob" },
    { tournament_id: tournament.id, name: "Carol" },
    { tournament_id: tournament.id, name: "Dave" },
  ]).select();
  if (pErr || !parts) throw new Error(`Failed to create participants: ${pErr?.message}`);

  await admin.from("matches").insert([
    { tournament_id: tournament.id, round: 1, match_order: 1,
      player1_id: parts[0].id, player2_id: parts[1].id,
      player1_score: 5, player2_score: 0,
      winner_id: parts[0].id, is_tie: false },
    { tournament_id: tournament.id, round: 1, match_order: 2,
      player1_id: parts[2].id, player2_id: parts[3].id,
      player1_score: 5, player2_score: 2,
      winner_id: parts[2].id, is_tie: false },
  ]);

  await admin.from("rounds").insert({
    tournament_id: tournament.id, round_number: 1, is_completed: true,
  });

  return {
    tournamentId: tournament.id,
    hostEmail, hostPassword,
    participantIds: parts.map(p => p.id),
  };
}

export async function cleanupTournament(seed: SeededTournament) {
  if (!admin) return;
  const client = admin;
  await client.from("tournaments").delete().eq("id", seed.tournamentId);
  // Best-effort user cleanup. The admin.auth.admin API doesn't expose getUserByEmail
  // on all SDK versions; if it's missing, the test users accumulate harmlessly.
  try {
    const result = await client.auth.admin.listUsers();
    if (!result.error) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const users = (result.data as any).users as Array<{ id: string; email?: string }>;
      const user = users.find(u => u.email === seed.hostEmail);
      if (user) await client.auth.admin.deleteUser(user.id);
    }
  } catch {
    // ignore
  }
}
