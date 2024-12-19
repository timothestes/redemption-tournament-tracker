"use client";

import { useState, useEffect } from "react";
import { createClient } from "../../../utils/supabase/client"; // Correct client utility
import SideNav from "../../../components/side-nav";
import { generateCode } from "../../../utils/generateCode";

const supabase = createClient();

export default function TournamentsPage() {
  const [tournaments, setTournaments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newTournament, setNewTournament] = useState("");

  useEffect(() => {
    fetchTournaments();
  }, []);

  const fetchTournaments = async () => {
    const { data: tournaments, error } = await supabase
      .from("tournaments")
      .select("*");
    if (error) {
      console.error("Error fetching tournaments:", error);
    } else {
      setTournaments(tournaments);
    }
    setLoading(false);
  };

  const addTournament = async () => {
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError) {
      console.error("Error fetching user:", userError);
      return;
    }

    const code = generateCode();
    const { data, error } = await supabase
      .from("tournaments")
      .insert([{ name: newTournament, code, host_id: user.id }])
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
      {loading ? (
        <p>Loading tournaments...</p>
      ) : tournaments.length === 0 ? (
        <p>No tournaments found.</p>
      ) : (
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
      )}
    </div>
  );
}
