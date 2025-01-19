"use client";

import { Button, Card, Pagination } from "flowbite-react";
import { createClient } from "../../utils/supabase/client";
import { useState, useEffect } from "react";
import { createClient } from "../../utils/supabase/client";

interface TournamentRoundsProps {
  tournamentId: string;
}

interface TournamentInfo {
  n_rounds: number | null;
  current_round: number | null;
}

export default function TournamentRounds({
  tournamentId,
}: TournamentRoundsProps) {
  const [tournamentInfo, setTournamentInfo] = useState<TournamentInfo>({
    n_rounds: null,
    current_round: null
  });
  const [currentPage, setCurrentPage] = useState(1);
  const [isRoundActive, setIsRoundActive] = useState(false);

  const onPageChange = (page: number) => {
    // Only allow navigating to current or previous rounds
    if (page <= (tournamentInfo.current_round || 1)) {
      setCurrentPage(page);
    }
  };

  useEffect(() => {
    const fetchTournamentInfo = async () => {
      if (!tournamentId) return;
      
      const client = createClient();
      const { data, error } = await client
        .from('tournaments')
        .select('n_rounds, current_round')
        .eq('id', tournamentId)
        .single();
      
      if (error) {
        console.error('Error fetching tournament info:', error);
        return;
      }

      setTournamentInfo(data);

      // Check if there's an active round
      const { data: roundData, error: roundError } = await client
        .from('rounds')
        .select('*')
        .eq('tournament_id', tournamentId)
        .eq('round_number', data.current_round)
        .is('ended_at', null)
        .single();

      if (!roundError && roundData) {
        setIsRoundActive(true);
      } else {
        setIsRoundActive(false);
      }
    };

    fetchTournamentInfo();
  }, [tournamentId]);

  const handleStartRound = async () => {
    const client = createClient();
    
    try {
      // Insert new round
      const { error: roundError } = await client
        .from('rounds')
        .insert([{
          tournament_id: tournamentId,
          round_number: currentPage,
          started_at: new Date().toISOString(),
        }]);

      if (roundError) throw roundError;
      
      setIsRoundActive(true);
    } catch (error) {
      console.error('Error starting round:', error);
    }
  };

  const handleEndRound = async () => {
    const client = createClient();
    
    try {
      // Update round end time
      const { error: roundError } = await client
        .from('rounds')
        .update({ 
          ended_at: new Date().toISOString(),
          is_completed: true 
        })
        .eq('tournament_id', tournamentId)
        .eq('round_number', currentPage);

      if (roundError) throw roundError;

      // Increment current round in tournament
      const { error: tournamentError } = await client
        .from('tournaments')
        .update({ 
          current_round: tournamentInfo.current_round! + 1
        })
        .eq('id', tournamentId);

      if (tournamentError) throw tournamentError;

      // Refresh tournament info
      fetchTournamentInfo();
      setIsRoundActive(false);
    } catch (error) {
      console.error('Error ending round:', error);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <div className="space-y-4">
          {tournamentInfo.n_rounds && (
            <>
              <div className="flex justify-between items-center">
                <h3 className="text-xl font-semibold">
                  Round {currentPage} of {tournamentInfo.n_rounds}
                </h3>
                {currentPage === tournamentInfo.current_round && (
                  <Button
                    outline
                    gradientDuoTone={isRoundActive ? "pinkToOrange" : "greenToBlue"}
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
