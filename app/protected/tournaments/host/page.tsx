"use client";

import { useState } from "react";
import { createClient } from "../../../../utils/supabase/client";
import { useRouter } from "next/navigation";
import SideNav from "../../../../components/side-nav";
import { generateCode } from "../../../../utils/generateCode";

const supabase = createClient();

export default function HostTournamentPage() {
  const [newTournament, setNewTournament] = useState("");
  const router = useRouter();

  const addTournament = async () => {
    if (!newTournament.trim()) {
      alert("Tournament name is required.");
      return;
    }

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
      setNewTournament("");
      router.push("/protected/tournaments");
    }
  };

  return (
    <div className="p-4">
      <SideNav />
      <h1 className="text-2xl font-bold">Host a Tournament</h1>
      <div className="mt-4">
        <input
          type="text"
          value={newTournament}
          onChange={(e) => setNewTournament(e.target.value)}
          placeholder="New Tournament Name"
          className="border p-2"
          required
          maxLength={50} // Set a reasonable character limit
        />
        <button
          onClick={addTournament}
          className="ml-2 p-2 bg-blue-500 text-white"
        >
          Add Tournament
        </button>
      </div>
    </div>
  );
}
