"use client";

import { Button } from "../../../../components/ui/button";
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
import { createPairing } from "../../../../utils/tournament/pairingUtilsV2";
import { buildStateFromSupabase } from "../../../../utils/tournament/stateAdapter";
import { recomputeTotalsFromHistory } from "../../../../lib/tournament/results";
import { loadTournamentDecklistsAction, type TournamentDecklistRow } from "../actions";
import PublishDecklistsSection from "../../../../components/ui/PublishDecklistsSection";

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
    type?: "success" | "error" | "warning" | "info";
  }>({
    message: "",
    show: false,
    type: "success",
  });

  const [latestRound, setLatestRound] = useState<any>(null);
  const [showPairingNotice, setShowPairingNotice] = useState(true);
  const [decklists, setDecklists] = useState<TournamentDecklistRow[]>([]);

  const showToast = (
    message: string,
    type: "success" | "error" | "warning" | "info" = "success"
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

  // Update document title when tournament name changes
  useEffect(() => {
    if (tournament?.name) {
      document.title = `${tournament.name} - RedemptionCCG App`;
    } else {
      document.title = "RedemptionCCG App";
    }
  }, [tournament?.name]);

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

      await handleEndRound(data, setMatchErrorIndex, byeData, latestRound.round_number);
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

    // Auto-handle matches where a player has dropped mid-round
    for (const match of matches) {
      if (match.player1_score !== null && match.player2_score !== null) continue;
      const [{ data: p1Status }, { data: p2Status }] = await Promise.all([
        client.from("participants").select("dropped_out").eq("id", match.player1_id.id).single(),
        client.from("participants").select("dropped_out").eq("id", match.player2_id.id).single(),
      ]);
      if (p1Status?.dropped_out || p2Status?.dropped_out) {
        if (p1Status?.dropped_out && p2Status?.dropped_out) {
          match.player1_score = 0;
          match.player2_score = 0;
        } else if (p1Status?.dropped_out) {
          match.player1_score = 0;
          match.player2_score = tournament.max_score;
        } else {
          match.player1_score = tournament.max_score;
          match.player2_score = 0;
        }
        await client.from("matches").update({
          player1_score: match.player1_score,
          player2_score: match.player2_score,
        }).eq("id", match.id);
      }
    }

    // Checking if the user has not added the score
    matches.forEach((match, index) => {
      if (match.player1_score === null || match.player2_score === null) {
        setMatchErrorIndex((matchErrorIndex) => [...matchErrorIndex, index]);
        matchErrorIndexArr.push(index);
      }
    });

    if (matchErrorIndexArr.length > 0) {
      showToast("Please add scores to all matches.", "warning");
      return;
    }

    try {
      const now = new Date().toISOString();

      // Persist is_tie + winner_id on each match row so buildStateFromSupabase
      // can derive per-player outcomes. (player1_score / player2_score and the
      // per-row match_points + differential snapshots are already written by
      // the score-input UI in components/ui/match-edit.tsx — we don't touch
      // those denormalized snapshots here.)
      for (const match of matches) {
        let isTie = false;
        let winnerId: string | null = null;
        if (match.player1_score === match.player2_score) {
          isTie = true;
        } else if (match.player1_score > match.player2_score) {
          winnerId = match.player1_id.id;
        } else {
          winnerId = match.player2_id.id;
        }
        const { error: matchUpdateError } = await client
          .from("matches")
          .update({ is_tie: isTie, winner_id: winnerId })
          .eq("id", match.id);
        if (matchUpdateError) throw matchUpdateError;
      }

      // Recompute participant totals from full match + bye history.
      // This is the load-bearing fix for the double-count bug: totals are
      // always derived from history, never incremented. Editing a result and
      // re-running this yields the correct total regardless of prior writes.
      // Byes are accounted for via state.byes inside recomputeTotalsFromHistory,
      // so no separate bye participants update is needed.
      const state = await buildStateFromSupabase(client, tournament.id);
      if (state) {
        const affectedIds = new Set<string>();
        for (const m of matches) {
          if (m.player1_id?.id) affectedIds.add(m.player1_id.id);
          if (m.player2_id?.id) affectedIds.add(m.player2_id.id);
        }
        if (byes && byes.length > 0) {
          for (const bye of byes) {
            if (bye.participant_id?.id) affectedIds.add(bye.participant_id.id);
          }
        }
        for (const pid of affectedIds) {
          const totals = recomputeTotalsFromHistory(pid, state);
          const { error: participantUpdateError } = await client
            .from("participants")
            .update({
              match_points: totals.gameScore,
              differential: totals.lostSoulScore,
            })
            .eq("id", pid);
          if (participantUpdateError) console.log(participantUpdateError);
        }
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
        await createPairingForRound(round + 1);

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
  }, [tournament]);

  const handleStartTournament = async (
    numberOfRounds: number,
    roundLength: number,
    maxScore: number,
    byePoints: number,
    byeDifferential: number,
    startingTableNumber: number,
    soundNotifications: boolean
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
          starting_table_number: startingTableNumber,
          sound_notifications: soundNotifications,
        })
        .eq("id", id)
        .select("*")
        .single();
      if (error) throw error;
      setTournament(data);
      setShowStartModal(false);
      // Creating pairing for the first round if the user has started the tournament.
      await createPairing(data.id, 1);
      setActiveTab(1);
      showToast("Tournament started successfully!", "success");
    } catch (error) {
      showToast("Error starting tournament.", "error");
      console.error("Error starting tournament:", error);
    }
  };

  const createPairingForRound = async (round: number) => {
    if (!tournament?.id) return false;
    const success = await createPairing(tournament.id, round);
    if (success) {
      showToast(`Round ${round} pairings created successfully!`, "success");
    } else {
      showToast(`Failed to create pairings for round ${round}`, "error");
    }
    return success;
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

  const fetchDecklists = useCallback(async () => {
    if (!id) return;
    const res = await loadTournamentDecklistsAction(id);
    if (res.success) {
      setDecklists(res.decklists);
    }
  }, [id]);

  useEffect(() => {
    if (id) {
      fetchTournamentDetails();
      fetchParticipants();
      fetchDecklists();
    }
  }, [id]);

  return (
    <div className="flex min-h-screen px-5 w-full jayden-gradient-bg">
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
            <div className="mb-6 space-y-4">
              {/* Title row with status badge */}
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="text-3xl font-bold">
                  <button
                    type="button"
                    onClick={() => {
                      setNewTournamentName(tournament.name);
                      setIsEditTournamentModalOpen(true);
                    }}
                    className="group inline-flex items-center gap-2 -mx-2 px-2 py-1 rounded-md text-left hover:bg-muted transition-colors"
                    aria-label="Edit tournament name"
                  >
                    <span>{tournament.name}</span>
                    <HiPencil className="w-5 h-5 text-muted-foreground group-hover:text-foreground transition-colors" />
                  </button>
                </h1>
                {/* Status badge */}
                <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${
                  tournament.has_ended
                    ? "bg-muted text-muted-foreground"
                    : tournament.has_started
                      ? "bg-primary/15 text-primary"
                      : "bg-amber-500/15 text-amber-600 dark:text-amber-400"
                }`}>
                  {tournament.has_ended
                    ? "Ended"
                    : tournament.has_started
                      ? `Round ${tournament.current_round || 1} of ${tournament.n_rounds || "?"}`
                      : "Not Started"}
                </span>
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

              {/* Dates — single condensed line */}
              <p className="text-sm text-muted-foreground">
                Created {new Intl.DateTimeFormat("en-US", {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                }).format(new Date(tournament.created_at))}
                {tournament.started_at && (
                  <> · Started {new Intl.DateTimeFormat("en-US", {
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  }).format(new Date(tournament.started_at))}</>
                )}
                {tournament.ended_at && (
                  <> · Ended {new Intl.DateTimeFormat("en-US", {
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  }).format(new Date(tournament.ended_at))}</>
                )}
              </p>

              {participants.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  Add participants to get started
                </p>
              )}

              {/* Timer — full width, prominent when active */}
              {tournament?.has_started &&
                !tournament?.has_ended &&
                tournament?.round_length && (
                  <CountdownTimer
                    key={latestRound?.started_at || "inactive"}
                    startTime={latestRound?.started_at || null}
                    durationMinutes={tournament.round_length}
                    soundNotifications={tournament.sound_notifications ?? false}
                  />
                )}

              {/* End Tournament — destructive styling, less prominent */}
              {!tournament?.has_ended && (
                <Button
                  disabled={participants.length === 0}
                  variant={
                    Boolean(tournament?.has_started)
                      ? "destructive"
                      : "success"
                  }
                  onClick={handleTournamentStatusToggle}
                  className={`w-fit ${tournament?.has_started ? "opacity-80" : ""}`}
                  size={tournament?.has_started ? "sm" : "default"}
                >
                  {Boolean(tournament?.has_started)
                    ? "End Tournament"
                    : "Start Tournament"}
                </Button>
              )}
              {tournament?.has_ended && (
                <span className="text-sm text-muted-foreground italic">
                  Tournament has ended
                </span>
              )}

              {/* Publish decklists section */}
              {tournament?.has_ended && (
                <PublishDecklistsSection
                  tournamentId={tournament.id}
                  tournamentEnded={tournament.has_ended}
                  decklistCount={decklists.length}
                  isPublished={tournament.decklists_published || false}
                  currentFormat={tournament.deck_format || null}
                  onPublishChange={() => {
                    fetchTournamentDetails();
                    fetchDecklists();
                  }}
                />
              )}
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
            tournamentName={tournament?.name}
            onTournamentEnd={fetchTournamentDetails}
            onRoundActiveChange={(isActive, roundStartTime) => {
              setIsRoundActive(isActive);
              fetchTournamentDetails();
            }}
            createPairing={createPairingForRound}
            matchErrorIndex={matchErrorIndex}
            setMatchErrorIndex={setMatchErrorIndex}
            activeTab={activeTab}
            setActiveTab={setActiveTab}
            fetchParticipants={fetchParticipants}
            decklists={decklists}
            onDecklistsChange={fetchDecklists}
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
