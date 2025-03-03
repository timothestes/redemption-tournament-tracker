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
    if (!latestRound.is_completed) {
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
      matches.forEach(async (match) => {
        // Participant 1
        const { error: participant1SelectError, data: participant1 } = await client.from("participants").select().eq("id", match.player1_id.id).single();
        if (participant1SelectError) throw participant1SelectError;

        // Participant 2
        const { error: participant2SelectError, data: participant2 } = await client.from("participants").select().eq("id", match.player2_id.id).single();
        if (participant2SelectError) throw participant2SelectError;

        if (match.player2_score === match.player1_score) {
          // If there's a Draw
          const { error: participant1UpdateError } = await client.from("participants").update({
            match_points: (participant1.match_points ?? 0) + 1.5,
            differential: (match.differential) + (participant1.differential ?? 0),
          }).eq("id", match.player1_id.id);
          const { error: participant2UpdateError } = await client.from("participants").update({
            match_points: (participant2.match_points ?? 0) + 1.5,
            differential: (match.differential2) + (participant2.differential ?? 0),
          }).eq("id", match.player2_id.id);

          // Adding match scores
          const { error: participantMatchPointsError } = await client.from("matches").update({
            player1_match_points: 1.5,
            player2_match_points: 1.5,
          }).eq("id", match.id);

        } else if (match.player1_score === 5) {
          // If first player won
          const { error: participant1UpdateError } = await client.from("participants").update({
            match_points: (participant1.match_points ?? 0) + 3,
            differential: (match.player1_score - match.player2_score) + (participant1.differential ?? 0),
          }).eq("id", match.player1_id.id);

          // Then second will get 0 match points and differential
          const { error: participant2UpdateError } = await client.from("participants").update({
            match_points: (participant2.match_points ?? 0),
            differential: (match.player2_score - match.player1_score) + (participant2.differential ?? 0),
          }).eq("id", match.player2_id.id);

          // Adding match scores
          const { error: participantMatchPointsError } = await client.from("matches").update({
            player1_match_points: 3,
          }).eq("id", match.id);

        } else if (match.player2_score === 5) {
          // If second player won
          const { error: participantUpdateError } = await client.from("participants").update({
            match_points: (participant2.match_points ?? 0) + 3,
            differential: (match.player2_score - match.player1_score) + (participant2.differential ?? 0),
          }).eq("id", match.player2_id.id);

          // Then first will get 0 match points and differential
          const { error: participant1UpdateError } = await client.from("participants").update({
            match_points: (participant1.match_points ?? 0),
            differential: (match.player1_score - match.player2_score) + (participant1.differential ?? 0),
          }).eq("id", match.player1_id.id);

          // Adding match scores
          const { error: participantMatchPointsError } = await client.from("matches").update({
            player2_match_points: 3,
          }).eq("id", match.id);

        } else if (match.player1_score > match.player2_score) {
          // If first player won in time.
          const { error: participant1UpdateError } = await client.from("participants").update({
            match_points: (participant1.match_points ?? 0) + 2,
            differential: (match.player1_score - match.player2_score) + (participant1.differential ?? 0),
          }).eq("id", match.player1_id.id);

          // Then second will get 0 match points and differential
          const { error: participant2UpdateError } = await client.from("participants").update({
            match_points: (participant2.match_points ?? 0),
            differential: (match.player2_score - match.player1_score) + (participant2.differential ?? 0),
          }).eq("id", match.player2_id.id);

          // Adding match scores
          const { error: participant1MatchPointsError } = await client.from("matches").update({
            player1_match_points: 2,
          }).eq("id", match.id);

        } else if (match.player2_score > match.player1_score) {
          // If second player won in time.
          const { error: participant2UpdateError } = await client.from("participants").update({
            match_points: (participant2.match_points ?? 0) + 2,
            differential: (match.player2_score - match.player1_score) + (participant2.differential ?? 0),
          }).eq("id", match.player2_id.id);

          // If first player won in time.
          const { error: participant1UpdateError } = await client.from("participants").update({
            match_points: (participant1.match_points ?? 0),
            differential: (match.player1_score - match.player2_score) + (participant1.differential ?? 0),
          }).eq("id", match.player1_id.id);

          // Adding match scores
          const { error: participantMatchPointsError } = await client.from("matches").update({
            player2_match_points: 2,
          }).eq("id", match.id);
        }
      })

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
      createPairing(1);
      showToast("Tournament started successfully!", "success");
    } catch (error) {
      showToast("Error starting tournament.", "error");
      console.error("Error starting tournament:", error);
    }
  };

  const createPairing = async (round: number) => {
    const client = await createClient();

    const now = new Date().toISOString();
    // Pairing Logic

    // If the current round is 1
    const { data, error: participantSelectError } = await client
      .from("participants")
      .select("id, match_points, differential, name")
      .eq("tournament_id", tournament.id)
      .order('match_points', { ascending: false })
      .order('differential', { ascending: false });

    if (participantSelectError) {
      console.log(participantSelectError);
    }

    let userArray = data;

    let pairingMatches = [];

    if (round === 1) {
      // Creating matches by picking random players
      while (userArray.length > 1) {
        let randomIndex1 = Math.floor(Math.random() * userArray.length);
        let randomIndex2 = Math.floor(Math.random() * userArray.length);

        while (randomIndex1 === randomIndex2) {
          randomIndex2 = Math.floor(Math.random() * userArray.length);
        }

        let randomParticipant1 = userArray[randomIndex1];
        let randomParticipant2 = userArray[randomIndex2];

        pairingMatches.push({
          tournament_id: tournament.id,
          round: round,
          player1_id: randomParticipant1.id,
          player2_id: randomParticipant2.id,
          player1_score: null,
          player2_score: null,
          player1_match_points: 0,
          player2_match_points: 0,
        });

        userArray.splice(randomIndex1, 1);
        if (randomIndex2 > randomIndex1) randomIndex2--;
        userArray.splice(randomIndex2, 1);
      }

      // Setting byes
      if (userArray.length > 0) {
        let error = false;
        userArray.forEach(async (user) => {
          const { error: byesError } = await client.from("byes").insert({
            tournament_id: tournament.id,
            round_number: round,
            participant_id: user.id,
          });

          if (byesError) {
            console.log(byesError);
            error = true;
          }
        });
      }
    } else if (round > 1) {
      const participantsData = data;

      // Sort participants by match points (descending)
      participantsData.sort((a, b) => b.match_points - a.match_points);

      // Fetch previous matches to check existing pairings
      const { data: previousMatches, error: fetchMatchesError } = await client
        .from('matches')
        .select('player1_id, player2_id')
        .eq('tournament_id', tournament.id);

      if (fetchMatchesError) {
        console.error('Error fetching previous matches:', fetchMatchesError);
        return;
      }

      // Build a map to track opponents each participant has faced
      const opponentsMap = new Map();
      previousMatches.forEach(match => {
        const p1 = match.player1_id;
        const p2 = match.player2_id;

        if (!opponentsMap.has(p1)) {
          opponentsMap.set(p1, new Set());
        }
        opponentsMap.get(p1).add(p2);

        if (!opponentsMap.has(p2)) {
          opponentsMap.set(p2, new Set());
        }
        opponentsMap.get(p2).add(p1);
      });

      // Helper function to check if two participants have played against each other
      const hasPlayedAgainst = (participant1, participant2) => {
        if (!opponentsMap.has(participant1.id)) return false;
        return opponentsMap.get(participant1.id).has(participant2.id);
      };

      const paired = new Array(participantsData.length).fill(false);
      const newPairingMatches = [];

      // Group participants by match points
      const pointGroups = {};
      participantsData.forEach(participant => {
        const points = participant.match_points || 0;
        if (!pointGroups[points]) {
          pointGroups[points] = [];
        }
        pointGroups[points].push(participant);
      });

      // Get unique point values and sort them in descending order
      const pointValues = Object.keys(pointGroups).map(Number).sort((a, b) => b - a);

      // Process each point group, starting with highest points
      for (const points of pointValues) {
        let group = pointGroups[points].filter(p =>
          !paired[participantsData.findIndex(pd => pd.id === p.id)]
        );

        // If odd number in current group and there's a next lower group,
        // pull someone up from the next group
        if (group.length % 2 === 1 && pointValues.indexOf(points) < pointValues.length - 1) {
          const nextPoints = pointValues[pointValues.indexOf(points) + 1];
          const nextGroup = pointGroups[nextPoints].filter(p =>
            !paired[participantsData.findIndex(pd => pd.id === p.id)]
          );

          if (nextGroup.length > 0) {
            // Find best candidate from next group that hasn't played against current group
            let candidateIndex = -1;
            for (let i = 0; i < nextGroup.length; i++) {
              let canPair = true;
              for (const currentPlayer of group) {
                if (hasPlayedAgainst(nextGroup[i], currentPlayer)) {
                  canPair = false;
                  break;
                }
              }
              if (canPair) {
                candidateIndex = i;
                break;
              }
            }

            // If found a valid candidate, move them up
            if (candidateIndex !== -1) {
              const candidate = nextGroup[candidateIndex];
              group.push(candidate);
              pointGroups[nextPoints] = pointGroups[nextPoints].filter(p => p.id !== candidate.id);
            }
          }
        }

        // Shuffle the group to add some randomness within same point group
        for (let i = group.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [group[i], group[j]] = [group[j], group[i]];
        }

        // Pair players within the group
        while (group.length >= 2) {
          const player1 = group[0];
          group.splice(0, 1);

          // Find an opponent who hasn't played against player1
          let opponentIndex = -1;
          for (let i = 0; i < group.length; i++) {
            if (!hasPlayedAgainst(player1, group[i])) {
              opponentIndex = i;
              break;
            }
          }

          // If no valid opponent found, just take the first one
          // (This would be a rare case where we have to break the "same-opponent-twice" rule)
          if (opponentIndex === -1 && group.length > 0) {
            opponentIndex = 0;
            console.warn(`Warning: Had to pair ${player1.id} with ${group[0].id} again.`);
          }

          if (opponentIndex !== -1) {
            const player2 = group[opponentIndex];
            group.splice(opponentIndex, 1);

            // Mark as paired
            paired[participantsData.findIndex(p => p.id === player1.id)] = true;
            paired[participantsData.findIndex(p => p.id === player2.id)] = true;

            // Create the match
            newPairingMatches.push({
              tournament_id: tournament.id,
              round: round,
              player1_id: player1.id,
              player2_id: player2.id,
              player1_score: null,
              player2_score: null,
              player1_match_points: 0,
              player2_match_points: 0,
            });
          }
        }
      }

      // Handle odd number of participants (assign a bye)
      const unpairedIndex = paired.findIndex(status => !status);
      if (unpairedIndex !== -1) {
        const byeParticipant = participantsData[unpairedIndex];
        console.log(`Participant ${byeParticipant.id} gets a bye in round ${round}.`);

        // Setting byes
        const { error: byesError } = await client.from("byes").insert({
          tournament_id: tournament.id,
          round_number: round,
          participant_id: byeParticipant.id,
        });

        if (byesError) {
          console.log(byesError);
        }
      }

      // Insert generated matches into the database
      if (newPairingMatches.length > 0) {
        const { error: insertError } = await client
          .from('matches')
          .insert(newPairingMatches);

        if (insertError) {
          console.error('Error inserting new matches:', insertError);
        }
      }
    }

    // Insert the matches into the database
    const { error: matchesError } = await client
      .from("matches")
      .insert(pairingMatches);
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
                  second: "2-digit",
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
                    second: "2-digit",
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
                    second: "2-digit",
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
