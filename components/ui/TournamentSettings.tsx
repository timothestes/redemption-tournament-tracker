"use client";

import { Button, Card, Label, Toggle } from "flowbite-react";
import { HiCog } from "react-icons/hi";
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
        <h3 className="text-lg font-semibold mb-2">General Settings</h3>
        <div className="space-y-4">
          <div>
            <p className="text-sm text-gray-500">Tournament ID: {tournamentId}</p>
          </div>
          <div className="flex items-center gap-2">
            <Label htmlFor="toggle">Enable Something</Label>
            <Toggle 
              id="toggle"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
            />
          </div>
        </div>
      </Card>

      <Card>
        <h3 className="text-lg font-semibold mb-2">Advanced Settings</h3>
        <div className="space-y-4">
          <Button color="gray" size="sm">
            <HiCog className="mr-2 h-4 w-4" />
            Configure Tournament
          </Button>
        </div>
      </Card>
    </div>
  );
}
