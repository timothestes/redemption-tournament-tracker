"use client";

import { useState, useEffect } from "react";
import Breadcrumb from "../../../components/ui/breadcrumb";
import { createClient } from "../../../utils/supabase/client";
import ToastNotification from "../../../components/ui/toast-notification";
import { Table, Button } from "flowbite-react";
import { HiPencil, HiTrash, HiPlus } from "react-icons/hi";
import { useRouter } from "next/navigation";
import TournamentFormModal from "../../../components/ui/tournament-form-modal";

const supabase = createClient();

export default function TournamentsPage() {
  const [tournaments, setTournaments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showDeleteToast, setShowDeleteToast] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isAddTournamentModalOpen, setisAddTournamentModalOpen] =
    useState(false);
  const [currentTournament, setCurrentTournament] = useState(null);
  const [newTournamentName, setNewTournamentName] = useState("");
  const router = useRouter();

  useEffect(() => {
    fetchTournaments();
    // Reset document title when viewing tournaments list
    document.title = "Land of Redemption Tournament Tracker";
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
    <div className="flex min-h-screen px-5 w-full">
      <div className="max-w-4xl mx-auto space-y-3 w-full">
        <Breadcrumb
          items={[{ label: "Tournaments", href: "/tracker/tournaments" }]}
        />
        <div className="flex items-center justify-between flex-wrap mb-6">
          <h1 className="text-2xl font-bold mr-8 mt-2">Your Tournaments</h1>
          <Button
            onClick={() => setisAddTournamentModalOpen(true)}
            className="flex items-center gap-3 mt-2"
            outline
            gradientDuoTone="greenToBlue"
          >
            <div className="flex items-center gap-1">
              <HiPlus className="w-4 h-4" />
              <span>Host a Tournament</span>
            </div>
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
          <div className="space-y-2">
            <p>No tournaments found.</p>
            <p>Get started by clicking <strong>Host A Tournament</strong></p>
          </div>
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
              <Table.Body className="divide-y w-full overflow-x-auto rounded-lg">
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
                    <Table.Cell className="whitespace-nowrap min-w-[160px]">
                      {new Intl.DateTimeFormat("en-US", {
                        year: "numeric",
                        month: "long",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      }).format(new Date(tournament.created_at))}
                    </Table.Cell>
                    <Table.Cell className="flex items-center justify-end space-x-4">
                      <HiPencil
                        onClick={(e) => {
                          e.stopPropagation();
                          router.push(`/tracker/tournaments/${tournament.id}`);
                        }}
                        className="text-blue-500 cursor-pointer hover:text-blue-600 w-6 h-6"
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
