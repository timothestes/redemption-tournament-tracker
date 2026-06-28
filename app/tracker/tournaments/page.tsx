"use client";

import { useState, useEffect, Suspense } from "react";
import Breadcrumb from "../../../components/ui/breadcrumb";
import { createClient } from "../../../utils/supabase/client";
import { getUserSafe } from "../../../utils/supabase/getUserSafe";
import ToastNotification from "../../../components/ui/toast-notification";
import { Button } from "../../../components/ui/button";
import { HiPencil, HiTrash, HiPlus, HiOutlineDesktopComputer } from "react-icons/hi";
import { useRouter, useSearchParams } from "next/navigation";
import TournamentFormModal from "../../../components/ui/tournament-form-modal";

const supabase = createClient();

function TournamentsPageInner() {
  const [tournaments, setTournaments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sessionError, setSessionError] = useState(false);
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

  // Recover automatically when the session comes back (e.g. token refreshed),
  // and surface the session-expired state if the user gets signed out.
  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED") {
        fetchTournaments();
      } else if (event === "SIGNED_OUT") {
        setSessionError(true);
      }
    });
    return () => subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    // Verify the session first. The tournaments list is scoped entirely by the
    // RLS policy (auth.uid() = host_id), so a missing/expired token makes the
    // query return zero rows with no error — which would otherwise render as a
    // silent "No tournaments found". getUserSafe refreshes the token if it can
    // (self-heals a transient hiccup) and, crucially, keeps the session on a
    // network blip — so flaky venue wifi doesn't trigger a false "session
    // expired"; it only returns null when the server truly rejects the session.
    const user = await getUserSafe(supabase);
    if (!user) {
      setSessionError(true);
      setLoading(false);
      return;
    }
    setSessionError(false);

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
    <div className="flex min-h-screen px-4 sm:px-5 w-full">
      <div className="max-w-4xl mx-auto space-y-3 w-full">
        <Breadcrumb
          items={[{ label: "Tournaments", href: "/tracker/tournaments" }]}
        />
        <div className="flex items-center justify-between gap-3 flex-wrap mb-6">
          <h1 className="text-2xl font-bold mt-2">Your Tournaments</h1>
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            <Button variant="outline" className="flex items-center gap-2" asChild>
              <a href="/board" target="_blank" rel="noopener noreferrer">
                <HiOutlineDesktopComputer className="w-4 h-4" />
                <span>Projector view</span>
              </a>
            </Button>
            <Button
              onClick={() => setisAddTournamentModalOpen(true)}
              className="flex items-center gap-3 bg-primary text-primary-foreground hover:bg-primary/90"
            >
              <div className="flex items-center gap-1">
                <HiPlus className="w-4 h-4" />
                <span>Host a Tournament</span>
              </div>
            </Button>
          </div>
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
        ) : sessionError ? (
          <div className="rounded-lg border border-border bg-card px-4 py-6 text-center space-y-3">
            <p className="font-medium text-foreground">Your session expired</p>
            <p className="text-sm text-muted-foreground">
              We couldn&apos;t verify your sign-in, so your tournaments
              can&apos;t load right now. Don&apos;t worry — none of your data is
              lost. Reload to sign back in.
            </p>
            <Button onClick={() => window.location.reload()}>Reload</Button>
          </div>
        ) : tournaments.length === 0 ? (
          <p className="text-muted-foreground">No tournaments found.</p>
        ) : (
          <div className="jayden-gradient-bg rounded-lg overflow-hidden border border-border">
            <ul className="divide-y divide-border">
              {tournaments.map((tournament) => (
                <li
                  key={tournament.id}
                  className="bg-card cursor-pointer hover:bg-muted transition-colors"
                  onClick={() =>
                    router.push(`/tracker/tournaments/${tournament.id}`)
                  }
                >
                  <div className="flex items-center gap-2 px-4 sm:px-6 py-3 sm:py-4">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-foreground truncate">
                        {tournament.name}
                      </p>
                      <p className="text-xs sm:text-sm text-muted-foreground truncate">
                        {new Intl.DateTimeFormat("en-US", {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        }).format(new Date(tournament.created_at))}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          router.push(`/tracker/tournaments/${tournament.id}`);
                        }}
                        className="p-2 rounded-md text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors touch-manipulation"
                        aria-label="Edit"
                      >
                        <HiPencil className="w-5 h-5" />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteTournament(tournament.id);
                        }}
                        className="p-2 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors touch-manipulation"
                        aria-label="Delete"
                      >
                        <HiTrash className="w-5 h-5" />
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
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

export default function TournamentsPage() {
  return (
    <Suspense>
      <TournamentsPageInner />
    </Suspense>
  );
}
