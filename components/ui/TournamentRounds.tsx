"use client";

import { Button, Card, Pagination, Table } from "flowbite-react";
import { createClient } from "../../utils/supabase/client";
import { useState, useEffect, useCallback } from "react";

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
      setRoundInfo((prev) => ({ ...prev, started_at: now }));
      onRoundActiveChange?.(true, now);

      setMatchLoading(true);

      // Pairing Logic
      // TODO: Implement pairing logic here (e.g., using an algorithm like Swiss-System)

      // If the current round is 1
      const { data } = await client
        .from("participants")
        .select("id, match_points, differential, name")
        .eq("tournament_id", tournamentId);

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

        matches.push({
          tournament_id: tournamentId,
          round: currentPage,
          player1_id: randomParticipant1.id,
          player2_id: randomParticipant2.id,
          match_points: 0,
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
      const { error: matchesError, data: matchesData } = await client
        .from("matches")
        .insert(pairingMatches);

      if (!matchesError) {
        setMatches(pairingMatches);
      }
      setMatchLoading(false);
    } catch (error) {
      console.error("Error starting round:", error);
    }
  };

  useEffect(() => {
    const fetchData = async () => {
      const { data, error } = await client
        .from("matches")
        .select(
          "player1_match_points, player2_match_points, differential, player1_id:participants!matches_player1_id_fkey(name), player2_id:participants!matches_player2_id_fkey(name), player1_score, player2_score"
        )
        .eq("tournament_id", tournamentId)
        .eq("round", currentPage);

      console.log(data, error);

      setMatches(data || []);
    };

    fetchData();
  }, [currentPage]);

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
      onRoundActiveChange?.(false, null);

      // If not on the last round, go to the next page
      if (currentPage < tournamentInfo.n_rounds) {
        setCurrentPage(currentPage + 1);
      }
    } catch (error) {
      console.error("Error ending round:", error);
    }
  };

  return (
    <div className="min-w-[800px] max-w-[1200px] w-full mx-auto overflow-x-auto">
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
          <div className="space-y-4">
            {tournamentInfo.n_rounds && (
              <>
                <div className="flex justify-between items-center">
                  <div>
                    <h3 className="text-xl font-semibold">
                      Round {currentPage} of {tournamentInfo.n_rounds}
                    </h3>
                    <div className="space-y-1">
                      <p className="text-sm text-gray-500 mr-4">
                        Started: {formatDateTime(roundInfo.started_at)}
                      </p>
                      <p className="text-sm text-gray-500 mr-4">
                        Ended: {formatDateTime(roundInfo.ended_at)}
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
                <Table hoverable striped border={1}>
                  <Table.Head>
                    <Table.HeadCell>Index</Table.HeadCell>
                    <Table.HeadCell>Match Points</Table.HeadCell>
                    <Table.HeadCell>Differential</Table.HeadCell>
                    <Table.HeadCell>Name</Table.HeadCell>
                    <Table.HeadCell>Opponent</Table.HeadCell>
                    <Table.HeadCell>
                      <span className="sr-only">Actions</span>
                    </Table.HeadCell>
                  </Table.Head>
                  <Table.Body>
                    {matches.length > 0 &&
                      matches.map((match, index) => (
                        <>
                          <Table.Row key={match.id}>
                            <Table.Cell>{index + 1}</Table.Cell>
                            <Table.Cell>
                              {match.player1_match_points}
                            </Table.Cell>
                            <Table.Cell>{match.differential}</Table.Cell>
                            <Table.Cell>{match.player1_id.name}</Table.Cell>
                            <Table.Cell>{match.player2_id.name}</Table.Cell>
                            <Table.Cell>
                              <Button size="small">Edit</Button>
                            </Table.Cell>
                          </Table.Row>
                          <Table.Row key={match.id}>
                            <Table.Cell>{index + 1}</Table.Cell>
                            <Table.Cell>
                              {match.player2_match_points}
                            </Table.Cell>
                            <Table.Cell>{match.differential}</Table.Cell>
                            <Table.Cell>{match.player2_id.name}</Table.Cell>
                            <Table.Cell>{match.player1_id.name}</Table.Cell>
                            <Table.Cell>
                              <Button size="small">Edit</Button>
                            </Table.Cell>
                          </Table.Row>
                        </>
                      ))}
                  </Table.Body>
                </Table>
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
