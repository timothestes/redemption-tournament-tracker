/**
 * Tournament Pairing Utilities
 * 
 * This module contains functions for creating tournament pairings,
 * including Swiss-style tournament logic with improved Swiss pairing algorithm.
 */
import { createClient } from "../supabase/client";
import createSwissPairing, { 
  convertParticipantsToSwissFormat,
  convertMatchesToSwissFormat,
  convertMatchupsToDbFormat,
  type DatabaseParticipant,
} from "./swissPairingUtils";

/**
 * Helper function to shuffle an array randomly (Fisher-Yates algorithm)
 * Used for random round 1 pairings
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
 * @param client - Database client
 * @param tournamentId - ID of the tournament
 * @param round - Current tournament round
 * @param playerId - ID of the player to receive the bye
 */
export const assignBye = async (client, tournamentId: string, round: number, playerId: string) => {
  try {
    // First get the tournament to know how many points to award for a bye
    const { data: tournament, error: tournamentError } = await client
      .from("tournaments")
      .select("bye_points, bye_differential")
      .eq("id", tournamentId)
      .single();

    if (tournamentError) {
      console.error("Error fetching tournament:", tournamentError);
      return;
    }

    const { data: participant, error: participantError } = await client
      .from("participants")
      .select("id, match_points, differential")
      .eq("id", playerId)
      .eq("tournament_id", tournamentId)
      .single();

    if (participantError) {
      console.error("Error fetching participant:", participantError);
      return;
    }

    // Add a bye record for this player using the configured bye points and differential
    const { error: byeError } = await client
      .from("byes")
      .insert({
        tournament_id: tournamentId,
        round_number: round,
        match_points: (participant.match_points || 0) + tournament.bye_points,
        differential: (participant.differential || 0) + (tournament.bye_differential || 0),
        participant_id: playerId
      });

    if (byeError) {
      console.error("Error assigning bye:", byeError);
      return;
    }
  } catch (error) {
    console.error("Error in assignBye:", error);
  }
};

/**
 * Creates random pairings for the first round
 */
export const createFirstRoundPairings = async (client, tournamentId: string, round: number) => {
  try {
    // Get all participants sorted by match points and differential
    const { data: participants, error: participantError } = await client
      .from("participants")
      .select("id, match_points, differential, name")
      .eq("tournament_id", tournamentId)
      .eq("dropped_out", false)
      .order("match_points", { ascending: false })
      .order("differential", { ascending: false });

    if (participantError) {
      console.error("Error fetching participants:", participantError);
      return;
    }
    
    // Create a copy of participants to work with and shuffle them for random pairings
    let remainingPlayers = shuffleArray([...participants]);
    let matches = [];
    
    // Handle odd number of players (assign a bye randomly)
    let byePlayer = null;
    if (remainingPlayers.length % 2 !== 0) {
      // For round 1, assign bye randomly
      const randomIndex = Math.floor(Math.random() * remainingPlayers.length);
      
      // Assign bye to a randomly selected player
      byePlayer = remainingPlayers[randomIndex];
      
      // Remove bye player from pairing pool
      remainingPlayers.splice(randomIndex, 1);
    }
    
    // Create pairings until no players remain
    while (remainingPlayers.length > 1) {
      // Take the first two players (the array is already randomly shuffled)
      const player1 = remainingPlayers.pop();
      const player2 = remainingPlayers.pop();

      // Create a match between these players with a stable match_order
      matches.push({
        tournament_id: tournamentId,
        round: round,
        player1_id: player1.id,
        player2_id: player2.id,
        player1_score: null,
        player2_score: null,
        player1_match_points: player1.match_points || 0,
        player2_match_points: player2.match_points || 0,
        differential: player1.differential || 0,
        differential2: player2.differential || 0,
        match_order: matches.length + 1
      });
    }

    // Verify we've used all players except possibly the bye
    if (remainingPlayers.length > 0 && !byePlayer) {
      console.error(`Error: ${remainingPlayers.length} players left unpaired`);
    }
    
    // Assign bye if applicable
    if (byePlayer) {
      await assignBye(client, tournamentId, round, byePlayer.id);
    }

    // Insert matches into database
    if (matches.length > 0) {
      console.log(`Created ${matches.length} matches for round ${round}`);
      const { error: matchError } = await client.from("matches").insert(matches);
      if (matchError) {
        console.error("Error inserting matches:", matchError);
      }
    }
  } catch (error) {
    console.error("Error creating first round pairings:", error);
  }
};

