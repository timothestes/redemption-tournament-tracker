"use client";

import { Button } from "flowbite-react";
import { useCallback, useEffect, useState } from "react";
import { HiPencil } from "react-icons/hi";
import CountdownTimer from "../../../../components/ui/CountdownTimer";
import EditParticipantModal from "../../../../components/ui/EditParticipantModal";
import EditTournamentNameModal from "../../../../components/ui/EditTournamentNameModal";
import TournamentStartModal from "../../../../components/ui/TournamentStartModal";
import TournamentTabs from "../../../../components/ui/TournamentTabs";
import Breadcrumb from "../../../../components/ui/breadcrumb";
import ToastNotification from "../../../../components/ui/toast-notification";
import { createClient } from "../../../../utils/supabase/client";
import { suggestNumberOfRounds } from "../../../../utils/tournamentUtils";

const supabase = createClient();

export default function TournamentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const [participants, setParticipants] = useState([]);
  const [tournament, setTournament] = useState<any>(null);
  const [currentParticipant, setCurrentParticipant] = useState<any>(null);
  const [newParticipantName, setNewParticipantName] = useState<string>("");
  const [isEditTournamentModalOpen, setIsEditTournamentModalOpen] =
    useState<boolean>(false);
  const [activeTab, setActiveTab] = useState(0);
  const [isEditParticipantModalOpen, setIsEditParticipantModalOpen] =
    useState<boolean>(false);
  const [newMatchPoints, setNewMatchPoints] = useState<string>("");
  const [newDifferential, setNewDifferential] = useState<string>("");
  const [newDroppedOut, setNewDroppedOut] = useState<boolean>(false);
  const [loading, setLoading] = useState(true);
  const [id, setId] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newTournamentName, setNewTournamentName] = useState("");
  const [showStartModal, setShowStartModal] = useState(false);
  const [isRoundActive, setIsRoundActive] = useState(false);
  const [matchErrorIndex, setMatchErrorIndex] = useState<number[]>([])
  const [toast, setToast] = useState<{
    message: string;
    show: boolean;
    type?: "success" | "error";
  }>({
    message: "",
    show: false,
    type: "success",
  });

  const [latestRound, setLatestRound] = useState<any>(null);

  const showToast = (
    message: string,
    type: "success" | "error" = "success"
  ) => {
    setToast({ message, show: true, type });
    setTimeout(() => setToast((prev) => ({ ...prev, show: false })), 2000);
  };

  useEffect(() => {
    const unwrapParams = async () => {
      try {
        const resolvedParams = await params;
        setId(resolvedParams.id);
      } catch (error) {
        console.error("Error resolving params:", error);
      }
    };
    unwrapParams();
  }, [params]);

  const handleAddParticipant = async (name: string) => {
    if (!name.trim()) return;
    try {
      const { error } = await supabase
        .from("participants")
        .insert([{ name, tournament_id: id }]);
      if (error) throw error;
      fetchParticipants();
      showToast("Participant added successfully!", "success");
    } catch (error) {
      showToast("Error adding participant.", "error");
      console.error("Error adding participant:", error);
    } finally {
      setIsModalOpen(false);
    }
  };

  const fetchTournamentDetails = async () => {
    try {
      const { data, error } = await supabase
        .from("tournaments")
        .select("*")
        .eq("id", id)
        .single();
      if (error) throw error;
      setTournament(data);
    } catch (error) {
      console.error("Error fetching tournament details:", error);
    }
  };

  const fetchParticipants = async () => {
    if (!id) return;
    try {
      const { data, error } = await supabase
        .from("participants")
        .select("*")
        .eq("tournament_id", id)
        .order("match_points", { ascending: false });
      if (error) throw error;
      setParticipants(data);
    } catch (error) {
      console.error("Error fetching participants:", error);
    } finally {
      setLoading(false);
    }
  };

  const updateParticipant = async () => {
    if (!currentParticipant || !newParticipantName.trim()) return;

    const updateData: {
      name?: string;
      match_points?: number;
      differential?: number;
      dropped_out?: boolean;
    } = {
      name: newParticipantName,
      dropped_out: newDroppedOut,
    };

    if (newMatchPoints !== "") {
      updateData.match_points = Number(newMatchPoints);
    }

    if (newDifferential !== "") {
      updateData.differential = Number(newDifferential);
    }

    try {
      const { error } = await supabase
        .from("participants")
        .update(updateData)
        .eq("id", currentParticipant.id);

      if (error) throw error;

      fetchParticipants();
      setIsEditParticipantModalOpen(false);
      showToast("Participant updated successfully!", "success");
    } catch (error) {
      showToast("Error updating participant.", "error");
      console.error("Error updating participant:", error);
    }
  };

  const deleteParticipant = async (id: string) => {
    try {
      const { error } = await supabase
        .from("participants")
        .delete()
        .eq("id", id);
      if (error) throw error;
      fetchParticipants();
      showToast("Participant deleted successfully!", "error");
    } catch (error) {
      showToast("Error deleting participant.", "error");
      console.error("Error deleting participant:", error);
    }
  };

  const handleTournamentStatusToggle = async () => {
    if (!tournament) {
      showToast("Tournament is not available yet.", "error");
      return;
    }

    if (!tournament.has_started) {
      setShowStartModal(true);
      return;
    }

    // Handle tournament end
    const now = new Date().toISOString();
    if (latestRound && !latestRound?.is_completed) {
      const client = await createClient();

      const { data, error } = await client
        .from("matches")
        .select(
          "id, player1_match_points, player2_match_points, differential, differential2,  player1_id:participants!matches_player1_id_fkey(name,id), player2_id:participants!matches_player2_id_fkey(name,id), player2_id, player1_score, player2_score"
        )
        .eq("tournament_id", tournament.id)
        .eq("round", latestRound.round_number)
        .order("id", { ascending: true });

      if (error) throw error;

      const { data: byeData, error: byeError } = await client
        .from("byes")
        .select(
          "id, participant_id:participants(id, name), match_points, differential"
        )
        .eq("tournament_id", tournament.id)
        .eq("round_number", latestRound.round_number)
        .order("id", { ascending: true });

      if (byeError) throw byeError;

      handleEndRound(data, setMatchErrorIndex, byeData, latestRound.round_number);
    }
    try {
      const { data, error } = await supabase
        .from("tournaments")
        .update({
          has_ended: true,
          ended_at: now,
        })
        .eq("id", id)
        .select("*")
        .single();
      if (error) throw error;
      setTournament(data);
      showToast("Tournament ended successfully!", "success");
    } catch (error) {
      showToast("Error updating tournament status.", "error");
      console.error("Error updating tournament status:", error);
    }
  };

  const handleEndRound = useCallback(async (matches: any[], setMatchErrorIndex: any, byes: any[], round: number) => {
    const client = createClient();

    let matchErrorIndexArr = [];

    const now = new Date().toISOString();

    // Checking if the user has not added the score
    matches.forEach((match, index) => {
      if (match.player1_score === null || match.player2_score === null) {
        setMatchErrorIndex((matchErrorIndex) => [...matchErrorIndex, index]);
        matchErrorIndexArr.push(index);
      }
    });

    if (matchErrorIndexArr.length > 0) {
      alert("Please add scores to all matches.");
      return;
    }

    try {
      const now = new Date().toISOString();

      // Updating the matches
      for (const match of matches) {
        // Fetch Participant 1
        const { error: participant1SelectError, data: participant1 } = await client
          .from("participants")
          .select()
          .eq("id", match.player1_id.id)
          .single();
        if (participant1SelectError) throw participant1SelectError;

        // Fetch Participant 2
        const { error: participant2SelectError, data: participant2 } = await client
          .from("participants")
          .select()
          .eq("id", match.player2_id.id)
          .single();
        if (participant2SelectError) throw participant2SelectError;

        if (match.player2_score === match.player1_score) {
          // Draw: Both get 1.5 points
          await Promise.all([
            client.from("participants").update({
              match_points: (participant1.match_points || 0) + 1.5,
              differential: (match.differential || 0) + (participant1.differential || 0),
            }).eq("id", match.player1_id.id),

            client.from("participants").update({
              match_points: (participant2.match_points || 0) + 1.5,
              differential: (match.differential2 || 0) + (participant2.differential || 0),
            }).eq("id", match.player2_id.id),
          ]);

        } else if (match.player1_score === tournament.max_score) {
          // Player 1 Wins (3 points), Player 2 gets 0
          await Promise.all([
            client.from("participants").update({
              match_points: (participant1.match_points || 0) + 3,
              differential: (match.player1_score - match.player2_score) + (participant1.differential || 0),
            }).eq("id", match.player1_id.id),

            client.from("participants").update({
              match_points: (participant2.match_points || 0),
              differential: (match.player2_score - match.player1_score) + (participant2.differential || 0),
            }).eq("id", match.player2_id.id),
          ]);

        } else if (match.player2_score === tournament.max_score) {
          // Player 2 Wins (3 points), Player 1 gets 0
          await Promise.all([
            client.from("participants").update({
              match_points: (participant2.match_points || 0) + 3,
              differential: (match.player2_score - match.player1_score) + (participant2.differential || 0),
            }).eq("id", match.player2_id.id),

            client.from("participants").update({
              match_points: (participant1.match_points || 0),
              differential: (match.player1_score - match.player2_score) + (participant1.differential || 0),
            }).eq("id", match.player1_id.id),
          ]);

        } else if (match.player1_score > match.player2_score) {
          // Player 1 Wins (2 points), Player 2 gets 0
          await Promise.all([
            client.from("participants").update({
              match_points: (participant1.match_points || 0) + 2,
              differential: (match.player1_score - match.player2_score) + (participant1.differential || 0),
            }).eq("id", match.player1_id.id),

            client.from("participants").update({
              match_points: (participant2.match_points || 0) + 1,
              differential: (match.player2_score - match.player1_score) + (participant2.differential || 0),
            }).eq("id", match.player2_id.id),
          ]);

        } else if (match.player2_score > match.player1_score) {
          // Player 2 Wins (2 points), Player 1 gets 0
          await Promise.all([
            client.from("participants").update({
              match_points: (participant2.match_points || 0) + 2,
              differential: (match.player2_score - match.player1_score) + (participant2.differential || 0),
            }).eq("id", match.player2_id.id),

            client.from("participants").update({
              match_points: (participant1.match_points || 0) + 1,
              differential: (match.player1_score - match.player2_score) + (participant1.differential || 0),
            }).eq("id", match.player1_id.id),
          ]);
        }
      }

      // Updating byes
      if (byes && byes.length > 0) {
        byes.forEach(async (bye) => {
          // Updating the participant match_points
          const { error: participantUpdateError } = await client.from("participants").update({
            match_points: (bye.match_points ?? 0),
            differential: (bye.differential ?? 0),
          }).eq("id", bye.participant_id.id);
          if (participantUpdateError) console.log(participantUpdateError);
        })
      }

      // Update the database
      const { error: roundError, data: roundData } = await client
        .from("rounds")
        .update({
          ended_at: now,
          is_completed: true,
        })
        .eq("tournament_id", tournament.id)
        .eq("round_number", round);

      if (roundError) throw roundError;

      if (round === tournament.n_rounds) {
        const { error: tournamentError } = await client
          .from("tournaments")
          .update({
            has_ended: true,
            ended_at: now,
          })
          .eq("id", tournament.id);

        if (tournamentError) throw tournamentError;

        setTournament((prev) => ({
          ...prev,
          has_ended: true,
        }));

        fetchTournamentDetails();
      } else {
        // Creating the pairing for the next round
        await createPairing(round + 1);

        const { error: tournamentError } = await client
          .from("tournaments")
          .update({
            current_round: (tournament.current_round || 0) + 1,
          })
          .eq("id", tournament.id);

        if (tournamentError) throw tournamentError;
      }

      // Update local state after successful database updates
      setIsRoundActive(false);
      setLatestRound((prev) => ({ ...prev, round_number: round, ended_at: now }));
    } catch (error) {
      console.error("Error ending round:", error);
    }
  }, []);

  const handleStartTournament = async (
    numberOfRounds: number,
    roundLength: number,
    maxScore: number,
    byePoints: number,
    byeDifferential: number
  ) => {
    const now = new Date().toISOString();
    try {
      const { data, error } = await supabase
        .from("tournaments")
        .update({
          has_started: true,
          has_ended: false,
          started_at: now,
          ended_at: null,
          n_rounds: numberOfRounds,
          current_round: 1,
          round_length: roundLength,
          max_score: maxScore,
          bye_points: byePoints,
          bye_differential: byeDifferential,
        })
        .eq("id", id)
        .select("*")
        .single();
      if (error) throw error;
      setTournament(data);
      setShowStartModal(false);
      // Creating pairing for the first round if the user has started the tournament.
      await createPairing(1);
      setActiveTab(1);
      showToast("Tournament started successfully!", "success");
    } catch (error) {
      showToast("Error starting tournament.", "error");
      console.error("Error starting tournament:", error);
    }
  };

  /**
 * Creates pairings for a Swiss tournament round
 * @param round - Current tournament round number
 */
  const createPairing = async (round: number) => {
    // Initialize database client
    const client = await createClient();

    // First round uses random pairings
    if (round === 1) {
      await handleRoundOnePairings(client, tournament.id, round);
    }
    // Later rounds pair by match points and avoid rematches
    else {
      await handleLaterRoundPairings(client, tournament.id, round);
    }
  };

  /**
   * Creates random pairings for the first round
   */
  const handleRoundOnePairings = async (client, tournamentId, round) => {
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
    // Create a copy of participants to work with
    let remainingPlayers = [...participants];
    let matches = [];

    // Create random pairings until 0-1 players remain
    while (remainingPlayers.length > 1) {
      // Select two random players
      const index1 = Math.floor(Math.random() * remainingPlayers.length);
      let index2 = Math.floor(Math.random() * remainingPlayers.length);

      // Ensure we don't select the same player twice
      while (index1 === index2) {
        index2 = Math.floor(Math.random() * remainingPlayers.length);
      }

      // Get the two randomly selected players
      const player1 = remainingPlayers[index1];
      const player2 = remainingPlayers[index2];

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

      // Remove these players from the pool (remove higher index first to avoid shifting)
      if (index1 > index2) {
        remainingPlayers.splice(index1, 1);
        remainingPlayers.splice(index2, 1);
      } else {
        remainingPlayers.splice(index2, 1);
        remainingPlayers.splice(index1, 1);
      }
    }

    // Handle odd number of players (assign a bye)
    if (remainingPlayers.length > 0) {
      const byePlayer = remainingPlayers[0];
      await assignBye(client, tournamentId, round, byePlayer.id);
    }

    // Insert matches into database
    if (matches.length > 0) {
      const { error: matchError } = await client.from("matches").insert(matches);
      if (matchError) {
        console.error("Error inserting matches:", matchError);
      }
    }
  };


  /**
   * Creates pairings for rounds after the first round
   * Uses Swiss pairing principles: prioritize match point grouping
   * and only cross score groups when necessary to avoid rematches
   */
  const handleLaterRoundPairings = async (client, tournamentId, round) => {
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
      
      // 3. Retrieve all previous matches to avoid rematches from any round
      const { data: previousMatches, error: matchError } = await client
        .from("matches")
        .select("player1_id, player2_id")
        .eq("tournament_id", tournamentId)
        .lt("round", round); // Get matches from all previous rounds
        
      if (matchError) {
        console.error("Error fetching previous matches:", matchError);
        return;
      }
      
      // Build a set of played matchups (both directions)
      const playedMatchups = new Set();
      previousMatches.forEach(match => {
        playedMatchups.add(`${match.player1_id}-${match.player2_id}`);
        playedMatchups.add(`${match.player2_id}-${match.player1_id}`);
      });
      
      // 4. If odd number of players, remove the lowest-ranked for a bye
      let byePlayer = null;
      if (sortedPlayers.length % 2 !== 0) {
        byePlayer = sortedPlayers.pop();
      }
      
      // 5. Group players by match points
      const playersByMatchPoints = new Map();
      for (const player of sortedPlayers) {
        const matchPoints = player.match_points || 0;
        if (!playersByMatchPoints.has(matchPoints)) {
          playersByMatchPoints.set(matchPoints, []);
        }
        playersByMatchPoints.get(matchPoints).push(player);
      }
      
      // 6. Create pairings within each match point group first
      const matches = [];
      const assignedPlayers = new Set();
      
      // First pass: Try to pair within same match point groups
      for (const [matchPoints, players] of playersByMatchPoints.entries()) {
        // Skip if there's only 1 player in this group (will be handled in the second pass)
        if (players.length <= 1) continue;
        
        // Try to find as many valid pairings within this match point group as possible
        for (let i = 0; i < players.length; i++) {
          // Skip if this player already has a match
          if (assignedPlayers.has(players[i].id)) continue;
          
          let player1 = players[i];
          let foundMatch = false;
          
          // Look for a valid opponent in the same score group
          for (let j = i + 1; j < players.length; j++) {
            if (assignedPlayers.has(players[j].id)) continue;
            
            let potentialOpponent = players[j];
            const pairKey = `${player1.id}-${potentialOpponent.id}`;
            
            // Check if they haven't played each other before
            if (!playedMatchups.has(pairKey)) {
              // Valid match found!
              matches.push({
                tournament_id: tournamentId,
                round: round,
                player1_id: player1.id,
                player2_id: potentialOpponent.id,
                player1_score: null,
                player2_score: null,
                player1_match_points: player1.match_points || 0,
                player2_match_points: potentialOpponent.match_points || 0,
                differential: player1.differential || 0,
                differential2: potentialOpponent.differential || 0,
                match_order: matches.length + 1
              });
              
              assignedPlayers.add(player1.id);
              assignedPlayers.add(potentialOpponent.id);
              foundMatch = true;
              break;
            }
          }
          
          // If no valid opponent in the same score group, we'll handle in the second pass
          if (!foundMatch) {
            console.log(`Could not find a valid opponent in the same score group for ${player1.name}`);
          }
        }
      }
      
      // Second pass: Handle players who couldn't be paired in their own match point group
      const unassignedPlayers = sortedPlayers.filter(p => !assignedPlayers.has(p.id));
      
      if (unassignedPlayers.length > 0) {
        console.log(`${unassignedPlayers.length} players need cross-score group pairing to avoid rematches`);
        
        // For each unassigned player, try to find the best opponent from other score groups
        for (let i = 0; i < unassignedPlayers.length; i++) {
          // Skip if this player was already assigned in this loop
          if (assignedPlayers.has(unassignedPlayers[i].id)) continue;
          
          let player1 = unassignedPlayers[i];
          let bestOpponentIndex = -1;
          let bestScoreDifference = Infinity;
          
          // Try to find the closest valid opponent by match points
          for (let j = 0; j < unassignedPlayers.length; j++) {
            if (i === j || assignedPlayers.has(unassignedPlayers[j].id)) continue;
            
            let potentialOpponent = unassignedPlayers[j];
            const pairKey = `${player1.id}-${potentialOpponent.id}`;
            
            // Check if they haven't played each other before
            if (!playedMatchups.has(pairKey)) {
              const scoreDifference = Math.abs(
                (player1.match_points || 0) - (potentialOpponent.match_points || 0)
              );
              
              // Find the opponent with the closest match points
              if (scoreDifference < bestScoreDifference) {
                bestOpponentIndex = j;
                bestScoreDifference = scoreDifference;
              }
            }
          }
          
          // If found a valid opponent
          if (bestOpponentIndex !== -1) {
            const opponent = unassignedPlayers[bestOpponentIndex];
            
            // Log that we're doing a cross-score pairing
            console.log(
              `Cross-score pairing: ${player1.name} (${player1.match_points} pts) with ${opponent.name} (${opponent.match_points} pts) to avoid rematch`
            );
            
            matches.push({
              tournament_id: tournamentId,
              round: round,
              player1_id: player1.id,
              player2_id: opponent.id,
              player1_score: null,
              player2_score: null,
              player1_match_points: player1.match_points || 0,
              player2_match_points: opponent.match_points || 0,
              differential: player1.differential || 0,
              differential2: opponent.differential || 0,
              match_order: matches.length + 1
            });
            
            assignedPlayers.add(player1.id);
            assignedPlayers.add(opponent.id);
          }
        }
      }
      
      // Third pass: If there are still unassigned players, we have to allow rematches
      const stillUnassignedPlayers = sortedPlayers.filter(p => !assignedPlayers.has(p.id));
      
      if (stillUnassignedPlayers.length > 0) {
        console.warn(`${stillUnassignedPlayers.length} players must be paired with rematches`);
        
        // Sort by match points to ensure we at least preserve match point pairings
        stillUnassignedPlayers.sort((a, b) => 
          (b.match_points || 0) - (a.match_points || 0) || 
          (b.differential || 0) - (a.differential || 0)
        );
        
        for (let i = 0; i < stillUnassignedPlayers.length; i += 2) {
          if (i + 1 >= stillUnassignedPlayers.length) break; // Skip the last player if odd number
          
          let player1 = stillUnassignedPlayers[i];
          let player2 = stillUnassignedPlayers[i + 1];
          
          // This is a forced rematch
          const pairKey = `${player1.id}-${player2.id}`;
          if (playedMatchups.has(pairKey)) {
            console.warn(
              `Forced rematch between ${player1.name} (${player1.id}) and ${player2.name} (${player2.id})`
            );
          }
          
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
      }
      
      // If we have an odd number of remaining players and we haven't assigned a bye yet
      const finalUnassignedPlayers = sortedPlayers.filter(p => !assignedPlayers.has(p.id));
      if (finalUnassignedPlayers.length % 2 !== 0 && !byePlayer) {
        byePlayer = finalUnassignedPlayers[finalUnassignedPlayers.length - 1];
      }
      
      // 7. Assign bye if applicable
      if (byePlayer) {
        await assignBye(client, tournamentId, round, byePlayer.id);
      }
      
      // 8. Insert the matches into the database
      if (matches.length > 0) {
        const { error: insertError } = await client.from("matches").insert(matches);
        if (insertError) {
          console.error("Error inserting matches:", insertError);
        }
      }
    } catch (error) {
      console.error("Error in handleLaterRoundPairings:", error);
    }
  };

  /**
   * Assigns a bye to a player for a round
   * @param client - Database client
   * @param tournamentId - ID of the tournament
   * @param round - Current tournament round
   * @param playerId - ID of the player to receive the bye
   */
  const assignBye = async (client, tournamentId, round, playerId) => {
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

  const dropOutParticipant = async (id: string) => {
    const { error } = await supabase
      .from("participants")
      .update({ dropped_out: true })
      .eq("id", id);
    if (error) {
      console.error("Error dropping participant:", error);

      return false;
    }
    fetchParticipants();
    return true;
  }

  const dropInParticipant = async (id: string) => {
    const { error } = await supabase
      .from("participants")
      .update({ dropped_out: false })
      .eq("id", id);
    if (error) {
      console.error("Error dropping participant:", error);
      return false;
    }
    fetchParticipants();
    return true;
  }

  useEffect(() => {
    if (tournament) {
      (async () => {
        const client = createClient();

        const { data, error } = await client
          .from("rounds")
          .select("round_number, started_at, ended_at, is_completed")
          .eq("tournament_id", tournament.id)
          .eq("round_number", tournament.current_round)
          .single();

        if (data) {
          setLatestRound(data);
          if (!data.is_completed && data.started_at && !data.ended_at) {
            setIsRoundActive(true);
          }
        }
      })();
    }
  }, [tournament]);

  useEffect(() => {
    if (id) {
      fetchTournamentDetails();
      fetchParticipants();

    }
  }, [id]);

  return (
    <div className="flex min-h-screen px-5 w-full">
      <div className="max-w-4xl max-md:max-w-full mx-auto space-y-5">
        <Breadcrumb
          items={[
            { label: "Tournaments", href: "/tracker/tournaments" },
            { label: tournament?.name || "Loading..." },
          ]}
        />
        <ToastNotification
          message={toast.message}
          show={toast.show}
          onClose={() => setToast((prev) => ({ ...prev, show: false }))}
          type={toast.type}
        />
        <div className="flex-grow max-w-4xl mx-auto">
          {tournament && (
            <div className="mb-6">
              <div className="flex items-center gap-2">
                <h1 className="text-3xl font-bold">{tournament.name}</h1>
                <HiPencil
                  onClick={() => {
                    setNewTournamentName(tournament.name);
                    setIsEditTournamentModalOpen(true);
                  }}
                  className="text-gray-500 cursor-pointer hover:text-gray-700 w-6 h-6"
                  aria-label="Edit tournament name"
                />
              </div>
              <EditTournamentNameModal
                isOpen={isEditTournamentModalOpen}
                onClose={() => setIsEditTournamentModalOpen(false)}
                onSave={async () => {
                  try {
                    const { error } = await supabase
                      .from("tournaments")
                      .update({ name: newTournamentName })
                      .eq("id", id);

                    if (error) throw error;

                    setTournament((prev) => ({
                      ...prev,
                      name: newTournamentName,
                    }));
                    setIsEditTournamentModalOpen(false);
                    showToast(
                      "Tournament name updated successfully!",
                      "success"
                    );
                  } catch (error) {
                    console.error("Error updating tournament name:", error);
                    showToast("Error updating tournament name", "error");
                  }
                }}
                tournamentName={newTournamentName}
                setTournamentName={setNewTournamentName}
              />
              <p className="text-sm text-gray-500 mt-2">
                Created on:{" "}
                {new Intl.DateTimeFormat("en-US", {
                  year: "numeric",
                  month: "long",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                }).format(new Date(tournament.created_at))}
              </p>
              {tournament.started_at && (
                <p className="text-sm text-gray-500">
                  Started at:{"\u00A0\u00A0\u00A0"}
                  {new Intl.DateTimeFormat("en-US", {
                    year: "numeric",
                    month: "long",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  }).format(new Date(tournament.started_at))}
                </p>
              )}
              {tournament.ended_at && (
                <p className="text-sm text-gray-500">
                  Ended at:{"\u00A0\u00A0\u00A0\u00A0\u00A0"}
                  {new Intl.DateTimeFormat("en-US", {
                    year: "numeric",
                    month: "long",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  }).format(new Date(tournament.ended_at))}
                </p>
              )}
              {participants.length === 0 && (
                <p className="text-sm text-gray-500 mt-2">
                  To start a tournament, first add some participants
                </p>
              )}
              <div className="flex flex-col gap-4 mt-4">
                <Button
                  disabled={participants.length === 0 || tournament?.has_ended}
                  color={
                    tournament?.has_ended
                      ? "gray"
                      : Boolean(tournament?.has_started)
                        ? "failure"
                        : "success"
                  }
                  onClick={handleTournamentStatusToggle}
                  className="w-fit"
                >
                  {tournament?.has_ended
                    ? "Tournament Ended"
                    : Boolean(tournament?.has_started)
                      ? "End Tournament"
                      : "Start Tournament"}
                </Button>
                {tournament?.has_started &&
                  !tournament?.has_ended &&
                  tournament?.round_length && (
                    <CountdownTimer
                      key={latestRound?.started_at || "inactive"} // Force re-render on start time change
                      startTime={latestRound?.started_at || null}
                      durationMinutes={tournament.round_length}
                    />
                  )}
              </div>
            </div>
          )}
          <TournamentTabs
            key={activeTab}
            participants={participants}
            isModalOpen={isModalOpen}
            setIsModalOpen={setIsModalOpen}
            onAddParticipant={handleAddParticipant}
            onEdit={(participant) => {
              setCurrentParticipant(participant);
              setNewParticipantName(participant.name);
              setNewMatchPoints(participant.match_points?.toString() || "");
              setNewDifferential(participant.differential?.toString() || "");
              setNewDroppedOut(participant.dropped_out || false);
              setIsEditParticipantModalOpen(true);
            }}
            setLatestRound={setLatestRound}
            onDelete={deleteParticipant}
            onDropOut={dropOutParticipant}
            onDropIn={dropInParticipant}
            loading={loading}
            tournamentId={id || ""}
            tournamentStarted={tournament?.has_started || false}
            tournamentEnded={tournament?.has_ended || false}
            onTournamentEnd={fetchTournamentDetails}
            onRoundActiveChange={(isActive, roundStartTime) => {
              setIsRoundActive(isActive);
              fetchTournamentDetails();
            }}
            createPairing={createPairing}
            matchErrorIndex={matchErrorIndex}
            setMatchErrorIndex={setMatchErrorIndex}
            activeTab={activeTab}
            setActiveTab={setActiveTab}
            fetchParticipants={fetchParticipants}
          />
        </div>
        <EditParticipantModal
          isOpen={isEditParticipantModalOpen}
          onClose={() => setIsEditParticipantModalOpen(false)}
          participant={currentParticipant}
          onSave={updateParticipant}
          newParticipantName={newParticipantName}
          setNewParticipantName={setNewParticipantName}
          newMatchPoints={newMatchPoints}
          setNewMatchPoints={setNewMatchPoints}
          newDifferential={newDifferential}
          setNewDifferential={setNewDifferential}
          newDroppedOut={newDroppedOut}
          setNewDroppedOut={setNewDroppedOut}
          isTournamentStarted={tournament?.has_started}
        />
        <TournamentStartModal
          isOpen={showStartModal}
          onClose={() => setShowStartModal(false)}
          onConfirm={handleStartTournament}
          participantCount={participants.length}
          suggestedRounds={suggestNumberOfRounds(participants.length)}
        />
      </div>
    </div>
  );
}
