// pages/tournaments/[tournamentId].js
import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { supabase } from '../../utils/supabaseClient';
import styles from '../../components/common.module.css';
import Spinner from '../../components/spinner';

/**
 * View a single tournament's details.
 * This page fetches and displays details of a tournament by its ID and a list of participants.
 */
export default function TournamentView() {
  const [user, setUser] = useState(null);
  const [tournament, setTournament] = useState(null);
  const [participants, setParticipants] = useState([]);
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const { tournamentId } = router.query;

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.push('/login');
      } else {
        setUser(user);
      }
    })();
  }, [router]);

  useEffect(() => {
    const fetchTournament = async () => {
      if (user && tournamentId) {
        setLoading(true);
        try {
          const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/v1/tournaments?eq=id.${tournamentId}`);
          const data = await res.json();
          setTournament(data.length ? data[0] : null);
        } catch (error) {
          console.error("Error fetching tournament:", error);
        } finally {
          setLoading(false);
        }
      }
    };

    const fetchParticipants = async () => {
      if (user && tournamentId) {
        try {
          const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/v1/participants?tournament_id=${tournamentId}`);
          const data = await res.json();
          setParticipants(data);
        } catch (error) {
          console.error("Error fetching participants:", error);
        }
      }
    };

    if (user) {
      fetchTournament();
      fetchParticipants();
    }
  }, [user, tournamentId]);

  if (!user) {
    return (
      <div className={styles.container}>
        <header>
          <button onClick={() => router.push('/')} className={styles.headerButton}>Home</button>
        </header>
        <h1 className={styles.title}>Please log in to view tournament details</h1>
      </div>
    );
  }

  if (loading) {
    return (
      <div className={styles.container}>
        <Spinner />
      </div>
    );
  }

  if (!tournament) {
    return (
      <div className={styles.container}>
        <header>
          <button onClick={() => router.push('/')} className={styles.headerButton}>Home</button>
        </header>
        <h1 className={styles.title}>Tournament not found</h1>
        <button onClick={() => router.push('/tournaments/hosted')} className={styles.button}>
          Back to My Tournaments
        </button>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <header>
        <button onClick={() => router.push('/')} className={styles.headerButton}>Home</button>
      </header>
      <h1 className={styles.title}>{tournament.name}</h1>
      <p><strong>Code:</strong> {tournament.code}</p>
      <p><strong>Status:</strong> {tournament.status}</p>
      <p><strong>Description:</strong> {tournament.description || 'No description'}</p>

      <h2>Participants</h2>
      {participants.length > 0 ? (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>User ID</th>
              <th>Joined At</th>
            </tr>
          </thead>
          <tbody>
            {participants.map((participant) => (
              <tr key={participant.id}>
                <td>{participant.user_id}</td>
                <td>{new Date(participant.created_at).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p>No participants yet.</p>
      )}

      <button onClick={() => router.push('/tournaments/hosted')} className={styles.button}>
        Back to My Tournaments
      </button>
    </div>
  );
}
