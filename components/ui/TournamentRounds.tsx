"use client";

import { Button, Card, Pagination } from "flowbite-react";
import { Dispatch, Fragment, SetStateAction, useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "../../utils/supabase/client";
import MatchEditModal from "./match-edit";
import RepairPairingModal from "./RepairPairingModal";
import { ArrowUpDown } from "lucide-react";
import { useTheme } from "next-themes";

const formatDateTime = (timestamp: string | null) => {
  if (!timestamp) return "";
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp));
};

interface TournamentRoundsProps {
  tournamentId: string;
  isActive: boolean;
  onTournamentEnd?: () => void;
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
}

interface TournamentInfo {
  n_rounds: number | null;
  current_round: number | null;
  has_ended: boolean;
  max_score: number | null;
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
  activeTab
}: TournamentRoundsProps) {
  const [tournamentInfo, setTournamentInfo] = useState<TournamentInfo>({
    n_rounds: null,
    current_round: null,
    has_ended: false,
    max_score: null,
  });
  const hasFetchedTournament = useRef<boolean>(false);
  const client = createClient();
  const [error, setError] = useState<ErrorState>({ message: null, type: null });
  const [isLoading, setIsLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState(tournamentInfo.current_round || 1);
  const [isRoundActive, setIsRoundActive] = useState(false);
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
  const { theme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

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
          .select("n_rounds, current_round, has_ended, max_score")
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
  }, [fetchTournamentAndRoundInfo, isActive]);

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
    fetchCurrentRoundData();
  }, [currentPage]);

  const handleEndRound = useCallback(async () => {
    const client = createClient();

    let matchErrorIndexArr = [];

    matches.forEach((match, index) => {
      if (match.player1_score === null || match.player2_score === null) {
        setMatchErrorIndex((matchErrorIndex) => [...matchErrorIndex, index]);
        matchErrorIndexArr.push(matchErrorIndex);
      }
    });

    if (matchErrorIndexArr.length > 0) {
      alert("Please add scores to all matches.");
      return;
    }

    setMatchEnding(true);

    try {
      const now = new Date().toISOString();

      for (const match of matches) {
        const { error: participant1SelectError, data: participant1 } = await client
          .from("participants")
          .select()
          .eq("id", match.player1_id.id)
          .single();
        if (participant1SelectError) throw participant1SelectError;

        const { error: participant2SelectError, data: participant2 } = await client
          .from("participants")
          .select()
          .eq("id", match.player2_id.id)
          .single();
        if (participant2SelectError) throw participant2SelectError;

        if (match.player2_score === match.player1_score) {
          await Promise.all([
            client.from("participants").update({
              match_points: (participant1.match_points || 0) + 1.5,
              differential: (participant1.differential || 0),
            }).eq("id", match.player1_id.id),

            client.from("participants").update({
              match_points: (participant2.match_points || 0) + 1.5,
              differential: (participant2.differential || 0),
            }).eq("id", match.player2_id.id),
          ]);
        } else if (match.player1_score === tournamentInfo.max_score) {
          await Promise.all([
            client.from("participants").update({
              match_points: (participant1.match_points || 0) + 3,
              differential: (match.player1_score - match.player2_score) + (participant1.differential || 0),
            }).eq("id", match.player1_id.id),

            client.from("participants").update({
              match_points: (participant2.match_points || 0),
              differential: (match.player2_score - match.player1_score) + (participant2.differential || 0),
            }).eq("id", match.player2_id.id),
          ]);

        } else if (match.player2_score === tournamentInfo.max_score) {
          await Promise.all([
            client.from("participants").update({
              match_points: (participant2.match_points || 0) + 3,
              differential: (match.player2_score - match.player1_score) + (participant2.differential || 0),
            }).eq("id", match.player2_id.id),

            client.from("participants").update({
              match_points: (participant1.match_points || 0),
              differential: (match.player1_score - match.player2_score) + (participant1.differential || 0),
            }).eq("id", match.player1_id.id),
          ]);

        } else if (match.player1_score > match.player2_score) {
          await Promise.all([
            client.from("participants").update({
              match_points: (participant1.match_points || 0) + 2,
              differential: (match.player1_score - match.player2_score) + (participant1.differential || 0),
            }).eq("id", match.player1_id.id),

            client.from("participants").update({
              match_points: (participant2.match_points || 0) + 1,
              differential: (match.player2_score - match.player1_score) + (participant2.differential || 0),
            }).eq("id", match.player2_id.id),
          ]);

        } else if (match.player2_score > match.player1_score) {
          await Promise.all([
            client.from("participants").update({
              match_points: (participant2.match_points || 0) + 2,
              differential: (match.player2_score - match.player1_score) + (participant2.differential || 0),
            }).eq("id", match.player2_id.id),

            client.from("participants").update({
              match_points: (participant1.match_points || 0) + 1,
              differential: (match.player1_score - match.player2_score) + (participant1.differential || 0),
            }).eq("id", match.player1_id.id),
          ]);
        }
      }

      if (byes && byes.length > 0) {
        byes.forEach(async (bye) => {
          const { error: participantUpdateError } = await client.from("participants").update({
            match_points: (bye.match_points ?? 0),
            differential: (bye.differential ?? 0),
          }).eq("id", bye.participant_id.id);
          if (participantUpdateError) console.log(participantUpdateError);
        });
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

        onTournamentEnd?.();
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
  }, [matches]);

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
      alert("Error swapping players. Please try again.");
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
      alert("Error swapping players with bye. Please try again.");
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
      alert("Error swapping player with bye. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const currentTheme = mounted ? (theme === 'system' ? resolvedTheme : theme) : 'dark';
  const isLightTheme = currentTheme === 'light';

  return (
    <div className="w-[800px] max-xl:w-full mx-auto overflow-x-auto">
      <Card>
        {error.message && (
          <div className="p-4 mb-4 text-sm text-red-800 rounded-lg bg-red-50">
            {error.message}
          </div>
        )}
        {isLoading ? (
          <div className="flex items-center justify-center p-4">
            <div className={`animate-spin rounded-full h-8 w-8 border-b-2 ${isLightTheme ? 'border-gray-600' : 'border-gray-900'}`}></div>
          </div>
        ) : (
          <div className="mt-4 max-w-full">
            {tournamentInfo.n_rounds && (
              <>
                <div className="flex justify-between items-center mb-4">
                  <div>
                    <h3 className="text-xl font-semibold mb-1">
                      Round {currentPage} of {tournamentInfo.n_rounds}
                    </h3>
                    <div className="space-y-1">
                      <p className={`text-sm ${isLightTheme ? 'text-gray-600' : 'text-gray-500'} mr-4`}>
                        Started at: <span className={isLightTheme ? 'text-gray-800' : 'text-zinc-400'}>{formatDateTime(roundInfo.started_at)}</span>
                      </p>
                      <p className={`text-sm ${isLightTheme ? 'text-gray-600' : 'text-gray-500'} mr-4`}>
                        Ended at: <span className={isLightTheme ? 'text-gray-800' : 'text-zinc-400'}>{formatDateTime(roundInfo.ended_at)}</span>
                      </p>
                    </div>
                  </div>
                  {currentPage === tournamentInfo.current_round &&
                    !tournamentInfo.has_ended && (
                      <Button
                        outline
                        gradientDuoTone={
                          isRoundActive ? "pinkToOrange" : "greenToBlue"
                        }
                        onClick={
                          isRoundActive ? handleEndRound : handleStartRound
                        }
                        disabled={matchEnding}
                      >
                        {isRoundActive ? "End Round" : "Start Round"}
                      </Button>
                    )}
                </div>
                <div className={`overflow-x-auto max-w-full ${isLightTheme ? 'bg-white text-gray-800' : 'bg-gray-800 text-white'}`}>
                  {repairMode && (
                    <div className={`${isLightTheme ? 'bg-blue-100/60 border-blue-300 text-blue-800' : 'bg-blue-900/30 border-blue-700 text-white'} border p-3 mb-4 rounded-lg text-center`}>
                      <p>
                        Re-pair Mode Active - <span className={`font-semibold ${isLightTheme ? 'text-blue-700' : 'text-yellow-300'}`}>Select another player</span> to swap with {
                          repairSourceMatch.isBye 
                            ? byes.find(b => b.id === repairSourceMatch.byeId)?.participant_id.name 
                            : (repairSourceMatch.isPlayer2 
                              ? repairSourceMatch.match?.player2_id?.name 
                              : repairSourceMatch.match?.player1_id?.name)
                        }
                      </p>
                      <p className={`text-sm ${isLightTheme ? 'text-blue-600' : 'text-gray-300'} mt-1`}>
                        Click any player or <button onClick={() => {setRepairMode(false); setRepairSourceMatch(null);}} className={`${isLightTheme ? 'text-blue-700 hover:text-blue-800' : 'text-blue-400 hover:text-blue-300'} underline`}>cancel</button>
                      </p>
                    </div>
                  )}
                  {matches && matches.length > 0 && <table className={`min-w-full text-sm text-left ${isLightTheme ? 'text-gray-600 border-gray-200' : 'text-gray-400 border-gray-300'} border-2`}>
                    <thead className={`text-xs uppercase font-normal ${isLightTheme ? 'text-gray-700 bg-gray-100 border-gray-200' : 'text-zinc-100 bg-gray-900 border-gray-300'} border-b-2 rounded-t-lg`}>
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
                          <span className="sr-only">Actions</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {matches.length > 0 &&
                        matches.map((match, index) => (
                          <Fragment key={match.id}>
                            <tr className={`border-b ${isLightTheme ? 'border-gray-200' : 'border-gray-400/70'} ${matchErrorIndex.includes(index) ? "bg-red-600/20" : isLightTheme ? 'bg-gray-50' : 'bg-slate-800'}`}>
                              <td className={`px-4 py-2 text-center border-r ${matchErrorIndex.includes(index) ? "border-red-400" : isLightTheme ? 'border-gray-200' : 'border-zinc-400'}`}>
                                {index + 1}
                              </td>
                              <td className={`px-4 py-2 text-center border-r ${isLightTheme ? 'text-gray-800 border-gray-200' : 'text-zinc-200 border-zinc-400'} ${matchErrorIndex.includes(index) ? "border-red-400" : ""}`}>
                                {match.player1_id.name}
                              </td>
                              <td className={`px-4 py-2 text-center border-r ${isLightTheme ? 'text-gray-800 border-gray-200' : 'text-zinc-200 border-zinc-400'} ${matchErrorIndex.includes(index) ? "border-red-400" : ""}`}>
                                {match.player2_id.name}
                              </td>
                              <td className={`px-4 py-2 text-center border-r ${matchErrorIndex.includes(index) ? "border-red-400" : isLightTheme ? 'border-gray-200' : 'border-zinc-400'}`}>
                                {match.player1_match_points}
                              </td>
                              <td className={`px-4 py-2 text-center border-r ${matchErrorIndex.includes(index) ? "border-red-400" : isLightTheme ? 'border-gray-200' : 'border-zinc-400'}`}>
                                {match.differential ?? "N/A"}
                              </td>
                              <td className="px-2">
                                <div className="flex items-center space-x-1">
                                  <MatchEditModal
                                    key={match.player1_score + match.player2_score}
                                    match={match}
                                    fetchCurrentRoundData={fetchCurrentRoundData}
                                    setMatchErrorIndex={setMatchErrorIndex}
                                    isRoundActive={isRoundActive}
                                    index={index}
                                    tournament={tournamentInfo}
                                  />
                                  <button
                                    title={currentPage === tournamentInfo.current_round ? (!roundInfo.started_at ? "Re-pair pairing" : "Cannot re-pair pairing once round has started") : "Can only re-pair current round"}
                                    className={`p-2 rounded-md flex items-center justify-center ${
                                      currentPage === tournamentInfo.current_round && !roundInfo.started_at
                                        ? repairMode && repairSourceMatch && 
                                          (repairSourceMatch.isBye 
                                            ? false 
                                            : (repairSourceMatch.match && repairSourceMatch.match.id === match.id && !repairSourceMatch.isPlayer2))
                                          ? `${isLightTheme ? 'text-yellow-600 bg-blue-100 hover:bg-blue-200 hover:text-yellow-700' : 'text-yellow-400 bg-blue-900/40 hover:bg-blue-900/60 hover:text-yellow-300'} cursor-pointer` 
                                          : repairMode 
                                            ? `${isLightTheme ? 'text-green-600 hover:bg-gray-100 hover:text-green-700' : 'text-green-400 hover:bg-gray-700 hover:text-green-300'} cursor-pointer` 
                                            : `${isLightTheme ? 'text-blue-600 hover:bg-gray-100 hover:text-blue-700' : 'text-blue-400 hover:bg-gray-700 hover:text-blue-300'} cursor-pointer`
                                        : `${isLightTheme ? 'text-gray-400' : 'text-gray-600'} cursor-not-allowed`
                                    }`}
                                    onClick={() => {
                                      if (currentPage === tournamentInfo.current_round && !roundInfo.started_at) {
                                        handleRepairClick(match, false);
                                      }
                                    }}
                                    disabled={currentPage !== tournamentInfo.current_round || !!roundInfo.started_at}
                                  >
                                    <ArrowUpDown className="h-4 w-4" />
                                  </button>
                                </div>
                              </td>
                            </tr>
                            <tr className={`border-b ${isLightTheme ? 'border-gray-200' : 'border-gray-300'} ${matchErrorIndex.includes(index) ? "bg-red-600/20" : isLightTheme ? 'bg-white' : 'bg-slate-700'}`}>
                              <td className={`px-4 py-2 text-center border-r ${matchErrorIndex.includes(index) ? "border-red-400" : isLightTheme ? 'border-gray-200' : 'border-zinc-400'}`}>
                                {index + 1}
                              </td>
                              <td className={`px-4 py-2 text-center border-r ${isLightTheme ? 'text-gray-800 border-gray-200' : 'text-zinc-200 border-zinc-400'} ${matchErrorIndex.includes(index) ? "border-red-400" : ""}`}>
                                {match.player2_id.name}
                              </td>
                              <td className={`px-4 py-2 text-center border-r ${isLightTheme ? 'text-gray-800 border-gray-200' : 'text-zinc-200 border-zinc-400'} ${matchErrorIndex.includes(index) ? "border-red-400" : ""}`}>
                                {match.player1_id.name}
                              </td>
                              <td className={`px-4 py-2 text-center border-r ${matchErrorIndex.includes(index) ? "border-red-400" : isLightTheme ? 'border-gray-200' : 'border-zinc-400'}`}>
                                {match.player2_match_points}
                              </td>
                              <td className={`px-4 py-2 text-center border-r ${matchErrorIndex.includes(index) ? "border-red-400" : isLightTheme ? 'border-gray-200' : 'border-zinc-400'}`}>
                                {match.differential2 ?? "N/A"}
                              </td>
                              <td className="px-2">
                                <div className="flex items-center space-x-1">
                                  <MatchEditModal
                                    key={match.player1_score + match.player2_score}
                                    match={match}
                                    fetchCurrentRoundData={fetchCurrentRoundData}
                                    setMatchErrorIndex={setMatchErrorIndex}
                                    isRoundActive={isRoundActive}
                                    index={index}
                                    tournament={tournamentInfo}
                                  />
                                  <button
                                    title={currentPage === tournamentInfo.current_round ? (!roundInfo.started_at ? "Re-pair pairing" : "Cannot re-pair pairing once round has started") : "Can only re-pair current round"}
                                    className={`p-2 rounded-md flex items-center justify-center ${
                                      currentPage === tournamentInfo.current_round && !roundInfo.started_at
                                        ? repairMode && repairSourceMatch && 
                                          (repairSourceMatch.isBye 
                                            ? false 
                                            : (repairSourceMatch.match && repairSourceMatch.match.id === match.id && repairSourceMatch.isPlayer2))
                                          ? `${isLightTheme ? 'text-yellow-600 bg-blue-100 hover:bg-blue-200 hover:text-yellow-700' : 'text-yellow-400 bg-blue-900/40 hover:bg-blue-900/60 hover:text-yellow-300'} cursor-pointer` 
                                          : repairMode 
                                            ? `${isLightTheme ? 'text-green-600 hover:bg-gray-100 hover:text-green-700' : 'text-green-400 hover:bg-gray-700 hover:text-green-300'} cursor-pointer` 
                                            : `${isLightTheme ? 'text-blue-600 hover:bg-gray-100 hover:text-blue-700' : 'text-blue-400 hover:bg-gray-700 hover:text-blue-300'} cursor-pointer`
                                        : `${isLightTheme ? 'text-gray-400' : 'text-gray-600'} cursor-not-allowed`
                                    }`}
                                    onClick={() => {
                                      if (currentPage === tournamentInfo.current_round && !roundInfo.started_at) {
                                        handleRepairClick(match, true);
                                      }
                                    }}
                                    disabled={currentPage !== tournamentInfo.current_round || !!roundInfo.started_at}
                                  >
                                    <ArrowUpDown className="h-4 w-4" />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          </Fragment>
                        ))}
                    </tbody>
                  </table>}
                </div>

                {byes && byes.length > 0 && <>
                  <h3 className={`${isLightTheme ? 'text-gray-800' : 'text-white'} text-lg font-semibold mt-7 mb-3 text-center`}>Game Byes</h3>
                  <div className={`overflow-x-auto max-w-full ${isLightTheme ? 'bg-white text-gray-800' : 'bg-gray-800 text-white'}`}>
                    <table className={`min-w-full text-sm text-left ${isLightTheme ? 'text-gray-600 border-gray-200' : 'text-gray-400 border-gray-300'} border-2`}>
                      <thead className={`text-xs uppercase font-normal ${isLightTheme ? 'text-gray-700 bg-gray-100 border-gray-200' : 'text-zinc-100 bg-gray-900 border-gray-300'} border-b-2 rounded-t-lg`}>
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
                              <tr className={`border-b ${isLightTheme ? 'border-gray-200 bg-gray-50' : 'border-gray-400/70 bg-slate-800'}`}>
                                <td className={`px-4 py-2 text-center border-r ${isLightTheme ? 'border-gray-200' : 'border-zinc-400'}`}>
                                  N/A
                                </td>
                                <td className={`px-4 py-2 text-center border-r ${isLightTheme ? 'border-gray-200' : 'border-zinc-400'}`}>
                                  {bye.participant_id.name}
                                </td>
                                <td className={`px-4 py-2 text-center border-r ${isLightTheme ? 'border-gray-200' : 'border-zinc-400'}`}>
                                  N/A
                                </td>
                                <td className={`px-4 py-2 text-center border-r ${isLightTheme ? 'border-gray-200' : 'border-zinc-400'}`}>
                                  {bye.match_points}
                                </td>
                                <td className={`px-4 py-2 text-center border-r ${isLightTheme ? 'border-gray-200' : 'border-zinc-400'}`}>
                                  {bye.differential}
                                </td>
                                <td className="px-2">
                                  <button
                                    title={currentPage === tournamentInfo.current_round ? (!roundInfo.started_at ? "Re-pair pairing" : "Cannot re-pair pairing once round has started") : "Can only re-pair current round"}
                                    className={`p-2 rounded-md flex items-center justify-center ${
                                      currentPage === tournamentInfo.current_round && !roundInfo.started_at
                                        ? repairMode && repairSourceMatch && repairSourceMatch.isBye && repairSourceMatch.byeId === bye.id
                                          ? `${isLightTheme ? 'text-yellow-600 bg-blue-100 hover:bg-blue-200 hover:text-yellow-700' : 'text-yellow-400 bg-blue-900/40 hover:bg-blue-900/60 hover:text-yellow-300'} cursor-pointer` 
                                          : repairMode 
                                            ? `${isLightTheme ? 'text-green-600 hover:bg-gray-100 hover:text-green-700' : 'text-green-400 hover:bg-gray-700 hover:text-green-300'} cursor-pointer` 
                                            : `${isLightTheme ? 'text-blue-600 hover:bg-gray-100 hover:text-blue-700' : 'text-blue-400 hover:bg-gray-700 hover:text-blue-300'} cursor-pointer`
                                        : `${isLightTheme ? 'text-gray-400' : 'text-gray-600'} cursor-not-allowed`
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
    </div >
  );
}
