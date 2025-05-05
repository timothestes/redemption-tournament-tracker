"use client";

import { Button, Modal } from "flowbite-react";
import { useState, useEffect } from "react";
import { ArrowUpDown } from "lucide-react";
import { createClient } from "../../utils/supabase/client";

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
    // Reset selected participant when modal opens
    if (isOpen) {
      setSelectedParticipant(null);
      fetchAvailableParticipants();
    }
  }, [isOpen]);

  const fetchAvailableParticipants = async () => {
    setLoading(true);
    try {
      // Fetch all participants in the tournament
      const { data, error } = await client
        .from("participants")
        .select("id, name, match_points, differential, dropped_out")
        .eq("tournament_id", tournamentId)
        .eq("dropped_out", false);

      if (error) throw error;
      
      // Filter out the current players in the match
      const availableParticipants = data.filter(
        (p) => p.id !== match.player1_id.id && p.id !== match.player2_id.id
      );
      
      // Sort by match_points (descending) and then by differential (descending)
      const sortedParticipants = availableParticipants.sort((a, b) => {
        // First sort by match points (descending)
        const matchPointsA = a.match_points !== null ? a.match_points : 0;
        const matchPointsB = b.match_points !== null ? b.match_points : 0;
        
        if (matchPointsB !== matchPointsA) {
          return matchPointsB - matchPointsA;
        }
        
        // If match points are equal, sort by differential (descending)
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
      // Get selected participant details
      const { data: participant, error: participantError } = await client
        .from("participants")
        .select("id, name, match_points, differential")
        .eq("id", selectedParticipant)
        .single();

      if (participantError) throw participantError;

      // Get all matches to find if the participant is in another match
      const { data: allMatches, error: matchesError } = await client
        .from("matches")
        .select("id, player1_id, player2_id")
        .eq("tournament_id", tournamentId)
        .eq("round", roundNumber);

      if (matchesError) throw matchesError;

      // Find if the participant is already in another match
      const existingMatch = allMatches.find(
        (m) => m.player1_id === participant.id || m.player2_id === participant.id
      );

      // Check if the selected participant has a bye
      const { data: byeData, error: byeError } = await client
        .from("byes")
        .select("id")
        .eq("tournament_id", tournamentId)
        .eq("round_number", roundNumber)
        .eq("participant_id", participant.id);

      if (byeError) throw byeError;

      const hasBye = byeData && byeData.length > 0;

      // Determine which player to replace (1 or 2)
      const playerToReplace = window.confirm(
        `Replace ${match.player1_id.name} with ${participant.name}?`
      )
        ? 1 // Replace player1
        : 2; // Replace player2

      // Update the match with the new pairing
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

      // If participant had a bye, remove it
      if (hasBye) {
        await client
          .from("byes")
          .delete()
          .eq("tournament_id", tournamentId)
          .eq("round_number", roundNumber)
          .eq("participant_id", participant.id);
      }

      // If they were in an existing match, replace them with a bye
      if (existingMatch) {
        // Determine which player was replaced
        const wasPlayer1 = existingMatch.player1_id === participant.id;
        const otherPlayerId = wasPlayer1 ? existingMatch.player2_id : existingMatch.player1_id;

        // Delete the existing match
        await client
          .from("matches")
          .delete()
          .eq("id", existingMatch.id);

        // Create a bye for the other player
        const { data: otherPlayer, error: otherPlayerError } = await client
          .from("participants")
          .select("match_points, differential")
          .eq("id", otherPlayerId)
          .single();

        if (otherPlayerError) throw otherPlayerError;

        // Get the tournament bye settings
        const { data: tournament, error: tournamentError } = await client
          .from("tournaments")
          .select("bye_points, bye_differential")
          .eq("id", tournamentId)
          .single();

        if (tournamentError) throw tournamentError;

        // Create the bye record
        await client.from("byes").insert({
          tournament_id: tournamentId,
          round_number: roundNumber,
          participant_id: otherPlayerId,
          match_points: (otherPlayer.match_points || 0) + tournament.bye_points,
          differential: (otherPlayer.differential || 0) + tournament.bye_differential,
        });
      }

      // Refresh the matches data
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
    <Modal show={isOpen} size="md" onClose={onClose}>
      <Modal.Header className="border-b border-gray-600 bg-gray-800">
        <div className="flex items-center">
          <ArrowUpDown className="mr-2 h-5 w-5" />
          <span className="text-xl font-semibold text-white">Repair Pairing</span>
        </div>
      </Modal.Header>
      <Modal.Body className="bg-gray-800 space-y-6">
        <div className="p-4 border border-gray-600 rounded-lg bg-gray-700 mb-4">
          <h3 className="text-lg font-medium text-white mb-3">Current Pairing</h3>
          <div className="flex items-center justify-between gap-4">
            <div className="text-center flex-1 p-2 bg-gray-800 rounded-lg">
              <p className="text-white font-medium">{match?.player1_id?.name}</p>
              <p className="text-xs text-gray-400 mt-1">
                {match?.player1_match_points} points | {match?.differential} diff
              </p>
            </div>
            <span className="text-gray-500">vs</span>
            <div className="text-center flex-1 p-2 bg-gray-800 rounded-lg">
              <p className="text-white font-medium">{match?.player2_id?.name}</p>
              <p className="text-xs text-gray-400 mt-1">
                {match?.player2_match_points} points | {match?.differential2} diff
              </p>
            </div>
          </div>
        </div>

        <div>
          <h3 className="text-lg font-medium text-white mb-3">Select New Opponent</h3>
          <p className="text-sm text-gray-400 mb-4">
            Choose a participant to replace one of the current players.
          </p>
          
          {loading ? (
            <div className="flex justify-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
            </div>
          ) : participants.length === 0 ? (
            <p className="text-center text-gray-500 py-4">No available participants</p>
          ) : (
            <div className="max-h-60 overflow-y-auto border border-gray-600 rounded-lg">
              {participants.map((participant) => (
                <button
                  key={participant.id}
                  onClick={() => setSelectedParticipant(participant.id)}
                  className={`w-full text-left px-4 py-3 border-b border-gray-600 hover:bg-gray-700 transition-colors ${
                    selectedParticipant === participant.id
                      ? "bg-blue-900/40 border-blue-700"
                      : ""
                  }`}
                >
                  <p className="text-white font-medium">{participant.name}</p>
                  <p className="text-xs text-gray-400 mt-1">
                    {participant.match_points || 0} points | {participant.differential || 0} diff
                  </p>
                </button>
              ))}
            </div>
          )}
        </div>
      </Modal.Body>
      <Modal.Footer className="bg-gray-800 border-t border-gray-600">
        <Button
          color="blue"
          onClick={handleRepair}
          disabled={!selectedParticipant || loading}
        >
          {loading ? "Processing..." : "Repair Pairing"}
        </Button>
        <Button outline color="gray" onClick={onClose}>
          Cancel
        </Button>
      </Modal.Footer>
    </Modal>
  );
}