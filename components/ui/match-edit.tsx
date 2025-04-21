"use client";

import { Button, TextInput } from "flowbite-react";
import { Pencil } from "lucide-react";
import { Dispatch, FormEvent, SetStateAction, useState } from "react";
import { createClient } from "../../utils/supabase/client";

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
  

  return (
    <>
      <div className="flex items-center justify-center w-full h-full" title={isRoundActive ? "" : "Cannot input scores until round is started"}>
        <Pencil
          className={`${isRoundActive ? "text-blue-300 hover:text-blue-500 transition cursor-pointer" : "text-gray-500/50"}`}
          size={16}
          onClick={() => {
            if (isRoundActive) {
              setOpen(!open)
            }
          }}
        />
      </div>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-60">
          <div className="bg-[#1F2937] border-2 border-zinc-300/10 py-6 px-6 rounded-lg shadow-lg max-w-sm w-full">
            <h2 className="text-xl font-bold mb-4 text-zinc-100">Edit Match</h2>
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <div className="mb-2 block space-y-3">
                <div className="flex items-center gap-3">
                  <h3 className="text-lg text-zinc-300 w-full text-end font-normal">
                    "
                    <span className="text-white font-medium">
                      {match.player1_id.name}
                    </span>
                    " Lost Souls:{" "}
                  </h3>
                  <TextInput
                    type="number"
                    placeholder="Souls Rescued"
                    value={player1Score ?? ""}
                    onChange={(event) => {
                      setPlayer1Score(Number(event.target.value));
                    }}
                    className="min-w-[50px]"
                  />
                </div>
                <div className="flex items-center gap-3">
                  <h3 className="text-lg text-zinc-200 w-full text-end">
                    "<span className="text-white">{match.player2_id.name}</span>
                    " Lost Souls:{" "}
                  </h3>
                  <TextInput
                    type="number"
                    placeholder="Souls Rescued"
                    defaultValue={player2Score ?? ""}
                    onChange={(event) => {
                      setPlayer2Score(Number(event.target.value));
                    }}
                    className="min-w-[50px]"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-3">
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
