"use client";

import { Card, Pagination } from "flowbite-react";
import { Dispatch, Fragment, SetStateAction, useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "../../utils/supabase/client";
import { recomputeTotalsFromHistory } from "../../lib/tournament/results";
import { buildStateFromSupabase } from "../../utils/tournament/stateAdapter";
import MatchEditModal from "./match-edit";
import RepairPairingModal from "./RepairPairingModal";
import { ArrowUpDown } from "lucide-react";
import { printTournamentPairings, printFinalStandings, printMatchSlips } from "../../utils/printUtils";
import { Button } from "./button";
import ToastNotification from "./toast-notification";
import ConfirmationDialog from "./confirmation-dialog";

const formatDateTime = (timestamp: string | null) => {
  if (!timestamp) return "";
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp));
};

interface TournamentRoundsProps {
  tournamentId: string;
  isActive: boolean;
  onTournamentEnd?: () => void | Promise<void>;
  onRoundActiveChange?: (
    isActive: boolean,
    roundStartTime: string | null
  ) => void;
  roundInfo?: RoundInfo;
  setLatestRound: Dispatch<SetStateAction<any>>;
  createPairing: (round: number) => void;
  matchErrorIndex: any;
  setMatchErrorIndex: Dispatch<SetStateAction<any>>;
  activeTab: number;
  tournamentName?: string | null;
  isHost?: boolean;
  onRepairCompleted?: () => void;
}

interface TournamentInfo {
  id: string | null;
  n_rounds: number | null;
  current_round: number | null;
  has_ended: boolean;
  max_score: number | null;
  starting_table_number: number | null;
  name: string | null;
}

interface RoundInfo {
  started_at: string | null;
  ended_at: string | null;
}

interface ErrorState {
  message: string | null;
  type: "fetch" | "update" | null;
}

