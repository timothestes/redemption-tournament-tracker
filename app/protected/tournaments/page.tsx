"use client";

import { useState, useEffect } from "react";
import { createClient } from "../../../utils/supabase/client"; // Correct client utility
import SideNav from "../../../components/side-nav";

const supabase = createClient();

export default function TournamentsPage() {
  const [tournaments, setTournaments] = useState([]);
  const [newTournament, setNewTournament] = useState("");

  useEffect(() => {
    fetchTournaments();
  }, []);

  const fetchTournaments = async () => {
    const { data: tournaments, error } = await supabase
      .from("tournaments")
      .select("*");
    if (error) console.error("Error fetching tournaments:", error);
    else setTournaments(tournaments);
  };

  const addTournament = async () => {
    const { data, error } = await supabase
      .from("tournaments")
      .insert([{ name: newTournament }])
      .select();
    if (error) console.error("Error adding tournament:", error);
    else {
      setTournaments([...tournaments, ...data]);
      setNewTournament("");
    }
  };

  const updateTournament = async (id, newName) => {
    const { data, error } = await supabase
      .from("tournaments")
      .update({ name: newName })
      .eq("id", id)
      .select();
    if (error) console.error("Error updating tournament:", error);
    else fetchTournaments();
  };

  const deleteTournament = async (id) => {
    const { error } = await supabase
      .from("tournaments")
      .delete()
      .eq("id", id);
    if (error) console.error("Error deleting tournament:", error);
    else fetchTournaments();
  };

  return (
    <div className="p-4">
      <SideNav />
      <h1 className="text-2xl font-bold">Your tournaments</h1>
      <div className="mt-4">
        <input
          type="text"
          value={newTournament}
          onChange={(e) => setNewTournament(e.target.value)}
          placeholder="New Tournament Name"
          className="border p-2"
        />
        <button
          onClick={addTournament}
          className="ml-2 p-2 bg-blue-500 text-white"
        >
          Add Tournament
        </button>
      </div>
      <ul className="mt-4">
        {tournaments.map((tournament) => (
          <li key={tournament.id} className="flex justify-between items-center">
            <span>{tournament.name}</span>
            <div>
              <button
                onClick={() =>
                  updateTournament(
                    tournament.id,
                    prompt("New name:", tournament.name)
                  )
                }
                className="mr-2 p-1 bg-yellow-500 text-white"
              >
                Edit
              </button>
              <button
                onClick={() => deleteTournament(tournament.id)}
                className="p-1 bg-red-500 text-white"
              >
                Delete
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
