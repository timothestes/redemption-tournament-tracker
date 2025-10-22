"use client";

import { Button } from "flowbite-react";
import { Pencil } from "lucide-react";
import { Dispatch, FormEvent, SetStateAction, useState, useEffect } from "react";
import { createClient } from "../../utils/supabase/client";
import { useTheme } from "next-themes";

export default function MatchEditModal({
  match,
  fetchCurrentRoundData,
  setMatchErrorIndex,
  isRoundActive,
  index,
  tournament
}: {
  match: any;
  fetchCurrentRoundData: any;
  setMatchErrorIndex: Dispatch<SetStateAction<number[]>>;
  isRoundActive: boolean;
  index: number;
  tournament: any;
}) {
  const [open, setOpen] = useState(false);
  const [player1Score, setPlayer1Score] = useState(match.player1_score);
  const [player2Score, setPlayer2Score] = useState(match.player2_score);
  const { theme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  
  // Handle ESC key to close modal
  useEffect(() => {
    if (!open) return;
    
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [open]);
  
  useEffect(() => {
    setMounted(true);
  }, []);

  // Reset scores to 0 only if they haven't been set yet
  const handleOpenModal = () => {
    if (isRoundActive) {
      // Use existing scores if available, otherwise default to 0
      setPlayer1Score(match.player1_score !== null ? match.player1_score : 0);
      setPlayer2Score(match.player2_score !== null ? match.player2_score : 0);
      setOpen(true);
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (
      isNaN(player2Score) ||
      player1Score < 0 ||
      player2Score < 0 ||
      player1Score > tournament.max_score ||
      player2Score > tournament.max_score
    ) {
      alert(`Invalid scores. Scores must be between 0 and ${tournament.max_score}, inclusive.`);
      return;
    }
    if (player1Score === tournament.max_score && player2Score === tournament.max_score) {
      alert("Score cannot be " + tournament.max_score + "-" + tournament.max_score + ".");
      return;
    }
    const client = createClient();
  
    const player1 = await client
      .from("participants")
      .select("differential, match_points, id")
      .eq("id", match.player1_id.id)
      .single();
    const player2 = await client
      .from("participants")
      .select("differential, match_points, id")
      .eq("id", match.player2_id.id)
      .single();
  
    if (player1.error || player2.error) {
      console.log(player1.error, player2.error);
      return;
    }
  
    let player1_match_points, player2_match_points;
  
    if (player2Score === player1Score) {
      player1_match_points = 1.5;
      player2_match_points = 1.5;
    } else if (player1Score === tournament.max_score) {
      player1_match_points = 3;
      player2_match_points = 0;
    } else if (player2Score === tournament.max_score) {
      player1_match_points = 0;
      player2_match_points = 3;
    } else if (player1Score > player2Score) {
      player1_match_points = 2;
      player2_match_points = 1;
    } else if (player2Score > player1Score) {
      player1_match_points = 1;
      player2_match_points = 2;
    }
  
    // Update the match without modifying match_order
    const { data, error } = await client
      .from("matches")
      .update({
        player1_score: player1Score,
        player2_score: player2Score,
        differential:
          (player1.data.differential ?? 0) + (player1Score - player2Score),
        differential2:
          (player2.data.differential ?? 0) + (player2Score - player1Score),
        player1_match_points:
          (player1.data.match_points || 0) + player1_match_points,
        player2_match_points:
          (player2.data.match_points || 0) + player2_match_points,
        updated_at: new Date(),
      })
      .eq("id", match.id);
  
    setMatchErrorIndex((prev) => prev.filter((i) => i !== index));
  
    if (!error) {
      setOpen(false);
    } else {
      console.log(error);
      alert("Some error occurred!");
    }
  
    fetchCurrentRoundData();
  };

  // Generate score options based on tournament.max_score
  const scoreOptions = Array.from({ length: tournament.max_score + 1 }, (_, i) => i);

  // Don't render theme-specific styling until client-side to avoid hydration mismatch
  const currentTheme = mounted ? (theme === 'system' ? resolvedTheme : theme) : 'dark';
  const isLightTheme = currentTheme === 'light';

  // Score selector component
  const ScoreSelector = ({ 
    player, 
    selectedScore, 
    setScore 
  }: { 
    player: string, 
    selectedScore: number, 
    setScore: (score: number) => void 
  }) => {
    return (
      <div className="mb-4">
        <h3 className={`text-lg ${isLightTheme ? 'text-gray-600' : 'text-zinc-300'} font-normal mb-2`}>
          <span className={`${isLightTheme ? 'text-gray-800' : 'text-white'} font-medium`}>{player}</span> Lost Souls:
        </h3>
        <div className="flex gap-2">
          {scoreOptions.map((score) => (
            <button
              key={score}
              type="button"
              onClick={() => setScore(score)}
              className={`w-10 h-10 rounded-md flex items-center justify-center transition-colors border ${
                selectedScore === score
                  ? "bg-blue-600 text-white border-blue-400"
                  : isLightTheme
                    ? "bg-gray-100 text-gray-700 hover:bg-gray-200 border-gray-300"
                    : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700 border-zinc-400"
              }`}
            >
              {score}
            </button>
          ))}
        </div>
      </div>
    );
  };

  return (
    <>
      <div className="flex items-center justify-center w-full h-full" title={isRoundActive ? "Edit match scores" : "Cannot input scores until round is started"}>
        <button 
          className={`p-2 rounded-md flex items-center justify-center ${
            isRoundActive 
              ? isLightTheme 
                ? "bg-blue-100 text-blue-600 hover:bg-blue-200 hover:text-blue-700 transition cursor-pointer"
                : "bg-blue-500/10 text-blue-300 hover:bg-blue-500/20 hover:text-blue-400 transition cursor-pointer" 
              : isLightTheme 
                ? "text-gray-300"
                : "text-gray-500/50"
          }`}
          onClick={handleOpenModal}
          disabled={!isRoundActive}
          aria-label="Edit match scores"
        >
          <Pencil size={20} />
        </button>
      </div>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-60">
          <div className={`${isLightTheme ? 'bg-white' : 'bg-[#1F2937]'} border-2 ${isLightTheme ? 'border-gray-200' : 'border-zinc-300/10'} py-8 px-8 rounded-lg shadow-lg max-w-md w-full`}>
            <h2 className={`text-xl font-bold mb-6 ${isLightTheme ? 'text-gray-800' : 'text-zinc-100'}`}>Edit Match</h2>
            <form onSubmit={handleSubmit} className="flex flex-col gap-6">
              <div className="block space-y-5">
                <ScoreSelector 
                  player={match.player1_id.name} 
                  selectedScore={player1Score} 
                  setScore={setPlayer1Score} 
                />
                <ScoreSelector 
                  player={match.player2_id.name} 
                  selectedScore={player2Score} 
                  setScore={setPlayer2Score} 
                />
                {player1Score === tournament.max_score && player2Score === tournament.max_score && (
                  <p className="text-red-500 text-sm">
                    Score cannot be {tournament.max_score}-{tournament.max_score}.
                  </p>
                )}
              </div>
              <div className="flex justify-end gap-3 mt-2">
                <Button type="submit" outline gradientDuoTone="greenToBlue">
                  Update
                </Button>
                <Button
                  type="button"
                  outline
                  color="red"
                  onClick={() => {
                    setOpen(false);
                  }}
                >
                  Cancel
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
