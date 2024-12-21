import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "../../../../utils/supabase/client";
import { Table } from "flowbite-react";

const supabase = createClient();

export default function TournamentPage({ params }: { params: Promise<{ id: string }> }) {
  const [participants, setParticipants] = useState([]);
  const [loading, setLoading] = useState(true);
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

    const fetchParticipants = async () => {
      const { data, error } = await supabase
        .from("participants")
        .select("*")
        .eq("tournament_id", id);
      if (error) {
        console.error("Error fetching participants:", error);
      } else {
        setParticipants(data);
      }
      setLoading(false);
    };

    fetchParticipants();
  }, [id]);

  return (
    <div className="flex h-screen pl-64">
      <div className="flex-grow p-4">
        <h1 className="text-2xl font-bold mb-6">Participants</h1>
        {loading ? (
          <p>Loading participants...</p>
        ) : participants.length === 0 ? (
          <p>No participants found.</p>
        ) : (
          <div className="overflow-x-auto">
            <Table hoverable>
              <Table.Head>
                <Table.HeadCell>Name</Table.HeadCell>
                <Table.HeadCell>Joined At</Table.HeadCell>
                <Table.HeadCell>Place</Table.HeadCell>
                <Table.HeadCell>Match Points</Table.HeadCell>
                <Table.HeadCell>Differential</Table.HeadCell>
                <Table.HeadCell>Dropped Out</Table.HeadCell>
              </Table.Head>
              <Table.Body className="divide-y">
                {participants.map((participant) => (
                  <Table.Row key={participant.id} className="bg-white dark:border-gray-700 dark:bg-gray-800">
                    <Table.Cell className="whitespace-nowrap font-medium text-gray-900 dark:text-white">
                      {participant.name}
                    </Table.Cell>
                    <Table.Cell>
                      {new Intl.DateTimeFormat("en-US", {
                        year: "numeric",
                        month: "long",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                        second: "2-digit",
                      }).format(new Date(participant.joined_at))}
                    </Table.Cell>
                    <Table.Cell>{participant.place}</Table.Cell>
                    <Table.Cell>{participant.match_points}</Table.Cell>
                    <Table.Cell>{participant.differential}</Table.Cell>
                    <Table.Cell>{participant.dropped_out ? "Yes" : "No"}</Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table>
          </div>
        )}
      </div>
    </div>
  );
}