/**
 * Selects the player who should receive a bye based on custom logic:
 * 1. Lowest match points
 * 2. Among tied players, lowest differential
 * 3. Among players tied on both, prioritize those who haven't had a bye in the previous round (PREVENTS CONSECUTIVE BYES)
 * 4. Among players tied on the above, prioritize those who haven't had any bye
 * 5. If still tied, assign randomly
 */
const selectByePlayer = (participants: any[], previousByes: any[], currentRound: number): string => {
  // Create sets of player IDs who have had byes in different scenarios
  const playersWithPreviousByes = new Set(previousByes.map(bye => bye.participant_id));
  const playersWithRecentBye = new Set(
    previousByes
      .filter(bye => bye.round_number === currentRound - 1) // Only previous round
      .map(bye => bye.participant_id)
  );
  
  // Sort participants by bye assignment priority
  const sortedForBye = [...participants].sort((a, b) => {
    // Primary: match points (ascending - lowest first)
    const matchPointsA = a.match_points || 0;
    const matchPointsB = b.match_points || 0;
    if (matchPointsA !== matchPointsB) {
      return matchPointsA - matchPointsB;
    }
    
    // Secondary: differential (ascending - lowest first)
    const diffA = a.differential || 0;
    const diffB = b.differential || 0;
    if (diffA !== diffB) {
      return diffA - diffB;
    }
    
    // Tertiary: STRONGLY prioritize players who didn't have a bye in the previous round
    const hadRecentByeA = playersWithRecentBye.has(a.id);
    const hadRecentByeB = playersWithRecentBye.has(b.id);
    if (hadRecentByeA !== hadRecentByeB) {
      return hadRecentByeA ? 1 : -1; // Players without recent bye come first
    }
    
    // Quaternary: prioritize players who haven't had any bye (false comes before true when sorted)
    const hadByeA = playersWithPreviousByes.has(a.id);
    const hadByeB = playersWithPreviousByes.has(b.id);
    if (hadByeA !== hadByeB) {
      return hadByeA ? 1 : -1; // Players without any bye come first
    }
    
    // Quinary: random (using player ID as tiebreaker for consistency)
    return a.id.localeCompare(b.id);
  });
  
  const selectedPlayer = sortedForBye[0];
  const hadRecentBye = playersWithRecentBye.has(selectedPlayer.id);
  
  if (hadRecentBye) {
    console.log(`WARNING: Player ${selectedPlayer.id} had a bye in round ${currentRound - 1} but is getting another bye in round ${currentRound}. This may indicate all eligible players had recent byes.`);
  }
  
  return selectedPlayer.id;
};

/**
 * Creates Swiss-style pairings using the improved Swiss pairing algorithm
 */
