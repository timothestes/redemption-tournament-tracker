/**
 * Tournament Pairing Utilities
 * 
 * This module contains functions for creating tournament pairings,
 * including Swiss-style tournament logic.
 */
import { createClient } from "../supabase/client";

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
 * Gets previous matches to identify rematches to avoid
 */
export const getPreviousMatchData = async (client, tournamentId: string, round: number) => {
  // Retrieve all previous matches to avoid rematches from any round
  const { data: previousMatches, error: matchError } = await client
    .from("matches")
    .select("player1_id, player2_id, round")
    .eq("tournament_id", tournamentId)
    .lt("round", round); // Get matches from all previous rounds
    
  if (matchError) {
    console.error("Error fetching previous matches:", matchError);
    throw matchError;
  }

  // Get previous byes to avoid giving byes to the same player
  const { data: previousByes, error: byeError } = await client
    .from("byes")
    .select("participant_id, round_number")
    .eq("tournament_id", tournamentId)
    .lt("round_number", round);

  if (byeError) {
    console.error("Error fetching previous byes:", byeError);
    throw byeError;
  }

  // Create a map to track how many byes each player has received
  const byeCount = new Map();
  previousByes?.forEach(bye => {
    const id = bye.participant_id;
    byeCount.set(id, (byeCount.get(id) || 0) + 1);
  });
  
  // Build a set of played matchups (both directions)
  const playedMatchups = new Set();
  const latestRoundPlayed = new Map(); // To track which players played each other most recently
  
  previousMatches.forEach(match => {
    const pair1 = `${match.player1_id}-${match.player2_id}`;
    const pair2 = `${match.player2_id}-${match.player1_id}`;
    
    playedMatchups.add(pair1);
    playedMatchups.add(pair2);
    
    // Track the most recent round these players played against each other
    if (!latestRoundPlayed.has(pair1) || latestRoundPlayed.get(pair1) < match.round) {
      latestRoundPlayed.set(pair1, match.round);
      latestRoundPlayed.set(pair2, match.round);
    }
  });

  return {
    playedMatchups,
    latestRoundPlayed,
    byeCount
  };
};

/**
 * Selects a player to receive a bye based on standings and previous byes
 */
export const selectByePlayer = (sortedPlayers, byeCount) => {
  // Find players who haven't had a bye yet, starting from the bottom of the standings
  const reverseRankedPlayers = [...sortedPlayers].reverse();
  
  // First, try to find a player with no previous byes
  let candidatesWithoutByes = reverseRankedPlayers.filter(p => !byeCount.has(p.id));
  
  if (candidatesWithoutByes.length > 0) {
    return candidatesWithoutByes[0]; // Take the lowest ranked player without a previous bye
  } else {
    // If everyone has had at least one bye, find the player with the fewest byes
    // Sort by bye count (ascending), then by match points (ascending), then by differential (ascending)
    reverseRankedPlayers.sort((a, b) => {
      const aCount = byeCount.get(a.id) || 0;
      const bCount = byeCount.get(b.id) || 0;
      
      if (aCount !== bCount) return aCount - bCount;
      if ((a.match_points || 0) !== (b.match_points || 0)) return (a.match_points || 0) - (b.match_points || 0);
      return (a.differential || 0) - (b.differential || 0);
    });
    
    return reverseRankedPlayers[0];
  }
};

/**
 * Generates all valid pairings for the tournament round
 */
