"use client";

import { useEffect, useState } from "react";
import { createClient } from "../../../../utils/supabase/client";
import { Button, TextInput } from "flowbite-react";
import { HiPlus } from "react-icons/hi";
import ParticipantFormModal from "../../../../components/ui/participant-form-modal";
import ToastNotification from "../../../../components/ui/toast-notification";
import ParticipantTable from "../../../../components/ui/ParticipantTable";
import EditParticipantModal from "../../../../components/ui/EditParticipantModal";

const supabase = createClient();

export default function TournamentPage({ params }: { params: Promise<{ id: string }> }) {
  const [participants, setParticipants] = useState([]);
  const [tournament, setTournament] = useState(null);
  const [currentParticipant, setCurrentParticipant] = useState(null);
  const [newParticipantName, setNewParticipantName] = useState<string>("");
  const [isEditModalOpen, setIsEditModalOpen] = useState<boolean>(false);
  const [newMatchPoints, setNewMatchPoints] = useState<string>("");
  const [newDifferential, setNewDifferential] = useState<string>("");
  const [newDroppedOut, setNewDroppedOut] = useState<boolean>(false);
  const [loading, setLoading] = useState(true);
  const [id, setId] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [toast, setToast] = useState<{ message: string; show: boolean; type?: "success" | "error" }>({
    message: "",
    show: false,
    type: "success",
  });

  const showToast = (message: string, type: "success" | "error" = "success") => {
    setToast({ message, show: true, type });
    setTimeout(() => setToast((prev) => ({ ...prev, show: false })), 2000); // Hide after 2 seconds
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
        .order("match_points", { ascending: true });
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

    try {
      const { error } = await supabase
        .from("participants")
        .update({
          name: newParticipantName,
          match_points: newMatchPoints,
          differential: newDifferential,
          dropped_out: newDroppedOut,
        })
        .eq("id", currentParticipant.id);
      if (error) throw error;

      fetchParticipants();
      setIsEditModalOpen(false);
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

  useEffect(() => {
    if (id) {
      fetchTournamentDetails();
      fetchParticipants();
    }
  }, [id]);

  return (
    <div className="flex h-screen pl-64">
      <ToastNotification
        message={toast.message}
        show={toast.show}
        onClose={() => setToast((prev) => ({ ...prev, show: false }))}
        type={toast.type}
      />
      <div className="flex-grow p-4 max-w-4xl mx-auto">
        {tournament && (
          <div className="mb-6">
            <h1 className="text-3xl font-bold">{tournament.name}</h1>
            <p className="text-sm text-gray-500">
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
          </div>
        )}
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-2xl font-bold" style={{ width: "200px" }}>
            Participants
          </h2>
          <Button
            onClick={() => setIsModalOpen(true)}
            className="flex items-center gap-2"
            style={{ width: "200px" }}
            outline
            gradientDuoTone="greenToBlue"
          >
            <HiPlus className="w-5 h-5" />
            Add Participant
          </Button>
          <ParticipantFormModal
            isOpen={isModalOpen}
            onClose={() => setIsModalOpen(false)}
            onSubmit={handleAddParticipant}
          />
        </div>
        {loading ? (
          <p>Loading participants...</p>
        ) : participants.length === 0 ? (
          <p>No participants found.</p>
        ) : <ParticipantTable participants={participants} onEdit={(participant) => {
              setCurrentParticipant(participant);
              setNewParticipantName(participant.name);
              setIsEditModalOpen(true);
            }} onDelete={deleteParticipant} />}
      </div>
      <EditParticipantModal
        isOpen={isEditModalOpen}
        onClose={() => setIsEditModalOpen(false)}
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
    </div>
  );
}