export const createSwissPairings = async (client, tournamentId: string, round: number) => {
  try {
    // 1. Fetch participants sorted by match_points (desc) and differential (desc) 
    const { data: participants, error: participantError } = await client
      .from("participants")
      .select("id, name, match_points, differential, dropped_out")
      .eq("tournament_id", tournamentId)
      .eq("dropped_out", false)
      .order("match_points", { ascending: false })
      .order("differential", { ascending: false });
    
    if (participantError) {
      console.error("Error fetching participants:", participantError);
      return;
    }

    // 2. Fetch all previous matches for this tournament (including game scores)
    const { data: previousMatches, error: matchError } = await client
      .from("matches")
      .select("round, player1_id, player2_id, player1_score, player2_score, player1_match_points, player2_match_points")
      .eq("tournament_id", tournamentId)
      .lt("round", round);
    
    if (matchError) {
      console.error("Error fetching previous matches:", matchError);
      return;
    }

    // 2b. Fetch all previous byes for this tournament
    const { data: previousByes, error: byeError } = await client
      .from("byes")
      .select("round_number, participant_id, match_points")
      .eq("tournament_id", tournamentId)
      .lt("round_number", round);
    
    if (byeError) {
      console.error("Error fetching previous byes:", byeError);
      return;
    }

    console.log(`Creating Swiss pairings for round ${round} with ${participants.length} players`);

    // 3. Handle bye assignment with custom logic if odd number of players
    let byePlayerId = null;
    let participantsForPairing = participants;
    
    if (participants.length % 2 === 1) {
      // Custom bye assignment logic
      byePlayerId = selectByePlayer(participants, previousByes || [], round);
      console.log(`Selected player ${byePlayerId} for bye`);
      
      // Remove bye player from pairing pool
      participantsForPairing = participants.filter(p => p.id !== byePlayerId);
    }

    // 4. Convert data to Swiss pairing format and combine with bye history
    const swissParticipants = convertParticipantsToSwissFormat(participantsForPairing);
    
    // Only include matches involving current participants (filter out matches with dropped players)
    const participantIds = new Set(participantsForPairing.map(p => p.id));
    const filteredMatches = (previousMatches || []).filter(match => 
      participantIds.has(match.player1_id) && participantIds.has(match.player2_id)
    );
    const swissMatches = convertMatchesToSwissFormat(filteredMatches);
    
    // 4b. Convert bye history to Swiss format (as matches with null opponents)
    // Only include bye matches for players who are still in the tournament (participantsForPairing)
    const byeMatches = (previousByes || [])
      .filter(bye => participantIds.has(bye.participant_id)) // Only include byes for current participants
      .map(bye => ({
        round: bye.round_number,
        player_1: {
          id: bye.participant_id,
          points: bye.match_points || 0
        },
        player_2: {
          id: null as any, // null opponent indicates a bye
          points: 0
        }
      }));
    
    // 4c. Combine regular matches with bye history
    const allMatches = [...swissMatches, ...byeMatches];

    // 5. Create Swiss pairing instance with optimal settings
    const swissPairing = createSwissPairing({
      maxPerRound: 3, // Maximum match points possible (full win = 3 points)
      rematchWeight: 100, // High penalty for rematches
      standingPower: 2, // Quadratic penalty for point differences
      seedMultiplier: 6781, // Randomization seed
      differentialWeight: 0.1 // Weight for differential tiebreaker when points are equal
    });

    // 6. Generate optimal matchups using the Swiss algorithm with combined match history
    const matchups = swissPairing.getMatchups(round, swissParticipants, allMatches);
    
    // 7. Assign bye if we selected one
    if (byePlayerId) {
      await assignBye(client, tournamentId, round, byePlayerId);
    }

    // 8. Convert matchups back to database format
    const participantsMap = new Map<string, DatabaseParticipant>(
      participantsForPairing.map(p => [p.id, p as DatabaseParticipant])
    );
    const dbMatches = convertMatchupsToDbFormat(matchups, tournamentId, round, participantsMap);

    // 9. Insert matches into database
    if (dbMatches.length > 0) {
      console.log(`Created ${dbMatches.length} matches for round ${round}`);
      const { error: insertError } = await client.from("matches").insert(dbMatches);
      if (insertError) {
        console.error("Error inserting matches:", insertError);
      }
    }
  } catch (error) {
    console.error("Error in createSwissPairings:", error);
  }
};

/**
 * Main function to create pairings for a Swiss tournament round
 * @param round - Current tournament round number
 */
export const createPairing = async (tournamentId: string, round: number) => {
  // Initialize database client
  const client = await createClient();

  try {
    // First round uses random pairings
    if (round === 1) {
      await createFirstRoundPairings(client, tournamentId, round);
    }
    // Later rounds use the Swiss pairing algorithm
    else {
      await createSwissPairings(client, tournamentId, round);
    }
    return true;
  } catch (error) {
    console.error("Error creating pairings:", error);
    return false;
  }
};