"use client";

import { Card } from "flowbite-react";
import { useState } from "react";
import { suggestNumberOfRounds } from "../../utils/tournamentUtils";

interface TournamentSettingsProps {
  tournamentId: string;
  participantCount: number;
}

export default function TournamentSettings({ 
  tournamentId,
  participantCount 
}: TournamentSettingsProps) {
  const [enabled, setEnabled] = useState(false);

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
