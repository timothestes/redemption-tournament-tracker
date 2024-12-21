"use client";

import { useState, useEffect } from "react";
import { createClient } from "../../../utils/supabase/client";
import ToastNotification from "../../../components/ui/toast-notification";
import { Table } from "flowbite-react";

const supabase = createClient();

export default function TournamentsPage() {
  const [tournaments, setTournaments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showDeleteToast, setShowDeleteToast] = useState(false);

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

  const updateTournament = async (id, newName) => {
    const { data, error } = await supabase
      .from("tournaments")
      .update({ name: newName })
      .eq("id", id)
      .select();
    if (error) console.error("Error updating tournament:", error);
    else {
      fetchTournaments();
    }
  };

  const deleteTournament = async (id) => {
    const { error } = await supabase
      .from("tournaments")
      .delete()
      .eq("id", id);
    if (error) console.error("Error deleting tournament:", error);
    else {
      fetchTournaments();
      setShowDeleteToast(true);
      setTimeout(() => setShowDeleteToast(false), 2000); // 2 seconds
    }
  };

  return (
    <div className="flex h-screen pl-64">
      <div className="flex-grow p-4">
        <h1 className="text-2xl font-bold">Your tournaments</h1>
        {loading ? (
          <p>Loading tournaments...</p>
        ) : tournaments.length === 0 ? (
          <p>
            No tournaments found.{" "}
            <a
              href="/tracker/tournaments/host"
              className="text-blue-500 underline"
            >
              Create one?
            </a>
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table hoverable>
              <Table.Head>
                <Table.HeadCell>Name</Table.HeadCell>
                <Table.HeadCell>Created At</Table.HeadCell>
                <Table.HeadCell>
                  <span className="sr-only">Edit</span>
                </Table.HeadCell>
              </Table.Head>
              <Table.Body className="divide-y">
                {tournaments.map((tournament) => (
                  <Table.Row key={tournament.id} className="bg-white dark:border-gray-700 dark:bg-gray-800">
                    <Table.Cell className="whitespace-nowrap font-medium text-gray-900 dark:text-white">
                      {tournament.name}
                    </Table.Cell>
                    <Table.Cell>
                      {new Intl.DateTimeFormat("en-US", {
                        year: "numeric",
                        month: "long",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                        second: "2-digit",
                        timeZone: "UTC",
                      }).format(new Date(tournament.created_at))}
                    </Table.Cell>
                    <Table.Cell>
                      <button
                        onClick={() =>
                          updateTournament(
                            tournament.id,
                            prompt("New name:", tournament.name)
                          )
                        }
                        className="mr-2 p-1 bg-yellow-600 text-white"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => deleteTournament(tournament.id)}
                        className="p-1 bg-red-600 text-white"
                      >
                        Delete
                      </button>
                    </Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table>
          </div>
        )}
        <ToastNotification
          message="Tournament deleted successfully!"
          show={showDeleteToast}
          onClose={() => setShowDeleteToast(false)}
          type="error"
        />
      </div>
    </div>
  );
}
