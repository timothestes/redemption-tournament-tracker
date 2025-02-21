"use client";

import { Button, Card, Pagination } from "flowbite-react";
import { createClient } from "../../utils/supabase/client";
import { useState, useEffect, useCallback, Fragment, Dispatch, SetStateAction } from "react";
import MatchEditModal from "./match-edit";

const formatDateTime = (timestamp: string | null) => {
  if (!timestamp) return "";
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
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
}: TournamentRoundsProps) {
  const [tournamentInfo, setTournamentInfo] = useState<TournamentInfo>({
    n_rounds: null,
    current_round: null,
    has_ended: false,
  });
  const client = createClient();
  const [error, setError] = useState<ErrorState>({ message: null, type: null });
  const [isLoading, setIsLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const [isRoundActive, setIsRoundActive] = useState(false);
  const [roundInfo, setRoundInfo] = useState<RoundInfo>({
    started_at: null,
    ended_at: null,
  });
  const [matches, setMatches] = useState<any[]>([]);
  const [matchLoading, setMatchLoading] = useState(false);
  const [byes, setByes] = useState<any[]>([]);

  // Make roundInfo available to parent component
  useEffect(() => {
    if (isActive) {
      onRoundActiveChange?.(isRoundActive, roundInfo.started_at);
    }
  }, [isRoundActive, isActive, onRoundActiveChange, roundInfo.started_at]);

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

      // Update all states at once
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
  }, [tournamentId, currentPage]);

  useEffect(() => {
    if (isActive) {
      fetchTournamentAndRoundInfo();
    }
  }, [fetchTournamentAndRoundInfo, isActive]);

  const onPageChange = (page: number) => {
    if (page <= (tournamentInfo.current_round || 1)) {
      setCurrentPage(page);
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

      setIsRoundActive(true);
      setLatestRound((prev) => ({ round_number: currentPage, started_at: now }));
      onRoundActiveChange?.(true, now);

      setMatchLoading(true);

      // Pairing Logic

      // If the current round is 1
      const { data, error: participantSelectError } = await client
        .from("participants")
        .select("id, match_points, differential, name")
        .eq("tournament_id", tournamentId);

      if (participantSelectError) {
        console.log(participantSelectError);
      }

      setRoundInfo({
        started_at: now,
        ended_at: null,
      });

      let userArray = data;

      let pairingMatches = [];

      // Creating matches by picking random players
      while (userArray.length > 1) {
        let randomIndex1 = Math.floor(Math.random() * userArray.length);
        let randomIndex2 = Math.floor(Math.random() * userArray.length);

        while (randomIndex1 === randomIndex2) {
          randomIndex2 = Math.floor(Math.random() * userArray.length);
        }

        let randomParticipant1 = userArray[randomIndex1];
        let randomParticipant2 = userArray[randomIndex2];

        pairingMatches.push({
          tournament_id: tournamentId,
          round: currentPage,
          player1_id: randomParticipant1.id,
          player2_id: randomParticipant2.id,
          player1_score: 0,
          player2_score: 0,
          player1_match_points: 0,
          player2_match_points: 0,
        });

        userArray.splice(randomIndex1, 1);
        if (randomIndex2 > randomIndex1) randomIndex2--;
        userArray.splice(randomIndex2, 1);
      }

      // Insert the matches into the database
      const { error: matchesError } = await client
        .from("matches")
        .insert(pairingMatches);

      // Setting byes
      if (userArray.length > 0) {
        let error = false;
        userArray.forEach(async (user) => {
          const { error: byesError } = await client.from("byes").insert({
            tournament_id: tournamentId,
            round_number: currentPage,
            participant_id: user.id,
          });

          if (byesError) {
            console.log(byesError);
            error = true;
          }
        });

        if (!error) {
          fetchCurrentRoundData();
          setMatchLoading(false);
        }
      } else {
        fetchCurrentRoundData();
        setMatchLoading(false);
      }
    } catch (error) {
      console.error("Error starting round:", error);
    }
  };

  const fetchCurrentRoundData = async () => {
    const { data, error } = await client
      .from("matches")
      .select(
        "id, player1_match_points, player2_match_points, differential, player1_id:participants!matches_player1_id_fkey(name,id), player2_id:participants!matches_player2_id_fkey(name,id), player2_id, player1_score, player2_score"
      )
      .eq("tournament_id", tournamentId)
      .eq("round", currentPage)
      .order("id", { ascending: true });

    if (error) console.log(error);
    setMatches(data || []);

    const { data: byeData, error: byeError } = await client
      .from("byes")
      .select(
        "id, participant_id:participants(name)"
      )
      .eq("tournament_id", tournamentId)
      .eq("round_number", currentPage)
      .order("id", { ascending: true });

    if (byeError) console.log(byeError);
    setByes(byeData);
  };

  useEffect(() => {
    fetchCurrentRoundData();
  }, [currentPage]);

  console.log(byes);
  const handleEndRound = async () => {
    const client = createClient();

    try {
      const now = new Date().toISOString();

      // Update the database first
      const { error: roundError, data: roundData } = await client
        .from("rounds")
        .update({
          ended_at: now,
          is_completed: true,
        })
        .eq("tournament_id", tournamentId)
        .eq("round_number", currentPage);

      if (roundError) throw roundError;

      setRoundInfo({
        started_at: roundInfo.started_at,
        ended_at: now,
      });

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
        const { error: tournamentError } = await client
          .from("tournaments")
          .update({
            current_round: (tournamentInfo.current_round || 0) + 1,
          })
          .eq("id", tournamentId);

        if (tournamentError) throw tournamentError;
      }

      // Update local state after successful database updates
      setRoundInfo((prev) => ({
        ...prev,
        ended_at: now,
      }));
      setIsRoundActive(false);
      setLatestRound((prev) => ({ round_number: currentPage, started_at: null }));

      // If not on the last round, go to the next page
      if (currentPage < tournamentInfo.n_rounds) {
        setCurrentPage(currentPage + 1);
      }
    } catch (error) {
      console.error("Error ending round:", error);
    }
  };

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
                        Started at: <span className="text-zinc-400">{formatDateTime(roundInfo.started_at)}</span>
                      </p>
                      <p className="text-sm text-gray-500 mr-4">
                        Ended at: <span className="text-zinc-400">{formatDateTime(roundInfo.ended_at)}</span>
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
                      >
                        {isRoundActive ? "End Round" : "Start Round"}
                      </Button>
                    )}
                </div>
                <div className="overflow-x-auto max-w-full bg-gray-800 text-white">
                  {matches && matches.length > 0 && <table className="min-w-full text-sm text-left text-gray-400 border-2 border-gray-300">
                    <thead className="text-xs text-zinc-100 uppercase font-normal bg-gray-900 border-b-2 border-gray-300 rounded-t-lg">
                      <tr>
                        <th scope="col" className="px-6 py-4">
                          Index
                        </th>
                        <th scope="col" className="px-4 py-2 text-center">
                          Match Points
                        </th>
                        <th scope="col" className="px-4 py-2 text-center">
                          Differential
                        </th>
                        <th scope="col" className="px-4 py-2 text-center">
                          Name
                        </th>
                        <th scope="col" className="px-4 py-2 text-center">
                          Opponent
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
                            <tr className="border-b border-gray-400/70">
                              <td className="px-4 py-2 text-center border-r border-zinc-400">
                                {index + 1}
                              </td>
                              <td className="px-4 py-2 text-center border-r border-zinc-400">
                                {match.player1_match_points}
                              </td>
                              <td className="px-4 py-2 text-center border-r border-zinc-400">
                                {match.differential}
                              </td>
                              <td className="px-4 py-2 text-center border-r border-zinc-400 text-zinc-200">
                                {match.player1_id.name}
                              </td>
                              <td className="px-4 py-2 text-center border-r border-zinc-400 text-zinc-200">
                                {match.player2_id.name}
                              </td>
                              <td className="px-2">
                                <MatchEditModal
                                  match={match}
                                  fetchCurrentRoundData={fetchCurrentRoundData}
                                />
                              </td>
                            </tr>
                            <tr className="border-b-2 border-gray-300">
                              <td className="px-4 py-2 text-center border-r border-zinc-400">
                                {index + 1}
                              </td>
                              <td className="px-4 py-2 text-center border-r border-zinc-400">
                                {match.player2_match_points}
                              </td>
                              <td className="px-4 py-2 text-center border-r border-zinc-400">
                                {match.player2_score - match.player1_score}
                              </td>
                              <td className="px-4 py-2 text-center border-r border-zinc-400 text-zinc-200">
                                {match.player2_id.name}
                              </td>
                              <td className="px-4 py-2 text-center border-r border-zinc-400 text-zinc-200">
                                {match.player1_id.name}
                              </td>
                              <td className="px-2">
                                <MatchEditModal
                                  match={match}
                                  fetchCurrentRoundData={fetchCurrentRoundData}
                                />
                              </td>
                            </tr>
                          </Fragment>
                        ))}
                    </tbody>
                  </table>}
                </div>

                {/* Byes Table */}
                {byes && byes.length > 0 && <>
                  <h3 className="text-white text-lg font-semibold mt-7 mb-3 text-center">Game Byes</h3>
                  <div className="overflow-x-auto max-w-full bg-gray-800 text-white">
                    <table className="min-w-full text-sm text-left text-gray-400 border-2 border-gray-300">
                      <thead className="text-xs text-zinc-100 uppercase font-normal bg-gray-900 border-b-2 border-gray-300 rounded-t-lg">
                        <tr>
                          <th scope="col" className="px-4 py-2 text-center">
                            Index
                          </th>
                          <th scope="col" className="px-4 py-2 text-center">
                            Match Points
                          </th>
                          <th scope="col" className="px-4 py-2 text-center">
                            Name
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {byes.length > 0 &&
                          byes.map((bye, index) => (
                            <Fragment key={bye.id}>
                              <tr className="border-b border-gray-400/70">
                                <td className="px-4 py-2 text-center border-r border-zinc-400">
                                  {index + 1}
                                </td>
                                <td className="px-4 py-2 text-center border-r border-zinc-400">
                                  0
                                </td>
                                <td className="px-4 py-2 text-center border-r border-zinc-400">
                                  {bye.participant_id.name}
                                </td>
                                {/* <td className="px-2">
                                <MatchEditModal
                                  match={match}
                                  fetchCurrentRoundData={fetchCurrentRoundData}
                                />
                              </td> */}
                              </tr>

                            </Fragment>
                          ))}
                      </tbody>
                    </table>
                  </div>
                </>}

                <div className="flex overflow-x-auto sm:justify-center">
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