export const generateValidPairings = (sortedPlayers, playedMatchups) => {
  const allValidPairings = [];
  
  // Generate all possible pairs that haven't already played each other
  for (let i = 0; i < sortedPlayers.length; i++) {
    for (let j = i + 1; j < sortedPlayers.length; j++) {
      const player1 = sortedPlayers[i];
      const player2 = sortedPlayers[j];
      const pairKey = `${player1.id}-${player2.id}`;
      
      // Only consider pairs that haven't played before
      if (!playedMatchups.has(pairKey)) {
        allValidPairings.push({
          player1,
          player2,
          scoreDifference: Math.abs((player1.match_points || 0) - (player2.match_points || 0)),
          combinedPoints: (player1.match_points || 0) + (player2.match_points || 0),
          rankDifference: j - i // Position difference in standings
        });
      }
    }
  }
  
  // Sort valid pairings prioritizing:
  // 1. Smallest score difference (pair players with similar scores)
  // 2. Highest combined points (prioritize top tables)
  // 3. Smallest rank difference (avoid "jumping" too many positions)
  allValidPairings.sort((a, b) => {
    // First prioritize close score matches
    if (a.scoreDifference !== b.scoreDifference) {
      return a.scoreDifference - b.scoreDifference;
    }
    
    // Then prioritize higher tables
    if (a.combinedPoints !== b.combinedPoints) {
      return b.combinedPoints - a.combinedPoints;
    }
    
    // Finally, prefer pairing players close in rank
    return a.rankDifference - b.rankDifference;
  });
  
  return allValidPairings;
};

/**
 * Generate fallback pairings when valid pairings aren't available
 * (allows rematches when necessary)
 */
export const generateFallbackPairings = (unpairedPlayers, playedMatchups, latestRoundPlayed) => {
  // Create a matrix of ALL remaining pairs (including rematches)
  const remainingPairOptions = [];
  
  for (let i = 0; i < unpairedPlayers.length; i++) {
    for (let j = i + 1; j < unpairedPlayers.length; j++) {
      const player1 = unpairedPlayers[i];
      const player2 = unpairedPlayers[j];
      const pairKey = `${player1.id}-${player2.id}`;
      
      remainingPairOptions.push({
        player1,
        player2,
        isRematch: playedMatchups.has(pairKey),
        lastPlayedRound: latestRoundPlayed.get(pairKey) || 0,
        scoreDifference: Math.abs((player1.match_points || 0) - (player2.match_points || 0)),
        combinedPoints: (player1.match_points || 0) + (player2.match_points || 0)
      });
    }
  }
  
  // Sort remaining options to minimize impact of rematches
  remainingPairOptions.sort((a, b) => {
    // First prioritize non-rematches
    if (a.isRematch !== b.isRematch) {
      return a.isRematch ? 1 : -1;
    }
    
    // Then prioritize rematches from earlier rounds
    if (a.isRematch && b.isRematch && a.lastPlayedRound !== b.lastPlayedRound) {
      return a.lastPlayedRound - b.lastPlayedRound;
    }
    
    // Then prioritize close score matches
    if (a.scoreDifference !== b.scoreDifference) {
      return a.scoreDifference - b.scoreDifference;
    }
    
    // Finally prioritize higher tables
    return b.combinedPoints - a.combinedPoints;
  });
  
  return remainingPairOptions;
};

/**
 * Creates Swiss-style pairings for subsequent rounds
 */
