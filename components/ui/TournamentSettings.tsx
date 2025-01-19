"use client";

import { Card} from "flowbite-react";
import { useState } from "react";

interface TournamentSettingsProps {
  tournamentId: string;
}

export default function TournamentSettings({ tournamentId }: TournamentSettingsProps) {
  const [enabled, setEnabled] = useState(false);

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
            <p className="text-sm text-gray-500">More settings coming soon!</p>
          </div>
        </div>
      </Card>
    </div>
  );
}