export default function TournamentRounds({
  tournamentId,
  isActive,
  onTournamentEnd,
  onRoundActiveChange,
  setLatestRound,
  createPairing,
  matchErrorIndex,
  setMatchErrorIndex,
  activeTab,
  tournamentName,
  isHost = false,
  onRepairCompleted,
}: TournamentRoundsProps) {
  const [tournamentInfo, setTournamentInfo] = useState<TournamentInfo>({
    id: null,
    n_rounds: null,
    current_round: null,
    has_ended: false,
    max_score: null,
    starting_table_number: 1,
    name: tournamentName || null,
  });
  const hasFetchedTournament = useRef<boolean>(false);
  const client = createClient();
  const [error, setError] = useState<ErrorState>({ message: null, type: null });
  const [isLoading, setIsLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState(tournamentInfo.current_round || 1);
  const [isRoundActive, setIsRoundActive] = useState(false);
  const [isRoundCompleted, setIsRoundCompleted] = useState(false);
  const [roundInfo, setRoundInfo] = useState<RoundInfo>({
    started_at: null,
    ended_at: null,
  });
  const [matches, setMatches] = useState<any[]>([]);
  const [matchLoading, setMatchLoading] = useState(false);
  const [byes, setByes] = useState<any[]>([]);
  const [matchEnding, setMatchEnding] = useState(false);
  const [repairModalOpen, setRepairModalOpen] = useState(false);
  const [selectedMatch, setSelectedMatch] = useState<any>(null);
  const [repairMode, setRepairMode] = useState(false);
  const [repairSourceMatch, setRepairSourceMatch] = useState<any>(null);
  const [mounted, setMounted] = useState(false);
  const [toast, setToast] = useState<{
    message: string;
    show: boolean;
    type: "success" | "error" | "warning" | "info";
  }>({ message: "", show: false, type: "warning" });
  const [endRoundConfirmOpen, setEndRoundConfirmOpen] = useState(false);

  interface MatchEditRow {
    id: string;
    old_player1_score: number;
    old_player2_score: number;
    new_player1_score: number;
    new_player2_score: number;
    edited_at: string;
    reason: string | null;
  }
  const [matchEditsByMatch, setMatchEditsByMatch] = useState<Record<string, MatchEditRow[]>>({});

  const showToast = useCallback(
    (
      message: string,
      type: "success" | "error" | "warning" | "info" = "warning"
    ) => {
      setToast({ message, show: true, type });
    },
    []
  );

  const fetchMatchEdits = useCallback(async () => {
    if (!tournamentInfo.id || !isHost) return;
    const { data } = await client
      .from("match_edits")
      .select("id, match_id, old_player1_score, old_player2_score, new_player1_score, new_player2_score, edited_at, reason")
      .eq("tournament_id", tournamentInfo.id)
      .order("edited_at", { ascending: false });
    const grouped: Record<string, MatchEditRow[]> = {};
    for (const e of (data ?? [])) {
      const row = e as any;
      (grouped[row.match_id] ??= []).push({
        id: row.id,
        old_player1_score: row.old_player1_score,
        old_player2_score: row.old_player2_score,
        new_player1_score: row.new_player1_score,
        new_player2_score: row.new_player2_score,
        edited_at: row.edited_at,
        reason: row.reason,
      });
    }
    setMatchEditsByMatch(grouped);
  }, [tournamentInfo.id, isHost]);

  useEffect(() => {
    fetchMatchEdits();
  }, [fetchMatchEdits]);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (isActive) {
      fetchTournamentAndRoundInfo();
    }
  }, [activeTab, isActive]);

  const fetchTournamentAndRoundInfo = useCallback(async () => {
    if (!tournamentId) return;

    setIsLoading(true);
    setError({ message: null, type: null });

    try {
      const [tournamentResult, roundResult] = await Promise.all([
        client
          .from("tournaments")
          .select("id, n_rounds, current_round, has_ended, max_score, starting_table_number, name")
          .eq("id", tournamentId)
          .single(),
        client
          .from("rounds")
          .select("started_at, ended_at, is_completed")
          .eq("tournament_id", tournamentId)
          .eq("round_number", currentPage)
          .maybeSingle()
      ]);

      if (tournamentResult.error) throw tournamentResult.error;
      if (roundResult.error) throw roundResult.error;

      const tournamentData = tournamentResult.data;
      const roundData = roundResult.data;

      setTournamentInfo(tournamentData);
      setRoundInfo({
        started_at: roundData?.started_at || null,
        ended_at: roundData?.ended_at || null,
      });

      const shouldBeActive = !!(
        roundData &&
        !roundData.is_completed &&
        !tournamentData.has_ended &&
        roundData.started_at &&
        !roundData.ended_at
      );

      setIsRoundActive(shouldBeActive);
      setIsRoundCompleted(!!(roundData?.is_completed));
      
      if (shouldBeActive) {
        await fetchCurrentRoundData();
      }
    } catch (err) {
      setError({
        message: "Failed to fetch tournament and round information",
        type: "fetch",
      });
      console.error("Error fetching data:", err);
    } finally {
      setIsLoading(false);
    }
  }, [tournamentId, currentPage]);

  useEffect(() => {
    if (isActive) {
      onRoundActiveChange?.(isRoundActive, roundInfo.started_at);
    }
  }, [isRoundActive, isActive, onRoundActiveChange, roundInfo.started_at]);

  useEffect(() => {
    if (tournamentInfo.current_round && !hasFetchedTournament.current) {
      setCurrentPage(tournamentInfo.current_round);
      hasFetchedTournament.current = true;
    }
  }, [tournamentInfo, hasFetchedTournament]);

  useEffect(() => {
    if (isActive) {
      fetchTournamentAndRoundInfo();
    }
  }, [fetchTournamentAndRoundInfo, isActive, tournamentName]);

  const onPageChange = (page: number) => {
    if (page <= (tournamentInfo.current_round || 1)) {
      setCurrentPage(page);
      setMatchErrorIndex([]);
    }
  };

  const handleStartRound = async () => {
    try {
      const now = new Date().toISOString();
      const { error: roundError } = await client.from("rounds").insert([
        {
          tournament_id: tournamentId,
          round_number: currentPage,
          started_at: now,
        },
      ]);

      if (roundError) throw roundError;

      setRoundInfo({
        started_at: now,
        ended_at: null,
      });

      setIsRoundActive(true);
      setLatestRound((prev) => ({ round_number: currentPage, started_at: now }));
      onRoundActiveChange?.(true, now);

      setMatchLoading(true);
    } catch (error) {
      console.error("Error starting round:", error);
    }
  };

  const fetchCurrentRoundData = async () => {
    const { data, error } = await client
      .from("matches")
      .select(
        "id, match_order, player1_match_points, player2_match_points, differential, differential2, player1_id:participants!matches_player1_id_fkey(name,id), player2_id:participants!matches_player2_id_fkey(name,id), player1_score, player2_score"
      )
      .eq("tournament_id", tournamentId)
      .eq("round", currentPage)
      .order("match_order", { ascending: true });
    
    if (error) console.log(error);
    setMatches(data || []);
  
    const { data: byeData, error: byeError } = await client
      .from("byes")
      .select("id, participant_id:participants(id, name), match_points, differential")
      .eq("tournament_id", tournamentId)
      .eq("round_number", currentPage)
      .order("id", { ascending: true });
    
    if (byeError) console.log(byeError);
    setByes(byeData);
  };

  useEffect(() => {
    if (!tournamentId) return;
    fetchCurrentRoundData();
  }, [currentPage, tournamentId]);

  const handleEndRound = useCallback(async () => {
    const client = createClient();

    let matchErrorIndexArr = [];

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
          match.player2_score = tournamentInfo.max_score;
        } else {
          match.player1_score = tournamentInfo.max_score;
          match.player2_score = 0;
        }
        await client.from("matches").update({
          player1_score: match.player1_score,
          player2_score: match.player2_score,
        }).eq("id", match.id);
      }
    }

    matches.forEach((match, index) => {
      if (match.player1_score === null || match.player2_score === null) {
        setMatchErrorIndex((matchErrorIndex) => [...matchErrorIndex, index]);
        matchErrorIndexArr.push(matchErrorIndex);
      }
    });

    if (matchErrorIndexArr.length > 0) {
      showToast("Please add scores to all matches.", "warning");
      return;
    }

    setMatchEnding(true);

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
      const state = await buildStateFromSupabase(client, tournamentId);
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

      const { error: roundError, data: roundData } = await client
        .from("rounds")
        .update({
          ended_at: now,
          is_completed: true,
        })
        .eq("tournament_id", tournamentId)
        .eq("round_number", currentPage);

      if (roundError) throw roundError;

      if (tournamentInfo.current_round === tournamentInfo.n_rounds) {
        const { error: tournamentError } = await client
          .from("tournaments")
          .update({
            has_ended: true,
            ended_at: now,
          })
          .eq("id", tournamentId);

        if (tournamentError) throw tournamentError;

        setTournamentInfo((prev) => ({
          ...prev,
          has_ended: true,
        }));
      } else {
        await createPairing(currentPage + 1);

        const { error: tournamentError } = await client
          .from("tournaments")
          .update({
            current_round: (tournamentInfo.current_round || 0) + 1,
          })
          .eq("id", tournamentId);

        if (tournamentError) throw tournamentError;
      }

      // Refresh parent tournament state BEFORE updating local state so the
      // header pill (which reads from the parent's `tournament`) reflects the
      // new current_round / has_ended before we toggle our own round-active
      // flag and re-render. Awaiting the parent's refetch closes the desync
      // window that previously made the title-row badge lag the round panel.
      await onTournamentEnd?.();

      setRoundInfo((prev) => ({
        ...prev,
        ended_at: now,
      }));
      setIsRoundActive(false);
      setLatestRound((prev) => ({ round_number: currentPage, started_at: null }));
      setMatchEnding(false);

      if (currentPage < tournamentInfo.n_rounds) {
        setCurrentPage(currentPage + 1);
      }
    } catch (error) {
      console.error("Error ending round:", error);
      setMatchEnding(false);
    }
  }, [matches, tournamentInfo, byes]);

  const handleRepairClick = (match: any, isPlayer2 = false) => {
    if (repairMode) {
      if (repairSourceMatch.isBye) {
        handleSwapPlayerWithBye(match, isPlayer2, repairSourceMatch.byeId);
      } else {
        handleSwapPlayers(repairSourceMatch.match, match, repairSourceMatch.isPlayer2, isPlayer2);
      }
      setRepairMode(false);
      setRepairSourceMatch(null);
    } else {
      setRepairMode(true);
      setRepairSourceMatch({ match, isPlayer2 });
    }
  };

  const handleByeRepairClick = (bye: any) => {
    if (repairMode) {
      if (repairSourceMatch.isBye) {
        handleSwapPlayersWithBye(repairSourceMatch.byeId, bye.id);
      } else {
        handleSwapPlayerWithBye(repairSourceMatch.match, repairSourceMatch.isPlayer2, bye.id);
      }
      setRepairMode(false);
      setRepairSourceMatch(null);
    } else {
      setRepairMode(true);
      setRepairSourceMatch({ isBye: true, byeId: bye.id });
    }
  };

  const handleSwapPlayers = async (sourceMatch: any, targetMatch: any, isSourcePlayer2: boolean, isTargetPlayer2: boolean) => {
    setIsLoading(true);
    try {
      if (sourceMatch.id !== targetMatch.id) {
        const sourcePlayerId = isSourcePlayer2 ? sourceMatch.player2_id.id : sourceMatch.player1_id.id;
        const sourcePlayerMatchPoints = isSourcePlayer2 ? sourceMatch.player2_match_points : sourceMatch.player1_match_points;
        const sourceDifferential = isSourcePlayer2 ? sourceMatch.differential2 : sourceMatch.differential;
        
        const targetPlayerId = isTargetPlayer2 ? targetMatch.player2_id.id : targetMatch.player1_id.id;
        const targetPlayerMatchPoints = isTargetPlayer2 ? targetMatch.player2_match_points : targetMatch.player1_match_points;
        const targetDifferential = isTargetPlayer2 ? targetMatch.differential2 : targetMatch.differential;
        
        if (isSourcePlayer2) {
          await client.from("matches").update({
            player2_id: targetPlayerId,
            player2_match_points: targetPlayerMatchPoints,
            differential2: targetDifferential,
            player1_score: null,
            player2_score: null,
          }).eq("id", sourceMatch.id);
        } else {
          await client.from("matches").update({
            player1_id: targetPlayerId,
            player1_match_points: targetPlayerMatchPoints,
            differential: targetDifferential,
            player1_score: null,
            player2_score: null,
          }).eq("id", sourceMatch.id);
        }
        
        if (isTargetPlayer2) {
          await client.from("matches").update({
            player2_id: sourcePlayerId,
            player2_match_points: sourcePlayerMatchPoints,
            differential2: sourceDifferential,
            player1_score: null,
            player2_score: null,
          }).eq("id", targetMatch.id);
        } else {
          await client.from("matches").update({
            player1_id: sourcePlayerId,
            player1_match_points: sourcePlayerMatchPoints,
            differential: sourceDifferential,
            player1_score: null,
            player2_score: null,
          }).eq("id", targetMatch.id);
        }
      } else {
        await client.from("matches").update({
          player1_id: sourceMatch.player2_id.id,
          player2_id: sourceMatch.player1_id.id,
          player1_match_points: sourceMatch.player2_match_points,
          player2_match_points: sourceMatch.player1_match_points,
          differential: sourceMatch.differential2,
          differential2: sourceMatch.differential,
          player1_score: null,
          player2_score: null,
        }).eq("id", sourceMatch.id);
      }

      await fetchCurrentRoundData();
      
    } catch (error) {
      console.error("Error swapping players:", error);
      showToast("Error swapping players. Please try again.", "error");
    } finally {
      setIsLoading(false);
    }
  };

  const handleSwapPlayersWithBye = async (sourceByeId: number, targetByeId: number) => {
    setIsLoading(true);
    try {
      const sourceBye = byes.find((bye) => bye.id === sourceByeId);
      const targetBye = byes.find((bye) => bye.id === targetByeId);

      if (!sourceBye || !targetBye) {
        throw new Error("Invalid bye IDs");
      }

      await Promise.all([
        client.from("byes").update({
          participant_id: targetBye.participant_id.id,
          match_points: targetBye.match_points,
          differential: targetBye.differential,
        }).eq("id", sourceByeId),

        client.from("byes").update({
          participant_id: sourceBye.participant_id.id,
          match_points: sourceBye.match_points,
          differential: sourceBye.differential,
        }).eq("id", targetByeId),
      ]);

      await fetchCurrentRoundData();
    } catch (error) {
      console.error("Error swapping players with bye:", error);
      showToast("Error swapping players with bye. Please try again.", "error");
    } finally {
      setIsLoading(false);
    }
  };

  const handleSwapPlayerWithBye = async (sourceMatch: any, isSourcePlayer2: boolean, targetByeId: string) => {
    setIsLoading(true);
    try {
      const bye = byes.find((b) => b.id === targetByeId);
      if (!bye) throw new Error("Bye not found");

      const { data: tournament, error: tournamentError } = await client
        .from("tournaments")
        .select("bye_points, bye_differential")
        .eq("id", tournamentId)
        .single();

      if (tournamentError) throw tournamentError;

      const playerId = isSourcePlayer2 ? sourceMatch.player2_id.id : sourceMatch.player1_id.id;
      const playerName = isSourcePlayer2 ? sourceMatch.player2_id.name : sourceMatch.player1_id.name;
      const playerMatchPoints = isSourcePlayer2 ? sourceMatch.player2_match_points : sourceMatch.player1_match_points;
      const playerDiff = isSourcePlayer2 ? sourceMatch.differential2 : sourceMatch.differential;
      
      const { data: byePlayerData, error: byePlayerError } = await client
        .from("participants")
        .select("match_points, differential")
        .eq("id", bye.participant_id.id)
        .single();
      
      if (byePlayerError) throw byePlayerError;
      
      const byePlayerOriginalPoints = Math.max(0, (byePlayerData.match_points || 0) - tournament.bye_points);
      const byePlayerOriginalDiff = (byePlayerData.differential || 0) - tournament.bye_differential;
      
      const newByePlayerPoints = playerMatchPoints + tournament.bye_points;
      const newByePlayerDiff = playerDiff + tournament.bye_differential;
      
      if (isSourcePlayer2) {
        await client.from("matches").update({
          player2_id: bye.participant_id.id,
          player2_match_points: byePlayerOriginalPoints,
          differential2: byePlayerOriginalDiff,
          player1_score: null,
          player2_score: null,
        }).eq("id", sourceMatch.id);
      } else {
        await client.from("matches").update({
          player1_id: bye.participant_id.id,
          player1_match_points: byePlayerOriginalPoints,
          differential: byePlayerOriginalDiff,
          player1_score: null,
          player2_score: null,
        }).eq("id", sourceMatch.id);
      }

      await client.from("byes").update({
        participant_id: playerId,
        match_points: newByePlayerPoints,
        differential: newByePlayerDiff,
      }).eq("id", targetByeId);

      await Promise.all([
        client.from("participants").update({
          match_points: byePlayerOriginalPoints,
          differential: byePlayerOriginalDiff,
        }).eq("id", bye.participant_id.id),
        
        client.from("participants").update({
          match_points: newByePlayerPoints,
          differential: newByePlayerDiff,
        }).eq("id", playerId)
      ]);

      setByes(prevByes => {
        const updatedByes = [...prevByes];
        const byeIndex = updatedByes.findIndex(b => b.id === targetByeId);
        
        if (byeIndex !== -1) {
          updatedByes[byeIndex] = {
            ...updatedByes[byeIndex],
            participant_id: {
              id: playerId,
              name: playerName
            },
            match_points: newByePlayerPoints,
            differential: newByePlayerDiff
          };
        }
        
        return updatedByes;
      });
      
      setMatches(prevMatches => {
        const updatedMatches = [...prevMatches];
        const matchIndex = updatedMatches.findIndex(m => m.id === sourceMatch.id);
        
        if (matchIndex !== -1) {
          const updatedMatch = {...updatedMatches[matchIndex]};
          
          if (isSourcePlayer2) {
            updatedMatch.player2_id = {
              id: bye.participant_id.id,
              name: bye.participant_id.name
            };
            updatedMatch.player2_match_points = byePlayerOriginalPoints;
            updatedMatch.differential2 = byePlayerOriginalDiff;
          } else {
            updatedMatch.player1_id = {
              id: bye.participant_id.id,
              name: bye.participant_id.name
            };
            updatedMatch.player1_match_points = byePlayerOriginalPoints;
            updatedMatch.differential = byePlayerOriginalDiff;
          }
          
          updatedMatch.player1_score = null;
          updatedMatch.player2_score = null;
          
          updatedMatches[matchIndex] = updatedMatch;
        }
        
        return updatedMatches;
      });

      await fetchCurrentRoundData();
    } catch (error) {
      console.error("Error swapping player with bye:", error);
      showToast("Error swapping player with bye. Please try again.", "error");
    } finally {
      setIsLoading(false);
    }
  };

  const handlePrintPairings = () => {
    printTournamentPairings(
      matches, 
      byes, 
      currentPage, 
      tournamentInfo.starting_table_number || 1,
      tournamentName || tournamentInfo.name // Use prop value first if available
    );
  };

  const handlePrintMatchSlips = () => {
    printMatchSlips(
      matches,
      currentPage,
      tournamentInfo.starting_table_number || 1,
      tournamentName || tournamentInfo.name
    );
  };
  
  const [participants, setParticipants] = useState<any[]>([]);

  const fetchAllParticipants = async () => {
    try {
      const { data, error } = await client
        .from("participants")
        .select("id, name, match_points, differential, dropped_out")
        .eq("tournament_id", tournamentId)
        .order("match_points", { ascending: false })
        .order("differential", { ascending: false });
      
      if (error) throw error;
      setParticipants(data || []);
    } catch (error) {
      console.error("Error fetching participants:", error);
    }
  };

  const handlePrintFinalStandings = () => {
    printFinalStandings(participants, tournamentName || tournamentInfo.name);
  };
  
  // Update local tournament name from parent prop when it changes
  useEffect(() => {
    if (tournamentName !== undefined && tournamentName !== tournamentInfo.name) {
      setTournamentInfo(prev => ({
        ...prev,
        name: tournamentName
      }));
    }
  }, [tournamentName]);

  // Fetch all participants when the tournament has ended
  useEffect(() => {
    if (tournamentInfo.has_ended) {
      fetchAllParticipants();
    }
  }, [tournamentInfo.has_ended]);

  return (
    <>
    <ToastNotification
      message={toast.message}
      show={toast.show}
      type={toast.type}
      duration={3500}
      onClose={() => setToast((prev) => ({ ...prev, show: false }))}
    />
    <div className="w-full max-w-[800px] mx-auto">
      <Card theme={{ root: { base: "flex rounded-lg border border-border bg-card shadow-sm", children: "flex h-full flex-col justify-center gap-4 p-3 sm:p-6" } }}>
        {error.message && (
          <div className="p-4 mb-4 text-sm text-destructive rounded-lg bg-destructive/10">
            {error.message}
          </div>
        )}
        {isLoading ? (
          <div className="flex items-center justify-center p-4">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-foreground"></div>
          </div>
        ) : (
          <div className="mt-4 max-w-full">
            {tournamentInfo.n_rounds && (
              <>
                <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-3 mb-4">
                  <div className="min-w-0">
                    <h3 className="text-xl font-semibold mb-1">
                      Round {currentPage} of {tournamentInfo.n_rounds}
                    </h3>
                    <div className="text-sm text-muted-foreground space-y-0.5">
                      {roundInfo.started_at && (
                        <p>
                          Started <span className="text-foreground">{formatDateTime(roundInfo.started_at)}</span>
                        </p>
                      )}
                      {roundInfo.ended_at && (
                        <p>
                          Ended <span className="text-foreground">{formatDateTime(roundInfo.ended_at)}</span>
                        </p>
                      )}
                    </div>
                  </div>
                  {currentPage === tournamentInfo.current_round && (
                      <div className="flex gap-2 flex-wrap">
                        {tournamentInfo.has_ended ? (
                          <Button
                            variant="accent"
                            size="sm"
                            onClick={handlePrintFinalStandings}
                          >
                            <span className="hidden sm:inline">Print Final Standings</span>
                            <span className="sm:hidden">Print</span>
                          </Button>
                        ) : (
                          <>
                            <Button
                              variant="accent"
                              size="sm"
                              onClick={handlePrintPairings}
                            >
                              <span className="hidden sm:inline">Print Pairings</span>
                              <span className="sm:hidden">Pairings</span>
                            </Button>
                            <Button
                              variant="accent"
                              size="sm"
                              onClick={handlePrintMatchSlips}
                            >
                              <span className="hidden sm:inline">Print Match Slips</span>
                              <span className="sm:hidden">Slips</span>
                            </Button>
                            <Button
                              variant={isRoundActive ? "destructive" : "success"}
                              size="sm"
                              onClick={
                                isRoundActive
                                  ? () => setEndRoundConfirmOpen(true)
                                  : handleStartRound
                              }
                              disabled={matchEnding}
                            >
                              {isRoundActive ? "End Round" : "Start Round"}
                            </Button>
                          </>
                        )}
                      </div>
                    )}
                </div>
                <div className="overflow-x-auto max-w-full bg-card text-foreground">
                  {repairMode && (
                    <div className="bg-primary/10 border border-primary/30 text-foreground p-3 mb-4 rounded-lg text-center">
                      <p>
                        Re-pair Mode Active - <span className="font-semibold text-primary dark:text-yellow-300">Select another player</span> to swap with {
                          repairSourceMatch.isBye
                            ? byes.find(b => b.id === repairSourceMatch.byeId)?.participant_id.name
                            : (repairSourceMatch.isPlayer2
                              ? repairSourceMatch.match?.player2_id?.name
                              : repairSourceMatch.match?.player1_id?.name)
                        }
                      </p>
                      <p className="text-sm text-muted-foreground mt-1">
                        Click any player or <button onClick={() => {setRepairMode(false); setRepairSourceMatch(null);}} className="text-primary hover:text-primary/80 underline">cancel</button>
                      </p>
                    </div>
                  )}
                  {matches && matches.length > 0 && <table className="hidden md:table min-w-full text-sm text-left text-muted-foreground border-2 border-border">
                    <thead className="text-xs uppercase font-normal text-foreground bg-muted border-b-2 border-border rounded-t-lg">
                      <tr>
                        <th scope="col" className="px-4 py-2 text-center">
                          Table
                        </th>
                        <th scope="col" className="px-4 py-2 text-center">
                          Player 1
                        </th>
                        <th scope="col" className="px-4 py-2 text-center">
                          Player 2
                        </th>
                        <th scope="col" className="px-4 py-2 text-center">
                          Match Points (P1 / P2)
                        </th>
                        <th scope="col" className="px-4 py-2 text-center">
                          Differential (P1 / P2)
                        </th>
                        <th scope="col" className="px-4 py-2 text-right">
                          <span className="sr-only">Actions</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {matches.length > 0 &&
                        matches.map((match, index) => {
                          const repairEnabled =
                            currentPage === tournamentInfo.current_round && !roundInfo.started_at;
                          const isP1Selected =
                            repairMode &&
                            repairSourceMatch &&
                            !repairSourceMatch.isBye &&
                            repairSourceMatch.match?.id === match.id &&
                            !repairSourceMatch.isPlayer2;
                          const isP2Selected =
                            repairMode &&
                            repairSourceMatch &&
                            !repairSourceMatch.isBye &&
                            repairSourceMatch.match?.id === match.id &&
                            repairSourceMatch.isPlayer2;
                          const swapButtonClass = (selected: boolean) =>
                            `p-2 rounded-md flex items-center justify-center ${
                              repairEnabled
                                ? selected
                                  ? "text-yellow-600 dark:text-yellow-400 bg-primary/15 hover:bg-primary/25 hover:text-yellow-700 dark:hover:text-yellow-300 cursor-pointer"
                                  : "text-primary hover:bg-muted hover:text-primary/80 cursor-pointer"
                                : "text-muted-foreground cursor-not-allowed"
                            }`;
                          return (
                            <Fragment key={match.id}>
                              <tr className={`border-b border-border ${matchErrorIndex.includes(index) ? "bg-red-600/20" : "bg-muted/50"}`}>
                                <td className={`px-4 py-2 text-center border-r ${matchErrorIndex.includes(index) ? "border-red-400" : "border-border"}`}>
                                  {index + (tournamentInfo.starting_table_number || 1)}
                                </td>
                                <td className={`px-4 py-2 text-center border-r text-foreground ${matchErrorIndex.includes(index) ? "border-red-400" : "border-border"}`}>
                                  {match.player1_id.name}
                                </td>
                                <td className={`px-4 py-2 text-center border-r text-foreground ${matchErrorIndex.includes(index) ? "border-red-400" : "border-border"}`}>
                                  {match.player2_id.name}
                                </td>
                                <td className={`px-4 py-2 text-center border-r tabular-nums ${matchErrorIndex.includes(index) ? "border-red-400" : "border-border"}`}>
                                  {match.player1_match_points} / {match.player2_match_points}
                                </td>
                                <td className={`px-4 py-2 text-center border-r tabular-nums ${matchErrorIndex.includes(index) ? "border-red-400" : "border-border"}`}>
                                  {match.differential ?? "N/A"} / {match.differential2 ?? "N/A"}
                                </td>
                                <td className="px-2">
                                  <div className="flex items-center justify-end gap-1 flex-wrap">
                                    <MatchEditModal
                                      key={match.player1_score + match.player2_score}
                                      match={match}
                                      fetchCurrentRoundData={fetchCurrentRoundData}
                                      setMatchErrorIndex={setMatchErrorIndex}
                                      isRoundActive={isRoundActive}
                                      index={index}
                                      tournament={tournamentInfo}
                                      mode="edit"
                                    />
                                    <button
                                      title={currentPage === tournamentInfo.current_round ? (!roundInfo.started_at ? `Swap ${match.player1_id.name}` : "Cannot re-pair pairing once round has started") : "Can only re-pair current round"}
                                      aria-label={`Swap ${match.player1_id.name}`}
                                      className={swapButtonClass(!!isP1Selected)}
                                      onClick={() => {
                                        if (repairEnabled) handleRepairClick(match, false);
                                      }}
                                      disabled={!repairEnabled}
                                    >
                                      <ArrowUpDown className="h-4 w-4" />
                                    </button>
                                    <button
                                      title={currentPage === tournamentInfo.current_round ? (!roundInfo.started_at ? `Swap ${match.player2_id.name}` : "Cannot re-pair pairing once round has started") : "Can only re-pair current round"}
                                      aria-label={`Swap ${match.player2_id.name}`}
                                      className={swapButtonClass(!!isP2Selected)}
                                      onClick={() => {
                                        if (repairEnabled) handleRepairClick(match, true);
                                      }}
                                      disabled={!repairEnabled}
                                    >
                                      <ArrowUpDown className="h-4 w-4" />
                                    </button>
                                    {isHost && isRoundCompleted && (
                                      <MatchEditModal
                                        key={`repair-${match.id}`}
                                        match={match}
                                        fetchCurrentRoundData={fetchCurrentRoundData}
                                        setMatchErrorIndex={setMatchErrorIndex}
                                        isRoundActive={false}
                                        index={index}
                                        tournament={tournamentInfo}
                                        mode="repair"
                                        onRepairSuccess={() => {
                                          showToast("Result repaired.", "success");
                                          fetchMatchEdits();
                                          onRepairCompleted?.();
                                        }}
                                      />
                                    )}
                                  </div>
                                </td>
                              </tr>
                              {isHost && (matchEditsByMatch[match.id]?.length ?? 0) > 0 && (
                                <tr className="border-b border-border bg-muted/30">
                                  <td colSpan={6} className="px-4 py-1">
                                    <details className="text-xs">
                                      <summary className="cursor-pointer text-muted-foreground">
                                        Edit history ({matchEditsByMatch[match.id]!.length})
                                      </summary>
                                      <ul className="mt-1 ml-3 space-y-1">
                                        {matchEditsByMatch[match.id]!.map(e => (
                                          <li key={e.id} className="text-muted-foreground">
                                            {e.old_player1_score}-{e.old_player2_score} → {e.new_player1_score}-{e.new_player2_score}
                                            {" · "}{new Date(e.edited_at).toLocaleString()}
                                            {e.reason ? ` · ${e.reason}` : ""}
                                          </li>
                                        ))}
                                      </ul>
                                    </details>
                                  </td>
                                </tr>
                              )}
                            </Fragment>
                          );
                        })}
                    </tbody>
                  </table>}

                  {/* Mobile pairing cards */}
                  {matches && matches.length > 0 && (
                    <div className="md:hidden space-y-2">
                      {matches.map((match, index) => {
                        const isError = matchErrorIndex.includes(index);
                        const tableNum = index + (tournamentInfo.starting_table_number || 1);
                        const repairEnabled =
                          currentPage === tournamentInfo.current_round && !roundInfo.started_at;
                        const isP1Selected =
                          repairMode &&
                          repairSourceMatch &&
                          !repairSourceMatch.isBye &&
                          repairSourceMatch.match?.id === match.id &&
                          !repairSourceMatch.isPlayer2;
                        const isP2Selected =
                          repairMode &&
                          repairSourceMatch &&
                          !repairSourceMatch.isBye &&
                          repairSourceMatch.match?.id === match.id &&
                          repairSourceMatch.isPlayer2;

                        const swapButtonClass = (selected: boolean) =>
                          `p-2 rounded-md flex items-center justify-center flex-shrink-0 ${
                            repairEnabled
                              ? selected
                                ? "text-yellow-600 dark:text-yellow-400 bg-primary/15 hover:bg-primary/25"
                                : "text-primary hover:bg-muted"
                              : "text-muted-foreground cursor-not-allowed"
                          }`;

                        return (
                          <div
                            key={match.id}
                            className={`rounded-lg border ${
                              isError ? "border-red-500/60 bg-red-600/10" : "border-border bg-card"
                            } p-3`}
                          >
                            <div className="flex items-center justify-between gap-2 mb-2">
                              <span className="text-xs uppercase tracking-wide text-muted-foreground whitespace-nowrap">
                                Table {tableNum}
                              </span>
                              <div className="flex items-center gap-1 flex-shrink-0">
                                <div className="w-10 h-10">
                                  <MatchEditModal
                                    key={match.player1_score + match.player2_score}
                                    match={match}
                                    fetchCurrentRoundData={fetchCurrentRoundData}
                                    setMatchErrorIndex={setMatchErrorIndex}
                                    isRoundActive={isRoundActive}
                                    index={index}
                                    tournament={tournamentInfo}
                                    mode="edit"
                                  />
                                </div>
                                {isHost && isRoundCompleted && (
                                  <div className="w-11 h-11">
                                    <MatchEditModal
                                      key={`repair-${match.id}`}
                                      match={match}
                                      fetchCurrentRoundData={fetchCurrentRoundData}
                                      setMatchErrorIndex={setMatchErrorIndex}
                                      isRoundActive={false}
                                      index={index}
                                      tournament={tournamentInfo}
                                      mode="repair"
                                      onRepairSuccess={() => {
                                        showToast("Result repaired.", "success");
                                        fetchMatchEdits();
                                        onRepairCompleted?.();
                                      }}
                                    />
                                  </div>
                                )}
                              </div>
                            </div>
                            <div className="space-y-2">
                              <div className="flex items-center gap-2">
                                <div className="flex-1 min-w-0">
                                  <p className="font-medium text-foreground truncate">
                                    {match.player1_id.name}
                                  </p>
                                  <p className="text-xs text-muted-foreground tabular-nums">
                                    Match Pts {match.player1_match_points} · Diff {match.differential ?? "N/A"}
                                  </p>
                                </div>
                                <button
                                  title={
                                    repairEnabled
                                      ? "Re-pair pairing"
                                      : "Cannot re-pair after round started"
                                  }
                                  className={swapButtonClass(!!isP1Selected)}
                                  onClick={() => repairEnabled && handleRepairClick(match, false)}
                                  disabled={!repairEnabled}
                                >
                                  <ArrowUpDown className="h-4 w-4" />
                                </button>
                              </div>
                              <div className="flex items-center gap-2 pt-2 border-t border-border">
                                <div className="flex-1 min-w-0">
                                  <p className="font-medium text-foreground truncate">
                                    {match.player2_id.name}
                                  </p>
                                  <p className="text-xs text-muted-foreground tabular-nums">
                                    Match Pts {match.player2_match_points} · Diff {match.differential2 ?? "N/A"}
                                  </p>
                                </div>
                                <button
                                  title={
                                    repairEnabled
                                      ? "Re-pair pairing"
                                      : "Cannot re-pair after round started"
                                  }
                                  className={swapButtonClass(!!isP2Selected)}
                                  onClick={() => repairEnabled && handleRepairClick(match, true)}
                                  disabled={!repairEnabled}
                                >
                                  <ArrowUpDown className="h-4 w-4" />
                                </button>
                              </div>
                            </div>
                            {isHost && (matchEditsByMatch[match.id]?.length ?? 0) > 0 && (
                              <details className="mt-2 text-xs">
                                <summary className="cursor-pointer text-muted-foreground">
                                  Edit history ({matchEditsByMatch[match.id]!.length})
                                </summary>
                                <ul className="mt-1 ml-3 space-y-1">
                                  {matchEditsByMatch[match.id]!.map(e => (
                                    <li key={e.id} className="text-muted-foreground">
                                      {e.old_player1_score}-{e.old_player2_score} → {e.new_player1_score}-{e.new_player2_score}
                                      {" · "}{new Date(e.edited_at).toLocaleString()}
                                      {e.reason ? ` · ${e.reason}` : ""}
                                    </li>
                                  ))}
                                </ul>
                              </details>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {byes && byes.length > 0 && <>
                  <h3 className="text-foreground text-lg font-semibold mt-7 mb-3 text-center">Game Byes</h3>

                  {/* Mobile bye cards */}
                  <div className="md:hidden space-y-2">
                    {byes.map((bye) => {
                      const repairEnabled =
                        currentPage === tournamentInfo.current_round && !roundInfo.started_at;
                      const isSelected =
                        repairMode &&
                        repairSourceMatch &&
                        repairSourceMatch.isBye &&
                        repairSourceMatch.byeId === bye.id;
                      return (
                        <div
                          key={bye.id}
                          className="rounded-lg border border-border bg-card p-3 flex items-center gap-3"
                        >
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-foreground truncate">
                              {bye.participant_id.name}
                            </p>
                            <p className="text-xs text-muted-foreground tabular-nums">
                              Match Pts {bye.match_points} · Diff {bye.differential} · Bye
                            </p>
                          </div>
                          <button
                            title={
                              repairEnabled
                                ? "Re-pair pairing"
                                : "Cannot re-pair after round started"
                            }
                            className={`p-2 rounded-md flex items-center justify-center flex-shrink-0 ${
                              repairEnabled
                                ? isSelected
                                  ? "text-yellow-600 dark:text-yellow-400 bg-primary/15 hover:bg-primary/25"
                                  : "text-primary hover:bg-muted"
                                : "text-muted-foreground cursor-not-allowed"
                            }`}
                            onClick={() => repairEnabled && handleByeRepairClick(bye)}
                            disabled={!repairEnabled}
                          >
                            <ArrowUpDown className="h-4 w-4" />
                          </button>
                        </div>
                      );
                    })}
                  </div>

                  <div className="hidden md:block overflow-x-auto max-w-full bg-card text-foreground">
                    <table className="min-w-full text-sm text-left text-muted-foreground border-2 border-border">
                      <thead className="text-xs uppercase font-normal text-foreground bg-muted border-b-2 border-border rounded-t-lg">
                        <tr>
                          <th scope="col" className="px-4 py-2 text-center">
                            Table
                          </th>
                          <th scope="col" className="px-4 py-2 text-center">
                            Name
                          </th>
                          <th scope="col" className="px-4 py-2 text-center">
                            Opponent
                          </th>
                          <th scope="col" className="px-4 py-2 text-center">
                            Match Points
                          </th>
                          <th scope="col" className="px-4 py-2 text-center">
                            Differential
                          </th>
                          <th scope="col" className="px-4 py-2 text-right">
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {byes.length > 0 &&
                          byes.map((bye, index) => (
                            <Fragment key={bye.id}>
                              <tr className="border-b border-border bg-muted/50">
                                <td className="px-4 py-2 text-center border-r border-border">
                                  N/A
                                </td>
                                <td className="px-4 py-2 text-center border-r border-border">
                                  {bye.participant_id.name}
                                </td>
                                <td className="px-4 py-2 text-center border-r border-border">
                                  N/A
                                </td>
                                <td className="px-4 py-2 text-center border-r border-border">
                                  {bye.match_points}
                                </td>
                                <td className="px-4 py-2 text-center border-r border-border">
                                  {bye.differential}
                                </td>
                                <td className="px-2">
                                  <button
                                    title={currentPage === tournamentInfo.current_round ? (!roundInfo.started_at ? "Re-pair pairing" : "Cannot re-pair pairing once round has started") : "Can only re-pair current round"}
                                    className={`p-2 rounded-md flex items-center justify-center ${
                                      currentPage === tournamentInfo.current_round && !roundInfo.started_at
                                        ? repairMode && repairSourceMatch && repairSourceMatch.isBye && repairSourceMatch.byeId === bye.id
                                          ? "text-yellow-600 dark:text-yellow-400 bg-primary/15 hover:bg-primary/25 hover:text-yellow-700 dark:hover:text-yellow-300 cursor-pointer"
                                          : repairMode
                                            ? "text-primary hover:bg-muted hover:text-primary/80 cursor-pointer"
                                            : "text-primary hover:bg-muted hover:text-primary/80 cursor-pointer"
                                        : "text-muted-foreground cursor-not-allowed"
                                    }`}
                                    onClick={() => {
                                      if (currentPage === tournamentInfo.current_round && !roundInfo.started_at) {
                                        handleByeRepairClick(bye);
                                      }
                                    }}
                                    disabled={currentPage !== tournamentInfo.current_round || !!roundInfo.started_at}
                                  >
                                    <ArrowUpDown className="h-4 w-4" />
                                  </button>
                                </td>
                              </tr>
                            </Fragment>
                          ))}
                      </tbody>
                    </table>
                  </div>
                </>}

                <div className="flex overflow-x-auto sm:justify-center pb-3">
                  <Pagination
                    currentPage={currentPage}
                    totalPages={tournamentInfo.current_round || 1}
                    onPageChange={onPageChange}
                    showIcons
                    theme={{
                      pages: {
                        base: "xs:mt-0 mt-2 inline-flex items-center -space-x-px",
                        showIcon: "inline-flex",
                        previous: {
                          base: "ml-0 rounded-l-lg border border-border bg-card px-3 py-2 leading-tight text-muted-foreground enabled:hover:bg-muted enabled:hover:text-foreground",
                          icon: "h-5 w-5",
                        },
                        next: {
                          base: "rounded-r-lg border border-border bg-card px-3 py-2 leading-tight text-muted-foreground enabled:hover:bg-muted enabled:hover:text-foreground",
                          icon: "h-5 w-5",
                        },
                        selector: {
                          base: "w-12 border border-border bg-card py-2 leading-tight text-muted-foreground enabled:hover:bg-muted enabled:hover:text-foreground",
                          active: "bg-primary/15 text-primary border-primary/40 hover:bg-primary/25 hover:text-primary",
                          disabled: "cursor-not-allowed opacity-50",
                        },
                      },
                    }}
                  />
                </div>
              </>
            )}
          </div>
        )
        }
      </Card >
      
      {selectedMatch && (
        <RepairPairingModal
          isOpen={repairModalOpen}
          onClose={() => setRepairModalOpen(false)}
          match={selectedMatch}
          tournamentId={tournamentId}
          roundNumber={currentPage}
          fetchCurrentRoundData={fetchCurrentRoundData}
          isRoundActive={isRoundActive}
        />
      )}
      <ConfirmationDialog
        open={endRoundConfirmOpen}
        onOpenChange={setEndRoundConfirmOpen}
        onConfirm={handleEndRound}
        variant="destructive"
        title={`End Round ${currentPage}?`}
        description="All matches will be locked and new pairings will be generated for the next round."
        confirmLabel="End round"
        cancelLabel="Cancel"
      />
    </div >
    </>
  );
}