export const createLaterRoundPairings = async (client, tournamentId: string, round: number) => {
  try {
    // 1. Fetch participants sorted by match_points (desc) and differential (desc)
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
    
    // 2. Use the sorted list of players
    let sortedPlayers = [...participants];
    
    // Debug output for top standings only
    console.log(`Creating pairings for round ${round} with ${sortedPlayers.length} players`);
    
    // 3. Get previous match data to avoid rematches
    const { playedMatchups, latestRoundPlayed, byeCount } = await getPreviousMatchData(client, tournamentId, round);

    // 4. If odd number of players, identify suitable bye candidate
    let byePlayer = null;
    if (sortedPlayers.length % 2 !== 0) {
      byePlayer = selectByePlayer(sortedPlayers, byeCount);
      
      // Remove the bye player from the pairing pool
      sortedPlayers = sortedPlayers.filter(p => p.id !== byePlayer.id);
    }
    
    // 5. Generate all valid pairings (no rematches)
    const allValidPairings = generateValidPairings(sortedPlayers, playedMatchups);
    
    // 6. Use a greedy algorithm to select pairings
    const matches = [];
    const assignedPlayers = new Set();
    
    // First, try to assign the highest tables possible
    for (const pairing of allValidPairings) {
      if (assignedPlayers.has(pairing.player1.id) || assignedPlayers.has(pairing.player2.id)) {
        continue; // Skip if either player is already paired
      }
      
      // Create a match with these players
      matches.push({
        tournament_id: tournamentId,
        round: round,
        player1_id: pairing.player1.id,
        player2_id: pairing.player2.id,
        player1_score: null,
        player2_score: null,
        player1_match_points: pairing.player1.match_points || 0,
        player2_match_points: pairing.player2.match_points || 0,
        differential: pairing.player1.differential || 0,
        differential2: pairing.player2.differential || 0,
        match_order: 0 // Will be set after all matches are created
      });
      
      // Mark these players as used
      assignedPlayers.add(pairing.player1.id);
      assignedPlayers.add(pairing.player2.id);
    }
    
    // 7. Check if any players weren't paired (should only happen if there are no valid pairings)
    const unpairedPlayers = sortedPlayers.filter(p => !assignedPlayers.has(p.id));
    
    if (unpairedPlayers.length > 0) {
      console.log(`${unpairedPlayers.length} players need rematches`);
      
      // Generate fallback pairings (including rematches if necessary)
      const remainingPairOptions = generateFallbackPairings(unpairedPlayers, playedMatchups, latestRoundPlayed);
      
      // Pair remaining players
      const finallyAssignedPlayers = new Set();
      for (const pairing of remainingPairOptions) {
        if (finallyAssignedPlayers.has(pairing.player1.id) || finallyAssignedPlayers.has(pairing.player2.id)) {
          continue;
        }
        
        matches.push({
          tournament_id: tournamentId,
          round: round,
          player1_id: pairing.player1.id,
          player2_id: pairing.player2.id,
          player1_score: null,
          player2_score: null,
          player1_match_points: pairing.player1.match_points || 0,
          player2_match_points: pairing.player2.match_points || 0,
          differential: pairing.player1.differential || 0,
          differential2: pairing.player2.differential || 0,
          match_order: 0 // Will be set after all matches are created
        });
        
        finallyAssignedPlayers.add(pairing.player1.id);
        finallyAssignedPlayers.add(pairing.player2.id);
      }
      
      // Handle any remaining odd player (should be at most one)
      const stillUnpaired = unpairedPlayers.filter(p => !finallyAssignedPlayers.has(p.id));
      if (stillUnpaired.length === 1 && !byePlayer) {
        byePlayer = stillUnpaired[0];
      } else if (stillUnpaired.length > 1) {
        console.error(`ERROR: Multiple unpaired players remain: ${stillUnpaired.map(p => p.name).join(', ')}`);
      }
    }
    
    // Handle any remaining odd player from original set (should be at most one)
    const unpairedFromMainSet = sortedPlayers.filter(p => !assignedPlayers.has(p.id));
    if (unpairedFromMainSet.length === 1 && !byePlayer) {
      byePlayer = unpairedFromMainSet[0];
    }
    
    // 8. Order matches by the highest combined match points (descending)
    matches.sort((a, b) => {
      const combinedA = (a.player1_match_points || 0) + (a.player2_match_points || 0);
      const combinedB = (b.player1_match_points || 0) + (b.player2_match_points || 0);
      return combinedB - combinedA;
    });
    
    // 9. Assign match_order based on sorted order
    matches.forEach((match, index) => {
      match.match_order = index + 1;
    });
    
    // 10. Assign bye if applicable
    if (byePlayer) {
      await assignBye(client, tournamentId, round, byePlayer.id);
    }
    
    // 11. Insert the matches into the database
    if (matches.length > 0) {
      console.log(`Created ${matches.length} matches for round ${round}`);
      const { error: insertError } = await client.from("matches").insert(matches);
      if (insertError) {
        console.error("Error inserting matches:", insertError);
      }
    }
  } catch (error) {
    console.error("Error in createLaterRoundPairings:", error);
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
    // Later rounds pair by match points and avoid rematches
    else {
      await createLaterRoundPairings(client, tournamentId, round);
    }
    return true;
  } catch (error) {
    console.error("Error creating pairings:", error);
    return false;
  }
};