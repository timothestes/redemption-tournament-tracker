"use client";

import { Card, Pagination } from "flowbite-react";
import { useState, useEffect } from "react";
import { createClient } from "../../utils/supabase/client";

interface TournamentPairingsProps {
  tournamentId: string;
}

interface TournamentInfo {
  n_rounds: number | null;
  current_round: number | null;
}

export default function TournamentPairings({
  tournamentId,
}: TournamentPairingsProps) {
  const [tournamentInfo, setTournamentInfo] = useState<TournamentInfo>({
    n_rounds: null,
    current_round: null
  });
  const [currentPage, setCurrentPage] = useState(1);

  const onPageChange = (page: number) => setCurrentPage(page);

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
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold">Round Pairings</h2>
      </div>
      
      <Card>
        <div className="space-y-4">
          {tournamentInfo.n_rounds && (
            <>
              <h3 className="text-xl font-semibold">
                Round {currentPage} of {tournamentInfo.n_rounds}
              </h3>
              <div className="flex overflow-x-auto sm:justify-center">
                <Pagination 
                  currentPage={currentPage} 
                  totalPages={tournamentInfo.n_rounds} 
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
