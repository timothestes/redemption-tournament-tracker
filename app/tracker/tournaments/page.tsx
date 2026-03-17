"use client";

import { useState, useEffect } from "react";
import Breadcrumb from "../../../components/ui/breadcrumb";
import { createClient } from "../../../utils/supabase/client";
import ToastNotification from "../../../components/ui/toast-notification";
import { Button } from "../../../components/ui/button";
import { HiPencil, HiTrash, HiPlus } from "react-icons/hi";
import { useRouter, useSearchParams } from "next/navigation";
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
  const [prefillName, setPrefillName] = useState("");
  const [fromListingId, setFromListingId] = useState<string | null>(null);
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    fetchTournaments();
    // Reset document title when viewing tournaments list
    document.title = "RedemptionCCG App";

    // Auto-open modal if coming from "Host This Event" on /tournaments
    const listingId = searchParams.get("from_listing");
    const name = searchParams.get("name");
    if (listingId && name) {
      setPrefillName(name);
      setFromListingId(listingId);
      setisAddTournamentModalOpen(true);
    }
  }, [searchParams]);

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

      const { data, error } = await supabase
        .from("tournaments")
        .insert([{ name, host_id: user.id }])
        .select("id")
        .single();
      if (error) {
        console.error("Error adding tournament:", error);
      } else {
        // If created from a listing, link the tournament to the listing
        if (fromListingId && data?.id) {
          await supabase
            .from("tournament_listings")
            .update({ linked_tournament_id: data.id })
            .eq("id", fromListingId);
          setFromListingId(null);
          setPrefillName("");
          // Clean up URL params
          router.replace("/tracker/tournaments", { scroll: false });
        }
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
            className="flex items-center gap-3 mt-2 bg-emerald-700 dark:bg-emerald-800 text-white hover:bg-emerald-700/90 dark:hover:bg-emerald-800/90"
          >
            <div className="flex items-center gap-1">
              <HiPlus className="w-4 h-4" />
              <span>Host a Tournament</span>
            </div>
          </Button>
          <TournamentFormModal
            isOpen={isAddTournamentModalOpen}
            onClose={() => {
              setisAddTournamentModalOpen(false);
              if (fromListingId) {
                setFromListingId(null);
                setPrefillName("");
                router.replace("/tracker/tournaments", { scroll: false });
              }
            }}
            onSubmit={handleAddTournament}
            defaultName={prefillName}
          />
        </div>
        {loading ? (
          <p>Loading tournaments...</p>
        ) : tournaments.length === 0 ? (
          <p className="text-muted-foreground">No tournaments found.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="text-xs uppercase bg-muted text-muted-foreground">
                <tr>
                  <th className="px-6 py-3">Name</th>
                  <th className="px-6 py-3">Created At</th>
                  <th className="px-6 py-3">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {tournaments.map((tournament) => (
                  <tr
                    key={tournament.id}
                    className="bg-card cursor-pointer hover:bg-muted"
                    onClick={() =>
                      router.push(`/tracker/tournaments/${tournament.id}`)
                    }
                  >
                    <td className="px-6 py-4 whitespace-nowrap font-medium text-foreground">
                      {tournament.name}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap min-w-[160px] text-muted-foreground">
                      {new Intl.DateTimeFormat("en-US", {
                        year: "numeric",
                        month: "long",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      }).format(new Date(tournament.created_at))}
                    </td>
                    <td className="px-6 py-4 flex items-center justify-end space-x-2">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          router.push(`/tracker/tournaments/${tournament.id}`);
                        }}
                        className="p-2 rounded-md text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
                        aria-label="Edit"
                      >
                        <HiPencil className="w-5 h-5" />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteTournament(tournament.id);
                        }}
                        className="p-2 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                        aria-label="Delete"
                      >
                        <HiTrash className="w-5 h-5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
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
