"use client";

import { Button, Card, Pagination } from "flowbite-react";
import { createClient } from "../../utils/supabase/client";
import { useState, useEffect, useCallback } from "react";

interface TournamentRoundsProps {
  tournamentId: string;
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

export default function TournamentRounds({
  tournamentId,
}: TournamentRoundsProps) {
  const [tournamentInfo, setTournamentInfo] = useState<TournamentInfo>({
    n_rounds: null,
    current_round: null,
  });
  const [currentPage, setCurrentPage] = useState(1);
  const [isRoundActive, setIsRoundActive] = useState(false);
  const [roundInfo, setRoundInfo] = useState<RoundInfo>({ started_at: null });

  const fetchTournamentInfo = useCallback(async () => {
    if (!tournamentId) return;

    const client = createClient();
    const { data, error } = await client
      .from("tournaments")
      .select("n_rounds, current_round, has_ended")
      .eq("id", tournamentId)
      .single();

    if (error) {
      console.error("Error fetching tournament info:", error);
      return;
    }

    setTournamentInfo(data);

    const { data: roundData, error: roundError } = await client
      .from("rounds")
      .select("*")
      .eq("tournament_id", tournamentId)
      .eq("round_number", data.current_round)
      .is("ended_at", null)
      .single();

    if (!roundError && roundData) {
      setIsRoundActive(true);
      setRoundInfo({ 
        started_at: roundData.started_at,
        ended_at: roundData.ended_at
      });
    } else {
      setIsRoundActive(false);
      setRoundInfo({ 
        started_at: null,
        ended_at: null 
      });
    }
  }, [tournamentId]);

  useEffect(() => {
    fetchTournamentInfo();
  }, [fetchTournamentInfo]);

  const onPageChange = (page: number) => {
    if (page <= (tournamentInfo.current_round || 1)) {
      setCurrentPage(page);
    }
  };

  const handleStartRound = async () => {
    const client = createClient();

    try {
      const { error: roundError } = await client
        .from("rounds")
        .insert([
          {
            tournament_id: tournamentId,
            round_number: currentPage,
            started_at: new Date().toISOString(),
          },
        ]);

      if (roundError) throw roundError;

      const now = new Date().toISOString();
      setIsRoundActive(true);
      setRoundInfo({ started_at: now });
    } catch (error) {
      console.error("Error starting round:", error);
    }
  };

  const handleEndRound = async () => {
    const client = createClient();

    try {
      const { error: roundError } = await client
        .from("rounds")
        .update({
          ended_at: new Date().toISOString(),
          is_completed: true,
        })
        .eq("tournament_id", tournamentId)
        .eq("round_number", currentPage);

      if (roundError) throw roundError;

      // Check if this is the last round
      if (tournamentInfo.current_round === tournamentInfo.n_rounds) {
        // End the tournament
        const now = new Date().toISOString();
        const { error: tournamentError } = await client
          .from("tournaments")
          .update({
            has_ended: true,
            ended_at: now
          })
          .eq("id", tournamentId);

        if (tournamentError) throw tournamentError;
      } else {
        // Increment current round if not the last round
        const { error: tournamentError } = await client
          .from("tournaments")
          .update({
            current_round: tournamentInfo.current_round! + 1,
          })
          .eq("id", tournamentId);

        if (tournamentError) throw tournamentError;
      }

      fetchTournamentInfo();
      setIsRoundActive(false);
    } catch (error) {
      console.error("Error ending round:", error);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <div className="space-y-4">
          {tournamentInfo.n_rounds && (
            <>
              <div className="flex justify-between items-center">
                <div>
                  <h3 className="text-xl font-semibold">
                    Round {currentPage} of {tournamentInfo.n_rounds}
                  </h3>
                  {roundInfo.started_at && (
                    <div className="space-y-1">
                      <p className="text-sm text-gray-500 mr-4">
                        Started:{" "}
                        {new Intl.DateTimeFormat("en-US", {
                          year: "numeric",
                          month: "long",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                          second: "2-digit",
                        }).format(new Date(roundInfo.started_at))}
                      </p>
                      {roundInfo.ended_at && (
                        <p className="text-sm text-gray-500 mr-4">
                          Ended:{" "}
                          {new Intl.DateTimeFormat("en-US", {
                            year: "numeric",
                            month: "long",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                            second: "2-digit",
                          }).format(new Date(roundInfo.ended_at))}
                        </p>
                      )}
                    </div>
                  )}
                </div>
                {currentPage === tournamentInfo.current_round && !tournamentInfo.has_ended && (
                  <Button
                    outline
                    gradientDuoTone={
                      isRoundActive ? "pinkToOrange" : "greenToBlue"
                    }
                    onClick={isRoundActive ? handleEndRound : handleStartRound}
                  >
                    {isRoundActive ? "End Round" : "Start Round"}
                  </Button>
                )}
              </div>
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
      </Card>
    </div>
  );
}
