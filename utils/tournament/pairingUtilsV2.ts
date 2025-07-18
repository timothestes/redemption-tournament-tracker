/**
 * Tournament Pairing Utilities v2
 *
 * This module will contain the revamped Swiss-style pairing logic.
 * Awaiting further instructions to implement specific functions.
 */

import { createClient } from "../supabase/client";
/**
 * Helper function to shuffle an array randomly (Fisher-Yates algorithm)
 */
export const shuffleArray = <T>(array: T[]): T[] => {
  const newArray = [...array];
  for (let i = newArray.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [newArray[i], newArray[j]] = [newArray[j], newArray[i]];
  }
  return newArray;
};

/**
 * Assigns a bye to a player for a round
 */
export const assignBye = async (
  client: any,
  tournamentId: string,
  round: number,
  playerId: string
): Promise<void> => {
  try {
    const { data: tournament, error: tError } = await client
      .from("tournaments")
      .select("bye_points, bye_differential")
      .eq("id", tournamentId)
      .single();
    if (tError || !tournament) return;
    const { data: participant, error: pError } = await client
      .from("participants")
      .select("id, match_points, differential")
      .eq("id", playerId)
      .eq("tournament_id", tournamentId)
      .single();
    if (pError || !participant) return;
    await client.from("byes").insert({
      tournament_id: tournamentId,
      round_number: round,
      match_points: (participant.match_points || 0) + tournament.bye_points,
      differential: (participant.differential || 0) + tournament.bye_differential,
      participant_id: playerId
    });
  } catch (error) {
    console.error("Error in assignBye:", error);
  }
};

/**
 * Retrieves previous matchups and bye counts
 */
export const getPreviousMatchData = async (
  client: any,
  tournamentId: string,
  round: number
): Promise<{ playedMatchups: Set<string>; latestRoundPlayed: Map<string, number>; byeCount: Map<string, number>; }> => {
  const { data: previousMatches = [], error: mError } = await client
    .from("matches")
    .select("player1_id, player2_id, round")
    .eq("tournament_id", tournamentId)
    .lt("round", round);
  if (mError) throw mError;
  const { data: previousByes = [], error: bError } = await client
    .from("byes")
    .select("participant_id, round_number")
    .eq("tournament_id", tournamentId)
    .lt("round_number", round);
  if (bError) throw bError;
  const byeCount = new Map<string, number>();
  previousByes.forEach(b => {
    byeCount.set(b.participant_id, (byeCount.get(b.participant_id) || 0) + 1);
  });
  const playedMatchups = new Set<string>();
  const latestRoundPlayed = new Map<string, number>();
  previousMatches.forEach(m => {
    const key1 = `${m.player1_id}-${m.player2_id}`;
    const key2 = `${m.player2_id}-${m.player1_id}`;
    playedMatchups.add(key1);
    playedMatchups.add(key2);
    const prev = latestRoundPlayed.get(key1) || 0;
    if (m.round > prev) {
      latestRoundPlayed.set(key1, m.round);
      latestRoundPlayed.set(key2, m.round);
    }
  });
  return { playedMatchups, latestRoundPlayed, byeCount };
};

/**
 * Prepares matches for a later round, avoiding rematches and assigning byes as needed.
 * @param client - Database client instance
 * @param tournamentId - ID of the tournament
 * @param round - Current round number
 * @returns Promise resolving to an array of match records (currently empty stub)
 */
