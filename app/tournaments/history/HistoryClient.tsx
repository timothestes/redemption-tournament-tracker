"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { SeedData, TriviaScoreEntry } from "@/lib/nationals/types";
import { SeedContext } from "./seed-context";
import NavTabs, { type ViewId } from "./NavTabs";
import HistorySkeleton from "./HistorySkeleton";
import { TournamentsView } from "./views/TournamentsView";
import { TournamentDetailView } from "./views/TournamentDetailView";
import { ChampionsView } from "./views/ChampionsView";
import { PlayersView } from "./views/PlayersView";
import { PlayerProfileView } from "./views/PlayerProfileView";
import { MetricsView } from "./views/MetricsView";
import { SearchView } from "./views/SearchView";
import { TaleOfTheTapeView } from "./views/TaleOfTheTapeView";
import { TriviaView } from "./views/TriviaView";

const VALID_VIEWS = new Set<ViewId>([
  "tournaments",
  "champions",
  "players",
  "trivia",
  "stats",
  "tape",
  "search",
  "detail",
  "player",
]);

function parseView(raw: string | null): ViewId {
  if (raw !== null && VALID_VIEWS.has(raw as ViewId)) return raw as ViewId;
  return "tournaments";
}

interface HistoryClientProps {
  initialLeaderboard?: TriviaScoreEntry[];
}

export default function HistoryClient({
  initialLeaderboard = [],
}: HistoryClientProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [seed, setSeed] = useState<SeedData | null>(null);
  const [fetchError, setFetchError] = useState(false);
  const [view, setViewState] = useState<ViewId>(
    parseView(searchParams.get("view"))
  );
  const [tournamentId, setTournamentId] = useState<string | null>(
    searchParams.get("t")
  );
  const [playerName, setPlayerName] = useState<string | null>(
    searchParams.get("p")
  );
  const backToRef = useRef<ViewId | null>(null);

  // Fetch seed data on mount
  useEffect(() => {
    fetch("/data/nationals-history.json")
      .then((res) => res.json())
      .then((data: SeedData) => setSeed(data))
      .catch(() => setFetchError(true));
  }, []);

  function setView(
    nextView: ViewId,
    opts?: {
      tournamentId?: string;
      playerName?: string;
      backTo?: ViewId;
    }
  ) {
    const nextTournamentId = opts?.tournamentId ?? null;
    const nextPlayerName = opts?.playerName ?? null;
    backToRef.current = opts?.backTo ?? null;

    setViewState(nextView);
    setTournamentId(nextTournamentId);
    setPlayerName(nextPlayerName);

    const params = new URLSearchParams();
    params.set("view", nextView);
    if (nextTournamentId) params.set("t", nextTournamentId);
    if (nextPlayerName) params.set("p", nextPlayerName);
    router.push(`/tournaments/history?${params.toString()}`, {
      scroll: false,
    });
  }

  // Sync state FROM URL on browser back/forward
  useEffect(() => {
    const urlView = parseView(searchParams.get("view"));
    const urlT = searchParams.get("t");
    const urlP = searchParams.get("p");
    if (urlView !== view || urlT !== tournamentId || urlP !== playerName) {
      setViewState(urlView);
      setTournamentId(urlT);
      setPlayerName(urlP);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  function back() {
    const target = backToRef.current ?? "tournaments";
    setView(target);
  }

  if (fetchError) {
    return (
      <div className="p-6 text-center text-muted-foreground">
        Couldn&apos;t load Nationals history. Please refresh.
      </div>
    );
  }

  if (!seed) return <HistorySkeleton />;

  function renderView() {
    switch (view) {
      case "tournaments":
        return <TournamentsView setView={setView} />;
      case "champions":
        return <ChampionsView setView={setView} />;
      case "players":
        return <PlayersView setView={setView} />;
      case "trivia":
        return <TriviaView initialLeaderboard={initialLeaderboard} />;
      case "stats":
        return <MetricsView />;
      case "tape":
        return <TaleOfTheTapeView />;
      case "search":
        return <SearchView setView={setView} />;
      case "detail":
        return (
          <TournamentDetailView
            tournamentId={tournamentId}
            setView={setView}
            back={back}
          />
        );
      case "player":
        return (
          <PlayerProfileView
            playerName={playerName}
            setView={setView}
            back={back}
          />
        );
      default:
        return <TournamentsView setView={setView} />;
    }
  }

  return (
    <SeedContext.Provider value={seed}>
      <div className="max-w-[1200px] mx-auto px-5 py-6">
        <NavTabs view={view} setView={setView} />
        <div className="mt-4">{renderView()}</div>
      </div>
    </SeedContext.Provider>
  );
}
