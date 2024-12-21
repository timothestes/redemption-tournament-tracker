"use client";

import { useState, useEffect } from "react";
import { createClient } from "../../../utils/supabase/client";
import ToastNotification from "../../../components/ui/toast-notification";
import { Table, Button, Modal, TextInput } from "flowbite-react";
import { HiPencil, HiTrash, HiPlus } from "react-icons/hi";
import { useRouter } from "next/navigation";
import TournamentFormModal from "../../../components/ui/tournament-form-modal";

const supabase = createClient();

export default function TournamentsPage() {
  const [tournaments, setTournaments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showDeleteToast, setShowDeleteToast] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isAddTournamentModalOpen, setisAddTournamentModalOpen] = useState(false);
  const [currentTournament, setCurrentTournament] = useState(null);
  const [newTournamentName, setNewTournamentName] = useState("");
  const router = useRouter();

  useEffect(() => {
    fetchTournaments();
  }, []);

  const handleAddTournament = async (name: string) => {
    try {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError) {
        console.error("Error fetching user:", userError);
        return;
      }

      const { error } = await supabase
        .from("tournaments")
        .insert([{ name, host_id: user.id }]);
      if (error) {
        console.error("Error adding tournament:", error);
      } else {
        fetchTournaments();
        setisAddTournamentModalOpen(false);
      }
    } catch (error) {
      console.error("Unexpected error:", error);
    }
  };

  const fetchTournaments = async () => {
    const { data: tournaments, error } = await supabase
      .from("tournaments")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) {
      console.error("Error fetching tournaments:", error);
    } else {
      setTournaments(tournaments);
    }
    setLoading(false);
  };

  const updateTournament = async () => {
    if (!currentTournament || !newTournamentName.trim()) return;

    const { data, error } = await supabase
      .from("tournaments")
      .update({ name: newTournamentName })
      .eq("id", currentTournament.id)
      .select();
    if (error) console.error("Error updating tournament:", error);
    else {
      fetchTournaments();
      setIsEditModalOpen(false);
    }
  };

  const deleteTournament = async (id) => {
    const { error } = await supabase.from("tournaments").delete().eq("id", id);
    if (error) console.error("Error deleting tournament:", error);
    else {
      fetchTournaments();
      setShowDeleteToast(true);
      setTimeout(() => setShowDeleteToast(false), 2000); // 2 seconds
    }
  };

  return (
    <div className="flex h-screen pl-64">
      <div className="flex-grow p-4">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Your Tournaments</h1>
        <Button
          onClick={() => setisAddTournamentModalOpen(true)}
          className="flex items-center gap-2"
          outline
          gradientDuoTone="greenToBlue"
        >
          <HiPlus className="w-5 h-5" />
          Host a Tournament
        </Button>
        <TournamentFormModal
            isOpen={isAddTournamentModalOpen}
            onClose={() => setisAddTournamentModalOpen(false)}
            onSubmit={handleAddTournament}
          />
      </div>
        {loading ? (
          <p>Loading tournaments...</p>
        ) : tournaments.length === 0 ? (
          <p>
            No tournaments found.{" "}
            <a
              href="/tracker/tournaments/host"
              className="text-blue-500 underline"
            >
              Create one?
            </a>
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table hoverable>
              <Table.Head>
                <Table.HeadCell>Name</Table.HeadCell>
                <Table.HeadCell>Created At</Table.HeadCell>
                <Table.HeadCell>
                  <span className="sr-only">Actions</span>
                </Table.HeadCell>
              </Table.Head>
              <Table.Body className="divide-y">
                {tournaments.map((tournament) => (
                  <Table.Row
                    key={tournament.id}
                    className="bg-white dark:border-gray-700 dark:bg-gray-800 cursor-pointer hover:bg-gray-100"
                    onClick={() =>
                      router.push(`/tracker/tournaments/${tournament.id}`)
                    }
                  >
                    <Table.Cell className="whitespace-nowrap font-medium text-gray-900 dark:text-white">
                      {tournament.name}
                    </Table.Cell>
                    <Table.Cell>
                      {new Intl.DateTimeFormat("en-US", {
                        year: "numeric",
                        month: "long",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                        second: "2-digit",
                      }).format(new Date(tournament.created_at))}
                    </Table.Cell>
                    <Table.Cell className="flex items-center space-x-4">
                      <HiPencil
                        onClick={(e) => {
                          e.stopPropagation();
                          setCurrentTournament(tournament);
                          setNewTournamentName(tournament.name);
                          setIsEditModalOpen(true);
                        }}
                        className="text-blue-500 cursor-pointer hover:text-blue-700 w-6 h-6"
                        aria-label="Edit"
                      />
                      <HiTrash
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteTournament(tournament.id);
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
        <Modal
          show={isEditModalOpen}
          onClose={() => setIsEditModalOpen(false)}
          size="sm"
        >
          <Modal.Header>Edit Tournament</Modal.Header>
          <Modal.Body>
            <div className="space-y-4">
              <TextInput
                value={newTournamentName}
                onChange={(e) => setNewTournamentName(e.target.value)}
                placeholder="Tournament Name"
                required
              />
            </div>
          </Modal.Body>
          <Modal.Footer className="flex justify-end space-x-2">
            <Button outline gradientDuoTone="greenToBlue" onClick={updateTournament}>Save</Button>
            <Button outline color="red" onClick={() => setIsEditModalOpen(false)}>
              Cancel
            </Button>
          </Modal.Footer>
        </Modal>
        <ToastNotification
          message="Tournament deleted successfully!"
          show={showDeleteToast}
          onClose={() => setShowDeleteToast(false)}
          type="error"
        />
      </div>
    </div>
  );
}
