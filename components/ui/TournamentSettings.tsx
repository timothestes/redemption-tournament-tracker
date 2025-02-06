"use client";

import { Card } from "flowbite-react";
import { useState, useEffect } from "react";
import { suggestNumberOfRounds } from "../../utils/tournamentUtils";
import { createClient } from "../../utils/supabase/client";

interface TournamentInfo {
  n_rounds: number | null;
  current_round: number | null;
  round_length: number | null;
}

interface TournamentSettingsProps {
  tournamentId: string;
  participantCount: number;
}

export default function TournamentSettings({
  tournamentId,
  participantCount 
}: TournamentSettingsProps) {
  const [enabled, setEnabled] = useState(false);
  const [tournamentInfo, setTournamentInfo] = useState<TournamentInfo>({
    n_rounds: null,
    current_round: null,
    round_length: null
  });

  const suggestedRounds = suggestNumberOfRounds(participantCount);

  useEffect(() => {
    const fetchTournamentInfo = async () => {
      if (!tournamentId) return;
      
      const client = createClient();
      const { data, error } = await client
        .from('tournaments')
        .select('n_rounds, current_round, round_length')
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
    <div className="space-y-6 min-w-[800px] max-w-[1200px] w-full mx-auto">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold">Tournament Settings</h2>
      </div>
      
      <Card>
        <div className="space-y-4">
          <div>
            <p className="text-sm text-gray-500">Tournament ID: {tournamentId}</p>
          </div>
          <div>
            <p className="text-sm text-gray-500">Current Participants: {participantCount}</p>
            {typeof tournamentInfo.current_round === 'number' && (
              <p className="text-sm text-gray-500">
                Current Round: {tournamentInfo.current_round}
              </p>
            )}
            {typeof tournamentInfo.n_rounds === 'number' && (
              <p className="text-sm text-gray-500">
                Total Rounds: {tournamentInfo.n_rounds}
              </p>
            )}
            {typeof tournamentInfo.round_length === 'number' && (
              <p className="text-sm text-gray-500">
                Round Length: {tournamentInfo.round_length} minutes
              </p>
            )}
            {participantCount > 0 && (!tournamentInfo.n_rounds || tournamentInfo.n_rounds === 0) && (
              <p className="text-sm text-gray-500">
                Suggested Number of Rounds: {suggestedRounds}
              </p>
            )}
          </div>
        </div>
      </Card>
    </div>
  );
}
