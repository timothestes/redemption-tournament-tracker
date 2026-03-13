"use client";

import { useState, useEffect } from "react";
import { ArrowUpDown } from "lucide-react";
import { createClient } from "../../utils/supabase/client";
import { Button } from "./button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogBody,
  DialogFooter,
} from "./dialog";

interface RepairPairingModalProps {
  isOpen: boolean;
  onClose: () => void;
  match: any;
  tournamentId: string;
  roundNumber: number;
  fetchCurrentRoundData: () => void;
  isRoundActive: boolean;
}

export default function RepairPairingModal({
  isOpen,
  onClose,
  match,
  tournamentId,
  roundNumber,
  fetchCurrentRoundData,
  isRoundActive
}: RepairPairingModalProps) {
  const [loading, setLoading] = useState(false);
  const [participants, setParticipants] = useState<any[]>([]);
  const [selectedParticipant, setSelectedParticipant] = useState<string | null>(null);
  const client = createClient();

  useEffect(() => {
    if (isOpen) {
      setSelectedParticipant(null);
      fetchAvailableParticipants();
    }
  }, [isOpen]);

  const fetchAvailableParticipants = async () => {
    setLoading(true);
    try {
      const { data, error } = await client
        .from("participants")
        .select("id, name, match_points, differential, dropped_out")
        .eq("tournament_id", tournamentId)
        .eq("dropped_out", false);

      if (error) throw error;

      const availableParticipants = data.filter(
        (p) => p.id !== match.player1_id.id && p.id !== match.player2_id.id
      );

      const sortedParticipants = availableParticipants.sort((a, b) => {
        const matchPointsA = a.match_points !== null ? a.match_points : 0;
        const matchPointsB = b.match_points !== null ? b.match_points : 0;

        if (matchPointsB !== matchPointsA) {
          return matchPointsB - matchPointsA;
        }

        const diffA = a.differential !== null ? a.differential : 0;
        const diffB = b.differential !== null ? b.differential : 0;

        return diffB - diffA;
      });

      setParticipants(sortedParticipants);
    } catch (error) {
      console.error("Error fetching participants:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleRepair = async () => {
    if (!selectedParticipant) return;

    setLoading(true);
    try {
      const { data: participant, error: participantError } = await client
        .from("participants")
        .select("id, name, match_points, differential")
        .eq("id", selectedParticipant)
        .single();

      if (participantError) throw participantError;

      const { data: allMatches, error: matchesError } = await client
        .from("matches")
        .select("id, player1_id, player2_id")
        .eq("tournament_id", tournamentId)
        .eq("round", roundNumber);

      if (matchesError) throw matchesError;

      const existingMatch = allMatches.find(
        (m) => m.player1_id === participant.id || m.player2_id === participant.id
      );

      const { data: byeData, error: byeError } = await client
        .from("byes")
        .select("id")
        .eq("tournament_id", tournamentId)
        .eq("round_number", roundNumber)
        .eq("participant_id", participant.id);

      if (byeError) throw byeError;

      const hasBye = byeData && byeData.length > 0;

      const playerToReplace = window.confirm(
        `Replace ${match.player1_id.name} with ${participant.name}?`
      )
        ? 1
        : 2;

      if (playerToReplace === 1) {
        await client
          .from("matches")
          .update({
            player1_id: participant.id,
            player1_match_points: participant.match_points || 0,
            differential: participant.differential || 0,
            player1_score: null,
            player2_score: null,
          })
          .eq("id", match.id);
      } else {
        await client
          .from("matches")
          .update({
            player2_id: participant.id,
            player2_match_points: participant.match_points || 0,
            differential2: participant.differential || 0,
            player1_score: null,
            player2_score: null,
          })
          .eq("id", match.id);
      }

      if (hasBye) {
        await client
          .from("byes")
          .delete()
          .eq("tournament_id", tournamentId)
          .eq("round_number", roundNumber)
          .eq("participant_id", participant.id);
      }

      if (existingMatch) {
        const wasPlayer1 = existingMatch.player1_id === participant.id;
        const otherPlayerId = wasPlayer1 ? existingMatch.player2_id : existingMatch.player1_id;

        await client
          .from("matches")
          .delete()
          .eq("id", existingMatch.id);

        const { data: otherPlayer, error: otherPlayerError } = await client
          .from("participants")
          .select("match_points, differential")
          .eq("id", otherPlayerId)
          .single();

        if (otherPlayerError) throw otherPlayerError;

        const { data: tournament, error: tournamentError } = await client
          .from("tournaments")
          .select("bye_points, bye_differential")
          .eq("id", tournamentId)
          .single();

        if (tournamentError) throw tournamentError;

        await client.from("byes").insert({
          tournament_id: tournamentId,
          round_number: roundNumber,
          participant_id: otherPlayerId,
          match_points: (otherPlayer.match_points || 0) + tournament.bye_points,
          differential: (otherPlayer.differential || 0) + tournament.bye_differential,
        });
      }

      fetchCurrentRoundData();
      onClose();
    } catch (error) {
      console.error("Error repairing pairing:", error);
      alert("Error repairing pairing. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent size="md">
        <DialogHeader>
          <div className="flex items-center">
            <ArrowUpDown className="mr-2 h-5 w-5 text-foreground" />
            <span className="text-xl font-semibold text-foreground">Repair Pairing</span>
          </div>
        </DialogHeader>
        <DialogBody className="space-y-6">
          <div className="p-4 border border-gray-200 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-700 mb-4">
            <h3 className="text-lg font-medium text-foreground mb-3">Current Pairing</h3>
            <div className="flex items-center justify-between gap-4">
              <div className="text-center flex-1 p-2 bg-white dark:bg-gray-800 rounded-lg">
                <p className="text-foreground font-medium">{match?.player1_id?.name}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {match?.player1_match_points} points | {match?.differential} diff
                </p>
              </div>
              <span className="text-muted-foreground">vs</span>
              <div className="text-center flex-1 p-2 bg-white dark:bg-gray-800 rounded-lg">
                <p className="text-foreground font-medium">{match?.player2_id?.name}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {match?.player2_match_points} points | {match?.differential2} diff
                </p>
              </div>
            </div>
          </div>

          <div>
            <h3 className="text-lg font-medium text-foreground mb-3">Select New Opponent</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Choose a participant to replace one of the current players.
            </p>

            {loading ? (
              <div className="flex justify-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
              </div>
            ) : participants.length === 0 ? (
              <p className="text-center text-muted-foreground py-4">No available participants</p>
            ) : (
              <div className="max-h-60 overflow-y-auto border border-gray-200 dark:border-gray-600 rounded-lg">
                {participants.map((participant) => (
                  <button
                    key={participant.id}
                    onClick={() => setSelectedParticipant(participant.id)}
                    className={`w-full text-left px-4 py-3 border-b border-gray-200 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors ${
                      selectedParticipant === participant.id
                        ? "bg-blue-50 dark:bg-blue-900/40 border-blue-300 dark:border-blue-700"
                        : ""
                    }`}
                  >
                    <p className="text-foreground font-medium">{participant.name}</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {participant.match_points || 0} points | {participant.differential || 0} diff
                    </p>
                  </button>
                ))}
              </div>
            )}
          </div>
        </DialogBody>
        <DialogFooter>
          <Button
            variant="accent"
            onClick={handleRepair}
            disabled={!selectedParticipant || loading}
          >
            {loading ? "Processing..." : "Repair Pairing"}
          </Button>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
