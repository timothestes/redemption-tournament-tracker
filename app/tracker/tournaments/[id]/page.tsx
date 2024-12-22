"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "../../../../utils/supabase/client";
import { Table, Button, TextInput, Modal } from "flowbite-react";
import { HiPencil, HiTrash, HiPlus } from "react-icons/hi";
import ParticipantFormModal from "../../../../components/ui/participant-form-modal";
import ToastNotification from "../../../../components/ui/toast-notification";

const supabase = createClient();

export default function TournamentPage({ params }: { params: Promise<{ id: string }> }) {
  const [participants, setParticipants] = useState([]);
  const [tournament, setTournament] = useState(null);
  const [currentParticipant, setCurrentParticipant] = useState(null);
  const [newParticipantName, setNewParticipantName] = useState("");
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
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
        .eq("tournament_id", id);
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
        .update({ name: newParticipantName })
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
        ) : (
          <div className="overflow-x-auto" style={{ maxWidth: '800px' }}>
            <Table striped hoverable>
              <Table.Head>
                <Table.HeadCell>Name</Table.HeadCell>
                {/* <Table.HeadCell>Joined At</Table.HeadCell> */}
                <Table.HeadCell>Place</Table.HeadCell>
                <Table.HeadCell className="whitespace-nowrap">Match Points</Table.HeadCell>
                <Table.HeadCell>Differential</Table.HeadCell>
                <Table.HeadCell className="whitespace-nowrap">Dropped Out</Table.HeadCell>
                <Table.HeadCell>
                  <span className="sr-only">Actions</span>
                </Table.HeadCell>
              </Table.Head>
              <Table.Body className="divide-y">
                {participants.map((participant) => (
                  <Table.Row
                    key={participant.id}
                    className="bg-white dark:border-gray-700 dark:bg-gray-800 h-10"
                  >
                    <Table.Cell className="whitespace-nowrap font-medium text-gray-900 dark:text-white">
                      {participant.name}
                    </Table.Cell>
                    {/* <Table.Cell className="whitespace-nowrap">
                      {new Intl.DateTimeFormat("en-US", {
                        year: "numeric",
                        month: "long",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                        second: "2-digit",
                      }).format(new Date(participant.joined_at))}
                    </Table.Cell> */}
                    <Table.Cell>{participant.place}</Table.Cell>
                    <Table.Cell>{participant.match_points}</Table.Cell>
                    <Table.Cell>{participant.differential}</Table.Cell>
                    <Table.Cell>{participant.dropped_out ? "Yes" : "No"}</Table.Cell>
                    <Table.Cell className="flex items-center space-x-4">
                      <HiPencil
                        onClick={(e) => {
                          e.stopPropagation();
                          setCurrentParticipant(participant);
                          setNewParticipantName(participant.name);
                          setIsEditModalOpen(true);
                        }}
                        className="text-blue-500 cursor-pointer hover:text-blue-700 w-6 h-6"
                        aria-label="Edit"
                      />
                      <HiTrash
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteParticipant(participant.id);
                        }}
                        className="text-red-500 cursor-pointer hover:text-red-700 w-6 h-6"
                        aria-label="Delete"
                      />
                    </Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table>
          </div>
        )}
      </div>
      <Modal
        show={isEditModalOpen}
        onClose={() => setIsEditModalOpen(false)}
        size="sm"
      >
        <Modal.Header>Edit Participant</Modal.Header>
        <Modal.Body>
          <div className="space-y-4">
            <TextInput
              value={newParticipantName}
              onChange={(e) => setNewParticipantName(e.target.value)}
              placeholder="Participant Name"
              required
            />
          </div>
        </Modal.Body>
        <Modal.Footer className="flex justify-end space-x-2">
          <Button outline gradientDuoTone="greenToBlue" onClick={updateParticipant}>
            Save
          </Button>
          <Button outline color="red" onClick={() => setIsEditModalOpen(false)}>
            Cancel
          </Button>
        </Modal.Footer>
      </Modal>
    </div>
  );
}