export const generateLaterRoundPairings = async (
  client: any,
  tournamentId: string,
  round: number
): Promise<any[]> => {
  try {
    // 1. Fetch sorted participants
    const { data, error } = await client
      .from("participants")
      .select("id, match_points, differential, name")
      .eq("tournament_id", tournamentId)
      .eq("dropped_out", false)
      .order("match_points", { ascending: false })
      .order("differential", { ascending: false });
    if (error || !data) {
      console.error("Error fetching participants for later round v2:", error);
      return [];
    }
    const players: any[] = data as any[];

    // 2. Get previous match and bye data
    const { playedMatchups, latestRoundPlayed, byeCount } = await getPreviousMatchData(
      client,
      tournamentId,
      round
    );

    // 3. Handle bye if odd number
    let pairPool = [...players];
    let byePlayer: any = null;
    if (pairPool.length % 2 !== 0) {
      // First pass: find someone with no byes yet
      byePlayer = [...pairPool]
        .reverse()
        .find(p => !byeCount.has(p.id));
      if (!byePlayer) {
        // Second pass: skip those who got bye last round
        const { data: lastByes } = await client
          .from("byes")
          .select("participant_id")
          .eq("tournament_id", tournamentId)
          .eq("round_number", round - 1);
        const lastByeIds = (lastByes || []).map((b: any) => b.participant_id);
        byePlayer = [...pairPool]
          .reverse()
          .find(p => !lastByeIds.includes(p.id));
      }
      if (byePlayer) {
        await assignBye(client, tournamentId, round, byePlayer.id);
        pairPool = pairPool.filter(p => p.id !== byePlayer.id);
      }
    }

    // 4. Greedy pairing avoiding rematches
    const matches: any[] = [];
    const assigned = new Set<string>();
    for (let i = 0; i < pairPool.length; i++) {
      const p1 = pairPool[i];
      if (assigned.has(p1.id)) continue;
      const p2 = pairPool.slice(i + 1).find(
        p => !assigned.has(p.id) && !playedMatchups.has(`${p1.id}-${p.id}`)
      );
      if (p2) {
        matches.push({ p1, p2 });
        assigned.add(p1.id);
        assigned.add(p2.id);
      }
    }

    // 5. Fallback: pair remaining players
    const unpaired = pairPool.filter(p => !assigned.has(p.id));
    while (unpaired.length > 1) {
      const p1 = unpaired.shift()!;
      const p2 = unpaired.shift()!;
      matches.push({ p1, p2 });
    }
    if (unpaired.length === 1 && !byePlayer) {
      // Assign bye to last player if needed
      await assignBye(client, tournamentId, round, unpaired[0].id);
    }

    // 6. Build and insert match records
    const records = matches.map((m, idx) => ({
      tournament_id: tournamentId,
      round,
      player1_id: m.p1.id,
      player2_id: m.p2.id,
      player1_score: null,
      player2_score: null,
      player1_match_points: m.p1.match_points || 0,
      player2_match_points: m.p2.match_points || 0,
      differential: m.p1.differential || 0,
      differential2: m.p2.differential || 0,
      match_order: idx + 1
    }));
    if (records.length > 0) {
      const { error: insErr } = await client.from("matches").insert(records);
      if (insErr) console.error("Error inserting later-round matches v2:", insErr);
    }
    return records;
  } catch (err) {
    console.error("Error in generateLaterRoundPairings v2:", err);
    return [];
  }
};

/**
 * Creates random pairings for the first round with optional bye assignment.
 * @param client - Database client instance
 * @param tournamentId - ID of the tournament
 * @param round - Current round number
 * @returns Promise resolving to an array of match records (currently empty stub)
 */
export const createFirstRoundPairings = async (
  client: any,
  tournamentId: string,
  round: number
): Promise<any[]> => {
  try {
    // Fetch active participants
    const { data, error } = await client
      .from("participants")
      .select("id, match_points, differential, name")
      .eq("tournament_id", tournamentId)
      .eq("dropped_out", false);
    if (error || !data) {
      console.error("Error fetching participants for first round v2:", error);
      return [];
    }
    // Shuffle for random pairings
    const participants: any[] = data as any[];
    let remaining = shuffleArray(participants);
    const matches: any[] = [];
    // Handle odd number of players: random bye
    let byePlayer = null;
    if (remaining.length % 2 !== 0) {
      const idx = Math.floor(Math.random() * remaining.length);
      byePlayer = remaining.splice(idx, 1)[0];
      // Assign bye record
      await assignBye(client, tournamentId, round, byePlayer.id);
    }
    // Pair off remaining players
    while (remaining.length > 1) {
      const p1 = remaining.pop();
      const p2 = remaining.pop();
      matches.push({
        tournament_id: tournamentId,
        round,
        player1_id: p1.id,
        player2_id: p2.id,
        player1_score: null,
        player2_score: null,
        player1_match_points: p1.match_points || 0,
        player2_match_points: p2.match_points || 0,
        differential: p1.differential || 0,
        differential2: p2.differential || 0,
        match_order: matches.length + 1
      });
    }
    // Insert match records
    if (matches.length > 0) {
      const { error: insertErr } = await client.from("matches").insert(matches);
      if (insertErr) console.error("Error inserting first-round matches v2:", insertErr);
    }
    return matches;
  } catch (err) {
    console.error("Error in createFirstRoundPairings v2:", err);
    return [];
  }
};

/**
 * Main function to create pairings for a Swiss tournament round (v2)
 * @param tournamentId - ID of the tournament
 * @param round - Current round number
 * @returns Promise resolving to a boolean indicating success
 */
export const createPairing = async (
  tournamentId: string,
  round: number
): Promise<boolean> => {
  const client = await createClient();
  try {
    if (round === 1) {
      await createFirstRoundPairings(client, tournamentId, round);
    } else {
      await generateLaterRoundPairings(client, tournamentId, round);
    }
    return true;
  } catch (error) {
    console.error("Error in createPairing v2:", error);
    return false;
  }
};