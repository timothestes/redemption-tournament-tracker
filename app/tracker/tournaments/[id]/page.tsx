"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "../../../../utils/supabase/client";

const supabase = createClient();

export default function TournamentPage({ params }: { params: Promise<{ id: string }> }) {
  const [tournament, setTournament] = useState(null);
  const [id, setId] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    const unwrapParams = async () => {
      const resolvedParams = await params;
      setId(resolvedParams.id);
    };

    unwrapParams();
  }, [params]);

  useEffect(() => {
    if (!id) return;

    const fetchTournament = async () => {
      const { data, error } = await supabase
        .from("tournaments")
        .select("*")
        .eq("id", id)
        .single();
      if (error) {
        console.error("Error fetching tournament:", error);
        router.push("/tracker/tournaments");
      } else {
        setTournament(data);
      }
    };

    fetchTournament();
  }, [id, router]);

  if (!tournament) {
    return <p>Loading tournament data...</p>;
  }

  return (
    <div className="flex h-screen pl-64">
      <div className="flex-grow p-4">
        <h1 className="text-2xl font-bold">{tournament.name}</h1>
        <p>Code: {tournament.code}</p>
        <p>Host ID: {tournament.host_id}</p>
        {/* Add more tournament details here */}
      </div>
    </div>
  );
}
