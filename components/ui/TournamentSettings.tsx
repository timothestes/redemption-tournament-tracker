"use client";

import { Card } from "flowbite-react";
import { useState, useEffect } from "react";
import { createClient } from "../../utils/supabase/client";
import { suggestNumberOfRounds } from "../../utils/tournamentUtils";

interface TournamentSettingsProps {
  tournamentId: string;
}

const supabase = createClient();

export default function TournamentSettings({ tournamentId }: TournamentSettingsProps) {
  const [enabled, setEnabled] = useState(false);
  const [participantCount, setParticipantCount] = useState(0);

  useEffect(() => {
    const fetchParticipantCount = async () => {
      const { count } = await supabase
        .from('participants')
        .select('*', { count: 'exact', head: true })
        .eq('tournament_id', tournamentId);
      
      setParticipantCount(count || 0);
    };

    fetchParticipantCount();
  }, [tournamentId]);

  const suggestedRounds = suggestNumberOfRounds(participantCount);

  return (
    <div className="space-y-6">
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
            {participantCount > 0 && (
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
