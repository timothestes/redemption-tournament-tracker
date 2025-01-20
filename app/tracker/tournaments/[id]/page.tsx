"use client";

import { useEffect, useState } from "react";
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

export default function TournamentPage({ params }: { params: Promise<{ id: string }> }) {
  const [participants, setParticipants] = useState([]);
  const [tournament, setTournament] = useState<any>(null);
  const [currentParticipant, setCurrentParticipant] = useState<any>(null);
  const [newParticipantName, setNewParticipantName] = useState<string>("");
  const [isEditTournamentModalOpen, setIsEditTournamentModalOpen] = useState<boolean>(false);
  const [isEditParticipantModalOpen, setIsEditParticipantModalOpen] = useState<boolean>(false);
  const [newMatchPoints, setNewMatchPoints] = useState<string>("");
  const [newDifferential, setNewDifferential] = useState<string>("");
  const [newDroppedOut, setNewDroppedOut] = useState<boolean>(false);
  const [loading, setLoading] = useState(true);
  const [id, setId] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newTournamentName, setNewTournamentName] = useState("");
  const [toast, setToast] = useState<{ message: string; show: boolean; type?: "success" | "error" }>({
    message: "",
    show: false,
    type: "success",
  });

  const showToast = (message: string, type: "success" | "error" = "success") => {
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
      const { error } = await supabase.from("participants").delete().eq("id", id);
      if (error) throw error;
      fetchParticipants();
      showToast("Participant deleted successfully!", "error");
    } catch (error) {
      showToast("Error deleting participant.", "error");
      console.error("Error deleting participant:", error);
    }
  };

  const [showStartModal, setShowStartModal] = useState(false);
  const [isRoundActive, setIsRoundActive] = useState(false);
  const [roundInfo, setRoundInfo] = useState<{ started_at: string | null }>({ started_at: null });

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

  const handleStartTournament = async (numberOfRounds: number, roundLength: number) => {
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
          round_length: roundLength
        })
        .eq("id", id)
        .select("*")
        .single();
      if (error) throw error;
      setTournament(data);
      setShowStartModal(false);
      showToast("Tournament started successfully!", "success");
    } catch (error) {
      showToast("Error starting tournament.", "error");
      console.error("Error starting tournament:", error);
    }
  };

  useEffect(() => {
    if (id) {
      fetchTournamentDetails();
      fetchParticipants();
    }
  }, [id]);

  return (
      <div className="w-full pl-64 pt-4">
        <div className="max-w-4xl mx-auto">
          <Breadcrumb
            items={[
              { label: "Tournaments", href: "/tracker/tournaments" },
              { label: tournament?.name || "Loading..." },
            ]}
          />
          </div>
        <ToastNotification
        message={toast.message}
        show={toast.show}
        onClose={() => setToast((prev) => ({ ...prev, show: false }))}
        type={toast.type}
      />
      <div className="flex-grow p-4 max-w-4xl mx-auto">
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
                  
                  setTournament(prev => ({
                    ...prev,
                    name: newTournamentName
                  }));
                  setIsEditTournamentModalOpen(false);
                  showToast("Tournament name updated successfully!", "success");
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
              To start a tournament, first add some participants</p>
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
              {tournament?.has_started && !tournament?.has_ended && tournament?.round_length && (
                <CountdownTimer 
                  key={roundInfo?.started_at || 'inactive'} // Force re-render on start time change
                  startTime={isRoundActive ? roundInfo?.started_at : null} 
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
          onDelete={deleteParticipant}
          loading={loading}
          tournamentId={id || ''}
          tournamentStarted={tournament?.has_started || false}
          onTournamentEnd={fetchTournamentDetails}
          onRoundActiveChange={(isActive, roundStartTime) => {
            setIsRoundActive(isActive);
            setRoundInfo(prev => ({ ...prev, started_at: roundStartTime }));
            fetchTournamentDetails();
          }}
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
  );
}
