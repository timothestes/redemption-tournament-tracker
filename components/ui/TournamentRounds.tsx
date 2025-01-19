"use client";

import { Button, Card, Pagination } from "flowbite-react";
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
    };

    fetchTournamentInfo();
  }, [tournamentId]);

  return (
    <div className="space-y-6">
      <Card>
        <div className="space-y-4">
          {tournamentInfo.n_rounds && (
            <>
              <h3 className="text-xl font-semibold">
                Round {currentPage} of {tournamentInfo.n_rounds}
              </h3>
              <div className="space-y-4">
                <div className="flex overflow-x-auto sm:justify-center">
                  <Pagination 
                    currentPage={currentPage} 
                    totalPages={tournamentInfo.current_round || 1}
                    onPageChange={onPageChange}
                    showIcons
                  />
                </div>
                {currentPage === tournamentInfo.current_round && (
                  <div className="flex justify-right">
                    <Button
                      outline
                      gradientDuoTone="greenToBlue"
                    >
                      Start Round
                    </Button>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </Card>
    </div>
  );
}
