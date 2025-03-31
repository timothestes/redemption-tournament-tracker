"use client";

import { Button, Card, Pagination } from "flowbite-react";
import {
  Dispatch,
  Fragment,
  SetStateAction,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { createClient } from "../../utils/supabase/client";
import MatchEditModal from "./match-edit";

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
  onRoundActiveChange?: (isActive: boolean, roundStartTime: string | null) => void;
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
}: TournamentRoundsProps) {
  const [tournamentInfo, setTournamentInfo] = useState<TournamentInfo>({
    n_rounds: null,
    current_round: null,
    has_ended: false,
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

  // Re-fetch when activeTab changes
  useEffect(() => {
    fetchTournamentAndRoundInfo();
  }, [activeTab]);

  // Make roundInfo available to parent component
  useEffect(() => {
    if (isActive) {
      onRoundActiveChange?.(isRoundActive, roundInfo.started_at);
    }
  }, [isRoundActive, isActive, onRoundActiveChange, roundInfo.started_at]);

  // Set current page from tournament info
  useEffect(() => {
    if (tournamentInfo.current_round && !hasFetchedTournament.current) {
      setCurrentPage(tournamentInfo.current_round);
      hasFetchedTournament.current = true;
    }
  }, [tournamentInfo, hasFetchedTournament]);

  const fetchTournamentAndRoundInfo = useCallback(async () => {
    if (!tournamentId) return;
    setIsLoading(true);
    setError({ message: null, type: null });
    const client = createClient();

    try {
      // Fetch tournament data
      const { data: tournamentData, error: tournamentError } = await client
        .from("tournaments")
        .select("n_rounds, current_round, has_ended")
        .eq("id", tournamentId)
        .single();
      if (tournamentError) throw tournamentError;

      // Fetch round data
      const { data: roundData, error: roundError } = await client
        .from("rounds")
        .select("started_at, ended_at, is_completed")
        .eq("tournament_id", tournamentId)
        .eq("round_number", currentPage)
        .maybeSingle();
      if (roundError) throw roundError;

      setTournamentInfo(tournamentData);
      setRoundInfo({
        started_at: roundData?.started_at || null,
        ended_at: roundData?.ended_at || null,
      });
      setIsRoundActive(!!roundData && !roundData.is_completed);
    } catch (err) {
      setError({
        message: "Failed to fetch tournament and round information",
        type: "fetch",
      });
      console.error("Error fetching data:", err);
    } finally {
      setIsLoading(false);
    }
  }, [tournamentId, currentPage, activeTab]);

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
      // Insert the new round
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

  // Updated: Order matches by "match_order"
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
    let matchErrorIndexArr: number[] = [];
    // Check that every match has a score
    matches.forEach((match, index) => {
      if (match.player1_score === null || match.player2_score === null) {
        setMatchErrorIndex((prev) => [...prev, index]);
        matchErrorIndexArr.push(index);
      }
    });
    if (matchErrorIndexArr.length > 0) {
      alert("Please add scores to all matches.");
      return;
    }
    setMatchEnding(true);
    try {
      const now = new Date().toISOString();
      // Update each match’s scores and calculate points
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
          // Draw: Both get 1.5 points
          await Promise.all([
            client.from("participants").update({
              match_points: (participant1.match_points || 0) + 1.5,
              differential: (match.differential || 0) + (participant1.differential || 0),
            }).eq("id", match.player1_id.id),
            client.from("participants").update({
              match_points: (participant2.match_points || 0) + 1.5,
              differential: (match.differential2 || 0) + (participant2.differential || 0),
            }).eq("id", match.player2_id.id),
          ]);
        } else if (match.player1_score === 5) {
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
        } else if (match.player2_score === 5) {
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

      // Update byes if needed
      if (byes && byes.length > 0) {
        byes.forEach(async (bye) => {
          const { error: participantUpdateError } = await client.from("participants").update({
            match_points: (bye.match_points ?? 0),
            differential: (bye.differential ?? 0),
          }).eq("id", bye.participant_id.id);
          if (participantUpdateError) console.log(participantUpdateError);
        });
      }

      const { error: roundError } = await client
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
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
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
                      <p className="text-sm text-gray-500 mr-4">
                        Started at:{" "}
                        <span className="text-zinc-400">{formatDateTime(roundInfo.started_at)}</span>
                      </p>
                      <p className="text-sm text-gray-500 mr-4">
                        Ended at:{" "}
                        <span className="text-zinc-400">{formatDateTime(roundInfo.ended_at)}</span>
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
                <div className="overflow-x-auto max-w-full bg-gray-800 text-white">
                  {matches && matches.length > 0 && (
                    <table className="min-w-full text-sm text-left text-gray-400 border-2 border-gray-300">
                      <thead className="text-xs text-zinc-100 uppercase font-normal bg-gray-900 border-b-2 border-gray-300 rounded-t-lg">
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
                        {matches.map((match, index) => (
                          <Fragment key={match.id}>
                            <tr className={`border-b border-gray-400/70 ${matchErrorIndex.includes(index) ? "bg-red-600/20" : "bg-slate-800"}`}>
                              <td className="px-4 py-2 text-center border-r">
                                {match.match_order || index + 1}
                              </td>
                              <td className="px-4 py-2 text-center border-r text-zinc-200">
                                {match.player1_id.name}
                              </td>
                              <td className="px-4 py-2 text-center border-r text-zinc-200">
                                {match.player2_id.name}
                              </td>
                              <td className="px-4 py-2 text-center border-r">
                                {match.player1_match_points}
                              </td>
                              <td className="px-4 py-2 text-center border-r">
                                {match.differential ?? "N/A"}
                              </td>
                              <td className="px-2">
                                <MatchEditModal
                                  key={match.player1_score + match.player2_score}
                                  match={match}
                                  fetchCurrentRoundData={fetchCurrentRoundData}
                                  setMatchErrorIndex={setMatchErrorIndex}
                                  isRoundActive={isRoundActive}
                                  index={index}
                                />
                              </td>
                            </tr>
                            <tr className={`border-b border-gray-300 ${matchErrorIndex.includes(index) ? "bg-red-600/20" : "bg-slate-700"}`}>
                              <td className="px-4 py-2 text-center border-r">
                                {match.match_order || index + 1}
                              </td>
                              <td className="px-4 py-2 text-center border-r text-zinc-200">
                                {match.player2_id.name}
                              </td>
                              <td className="px-4 py-2 text-center border-r text-zinc-200">
                                {match.player1_id.name}
                              </td>
                              <td className="px-4 py-2 text-center border-r">
                                {match.player2_match_points}
                              </td>
                              <td className="px-4 py-2 text-center border-r">
                                {match.differential2 ?? "N/A"}
                              </td>
                              <td className="px-2">
                                <MatchEditModal
                                  key={match.player1_score + match.player2_score}
                                  match={match}
                                  fetchCurrentRoundData={fetchCurrentRoundData}
                                  setMatchErrorIndex={setMatchErrorIndex}
                                  isRoundActive={isRoundActive}
                                  index={index}
                                />
                              </td>
                            </tr>
                          </Fragment>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
                {byes && byes.length > 0 && (
                  <>
                    <h3 className="text-white text-lg font-semibold mt-7 mb-3 text-center">
                      Game Byes
                    </h3>
                    <div className="overflow-x-auto max-w-full bg-gray-800 text-white">
                      <table className="min-w-full text-sm text-left text-gray-400 border-2 border-gray-300">
                        <thead className="text-xs text-zinc-100 uppercase font-normal bg-gray-900 border-b-2 border-gray-300 rounded-t-lg">
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
                            <th scope="col" className="px-4 py-2 text-right"></th>
                          </tr>
                        </thead>
                        <tbody>
                          {byes.map((bye, index) => (
                            <Fragment key={bye.id}>
                              <tr className="border-b border-gray-400/70 bg-slate-800">
                                <td className="px-4 py-2 text-center border-r border-zinc-400">
                                  {index + 1}
                                </td>
                                <td className="px-4 py-2 text-center border-r border-zinc-400">
                                  {bye.participant_id.name}
                                </td>
                                <td className="px-4 py-2 text-center border-r border-zinc-400">
                                  N/A
                                </td>
                                <td className="px-4 py-2 text-center border-r border-zinc-400">
                                  {bye.match_points}
                                </td>
                                <td className="px-4 py-2 text-center border-r border-zinc-400">
                                  {bye.differential}
                                </td>
                                <td></td>
                              </tr>
                            </Fragment>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
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
        )}
      </Card>
    </div>
  );
}
