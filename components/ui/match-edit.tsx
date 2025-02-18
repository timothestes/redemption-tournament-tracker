"use client";

import { Button, Label, TextInput } from "flowbite-react";
import { Pencil } from "lucide-react";
import { FormEvent, useRef, useState } from "react";
import { createClient } from "../../utils/supabase/client";

export default function MatchEditModal({
  match,
  fetchCurrentRoundData,
}: {
  match: any;
  fetchCurrentRoundData: any;
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
      player1Score > 5 ||
      player2Score > 5
    ) {
      alert("Invalid scores. Scores must be between 0 and 5, inclusive.");
      return;
    }

    const client = createClient();

    const { data, error } = await client
      .from("matches")
      .update({
        player1_score: player1Score,
        player2_score: player2Score,
        updated_at: new Date(),
      })
      .eq("id", match.id);

    if (!error) {
      fetchCurrentRoundData();
      setOpen(false);
    } else {
      alert("Some error occurred!");
    }
  };

  console.log(match);
  return (
    <>
      <Pencil
        className="text-blue-300 hover:text-blue-500 transition cursor-pointer"
        size={16}
        onClick={() => setOpen(!open)}
      />
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
                    " Points:{" "}
                  </h3>
                  <TextInput
                    type="number"
                    placeholder="Enter points"
                    value={player1Score}
                    onChange={(event) => {
                      setPlayer1Score(Number(event.target.value));
                    }}
                    className="min-w-[50px]"
                  />
                </div>
                <div className="flex items-center gap-3">
                  <h3 className="text-lg text-zinc-200 w-full text-end">
                    "<span className="text-white">{match.player2_id.name}</span>
                    " Points:{" "}
                  </h3>
                  <TextInput
                    type="number"
                    placeholder="Enter points"
                    defaultValue={player2Score}
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
