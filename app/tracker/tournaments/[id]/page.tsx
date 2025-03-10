"use client";

import { useCallback, useEffect, useState } from "react";
import { suggestNumberOfRounds } from "../../../../utils/tournamentUtils";
import TournamentStartModal from "../../../../components/ui/TournamentStartModal";
import Breadcrumb from "../../../../components/ui/breadcrumb";
import { createClient } from "../../../../utils/supabase/client";
import { Button } from "flowbite-react";
import { HiPencil } from "react-icons/hi";
import EditTournamentNameModal from "../../../../components/ui/EditTournamentNameModal";
import TournamentTabs from "../../../../components/ui/TournamentTabs";
import ToastNotification from "../../../../components/ui/toast-notification";
import EditParticipantModal from "../../../../components/ui/EditParticipantModal";
import CountdownTimer from "../../../../components/ui/CountdownTimer";

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
          "id, participant_id:participants(id, name, match_points, differential)"
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

        } else if (match.player1_score === 5) {
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

        } else if (match.player2_score === 5) {
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
            match_points: (bye.participant_id.match_points ?? 0) + 3,
            differential: (bye.participant_id.differential ?? 0),
          }).eq("id", bye.participant_id.id);
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
    roundLength: number
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
      .eq("tournament_id", tournament.id)
      .order('match_points', { ascending: false })
      .order('differential', { ascending: false });

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

      // Make sure we don't select the same player twice
      while (index1 === index2) {
        index2 = Math.floor(Math.random() * remainingPlayers.length);
      }

      // Get the two randomly selected players
      const player1 = remainingPlayers[index1];
      const player2 = remainingPlayers[index2];

      console.log(player1);
      console.log(player2);

      // Create a match between these players
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
      });

      // Remove these players from the pool
      // Remove higher index first to avoid index shifting issues
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
      const { error: matchError } = await client
        .from("matches")
        .insert(matches);

      if (matchError) {
        console.error("Error inserting matches:", matchError);
      }
    }
  };

  /**
   * Creates pairings for rounds after the first round
   * Pairs players based on match points and differential while avoiding rematches
   */
  const handleLaterRoundPairings = async (client, tournamentId, round) => {
    try {
      // Get all participants sorted by match points and differential
      const { data: participants, error: participantError } = await client
        .from("participants")
        .select("id, match_points, differential, name")
        .eq("tournament_id", tournamentId)
        .order('match_points', { ascending: false })
        .order('differential', { ascending: false });

      if (participantError) {
        console.error("Error fetching participants:", participantError);
        return;
      }

      // Check if we have an odd number of players
      const isOddPlayers = participants.length % 2 !== 0;

      // If odd number of players, find the player with lowest match points and differential for a bye
      let byePlayer = null;
      let activePlayers = [...participants];

      if (isOddPlayers) {
        // Sort players by match points (ascending) and differential (ascending)
        // to find the player with the lowest scores
        const sortedForBye = [...participants].sort((a, b) => {
          // Sort by match points (ascending)
          const pointsDiff = (a.match_points || 0) - (b.match_points || 0);
          if (pointsDiff !== 0) return pointsDiff;

          // If match points are tied, sort by differential (ascending)
          const diffDiff = (a.differential || 0) - (b.differential || 0);
          if (diffDiff !== 0) return diffDiff;

          // If both are tied, pick randomly (by returning random -1 or 1)
          return Math.random() > 0.5 ? 1 : -1;
        });

        // The first player in the sorted array will have the lowest match points and differential
        byePlayer = sortedForBye[0];

        // Remove the bye player from active players
        activePlayers = participants.filter(p => p.id !== byePlayer.id);
      }

      // Get previous matches to avoid rematches
      const { data: previousMatches, error: matchError } = await client
        .from("matches")
        .select("player1_id, player2_id")
        .eq("tournament_id", tournamentId)
        .lt("round", round);

      if (matchError) {
        console.error("Error fetching previous matches:", matchError);
        return;
      }

      // Create a set of previously played matchups
      const playedMatchups = new Set();
      previousMatches.forEach(match => {
        // Add both directions to handle either player1 or player2 perspective
        playedMatchups.add(`${match.player1_id}-${match.player2_id}`);
        playedMatchups.add(`${match.player2_id}-${match.player1_id}`);
      });

      // Group players by match points
      const playersByPoints = {};
      activePlayers.forEach(player => {
        const points = player.match_points || 0;
        if (!playersByPoints[points]) {
          playersByPoints[points] = [];
        }
        playersByPoints[points].push(player);
      });

      // Get unique match point values and sort them in descending order
      const pointGroups = Object.keys(playersByPoints)
        .map(Number)
        .sort((a, b) => b - a);

      let matches = [];
      let pairedPlayers = new Set();

      // First attempt to pair within each match point group
      pointGroups.forEach(points => {
        const playersInGroup = playersByPoints[points].filter(
          player => !pairedPlayers.has(player.id)
        );

        // Sort players by differential (already done in the query, but just to be explicit)
        playersInGroup.sort((a, b) => (b.differential || 0) - (a.differential || 0));

        let i = 0;
        while (i < playersInGroup.length) {
          const player1 = playersInGroup[i];
          i++;

          // Skip if player1 is already paired
          if (pairedPlayers.has(player1.id)) continue;

          // Find a valid opponent
          let foundOpponent = false;

          // First try to find an opponent with same match points and similar differential
          for (let j = i; j < playersInGroup.length; j++) {
            const player2 = playersInGroup[j];

            // Skip if player2 is already paired or is the same as player1
            if (pairedPlayers.has(player2.id) || player1.id === player2.id) continue;

            // Check if these players have already played each other
            if (!playedMatchups.has(`${player1.id}-${player2.id}`)) {
              // Create a match
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
              });

              // Mark both players as paired
              pairedPlayers.add(player1.id);
              pairedPlayers.add(player2.id);

              foundOpponent = true;
              break;
            }
          }
        }
      });

      // Handle players who couldn't be paired within their match point group
      // Pair them with players from adjacent match point groups
      const unpaired = activePlayers.filter(player => !pairedPlayers.has(player.id));

      while (unpaired.length > 1) {
        const player1 = unpaired.shift(); // Take the highest ranked unpaired player

        // Find a valid opponent for player1
        let opponentIndex = -1;

        for (let i = 0; i < unpaired.length; i++) {
          const player2 = unpaired[i];

          // Check if these players have already played each other
          if (!playedMatchups.has(`${player1.id}-${player2.id}`)) {
            opponentIndex = i;
            break;
          }
        }

        // If we found a valid opponent
        if (opponentIndex !== -1) {
          const player2 = unpaired[opponentIndex];
          unpaired.splice(opponentIndex, 1); // Remove player2 from unpaired list

          // Create a match
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
          });
        } else {
          // If no valid opponent found, put player1 back in the unpaired list
          // This can happen if all potential pairings would be rematches
          unpaired.push(player1);

          // Break the loop if we couldn't make any progress to avoid infinite loop
          if (unpaired.length === 0 || unpaired.length % 2 === 0) {
            console.warn("Couldn't avoid rematches for all players. Forcing pairings.");

            // Force pairings even if they're rematches
            while (unpaired.length > 1) {
              const p1 = unpaired.shift();
              const p2 = unpaired.shift();

              matches.push({
                tournament_id: tournamentId,
                round: round,
                player1_id: p1.id,
                player2_id: p2.id,
                player1_score: null,
                player2_score: null,
                player1_match_points: p1.match_points || 0,
                player2_match_points: p2.match_points || 0,
                differential: p1.differential || 0,
                differential2: p2.differential || 0,
              });
            }
          }
        }
      }

      // If we still have unpaired players plus the bye player, that's an error
      // We should only have the bye player left if there was an odd number
      if (unpaired.length > 0 && byePlayer) {
        console.error("Error: Have both unpaired players and a bye player");
      }

      // Handle the bye player (should have been determined at the beginning if there was an odd number)
      if (byePlayer) {
        await assignBye(client, tournamentId, round, byePlayer.id);
      }

      // Insert matches into database
      if (matches.length > 0) {
        const { error: insertError } = await client
          .from("matches")
          .insert(matches);

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
      const { data: participant, error: participantError } = await client
        .from("participants")
        .select("id, match_points, differential")
        .eq("id", playerId).eq("tournament_id", tournamentId)
        .single();

      if (participantError) {
        console.error("Error fetching participant:", participantError);
        return;
      }
      // Add a bye record for this player
      const { error: byeError } = await client
        .from("byes")
        .insert({
          tournament_id: tournamentId,
          round_number: round,
          match_points: (participant.match_points || 0) + 3,
          differential: (participant.differential || 0),
          participant_id: playerId
        });

      if (byeError) {
        console.error("Error assigning bye:", byeError);
        return;
      }

      // Update player's match points - a bye counts as a win (3 match points)
      const { error: updateError } = await client
        .from("participants")
        .update({ match_points: client.raw('match_points + 3') })
        .eq("id", playerId)
        .eq("tournament_id", tournamentId);

      if (updateError) {
        console.error("Error updating match points for bye:", updateError);
      }
    } catch (error) {
      console.error("Error in assignBye:", error);
    }
  };

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
            onEdit={(participant: any) => {
              setCurrentParticipant(participant);
              setNewParticipantName(participant.name);
              setNewMatchPoints(participant.match_points?.toString() || "");
              setNewDifferential(participant.differential?.toString() || "");
              setNewDroppedOut(participant.dropped_out || false);
              setIsEditParticipantModalOpen(true);
            }}
            setLatestRound={setLatestRound}
            onDelete={deleteParticipant}
            loading={loading}
            tournamentId={id || ""}
            tournamentStarted={tournament?.has_started || false}
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
            currentRound={tournament?.current_round}
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
