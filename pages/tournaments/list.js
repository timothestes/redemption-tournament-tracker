import { useState, useEffect } from 'react';
import { supabase } from '../../utils/supabaseClient';
import Link from 'next/link';
import { useRouter } from 'next/router';
import styles from '../../components/common.module.css';
import Spinner from '../../components/spinner';

export default function UserTournaments() {
  const [user, setUser] = useState(null);
  const [tournaments, setTournaments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [deleteConfirmationId, setDeleteConfirmationId] = useState(null);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [deleteStatus, setDeleteStatus] = useState('');
  const router = useRouter();

  useEffect(() => {
    // Get the logged-in user
    (async () => {
      const { data: { user }, error } = await supabase.auth.getUser();
      if (!user || error) {
        setUser(null);
        setLoading(false);
      } else {
        setUser(user);
      }
    })();
  }, []);

  useEffect(() => {
    const fetchUserTournaments = async () => {
      if (user && user.id) {
        setLoading(true);
        try {
          const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/v1/user-tournaments?user_id=${user.id}`);
          const data = await res.json();
          setTournaments(data);
        } catch (error) {
          console.error("Error fetching user tournaments:", error);
        } finally {
          setLoading(false);
        }
      }
    };
    if (user) {
      fetchUserTournaments();
    }
  }, [user]);

  const formatDateTime = (timestamp) => {
    const date = new Date(timestamp);
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const confirmDelete = (tournamentId) => {
    setDeleteConfirmationId(tournamentId);
    setShowConfirmation(true);
  };

  const handleCancelDelete = () => {
    setDeleteConfirmationId(null);
    setShowConfirmation(false);
  };

  const handleConfirmDelete = async () => {
    if (!deleteConfirmationId) return;
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/v1/tournaments/${deleteConfirmationId}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (res.ok) {
        setTournaments((prev) => prev.filter((t) => t.id !== deleteConfirmationId));
        setDeleteStatus('Tournament deleted successfully.');
      } else {
        setDeleteStatus(data.error || 'Error deleting tournament.');
      }
    } catch (error) {
      setDeleteStatus('Error deleting tournament.');
    }
    setDeleteConfirmationId(null);
    setShowConfirmation(false);
  };

  if (!user) {
    return (
      <div className={styles.container}>
        <header>
          <button onClick={() => router.push('/')} className={styles.headerButton}>
            Home
          </button>
        </header>
        <h1 className={styles.title}>Please log in to view your tournaments</h1>
        <Link href="/login">
          <button className={styles.button}>Login</button>
        </Link>
        <Link href="/signup">
          <button className={styles.button}>Sign Up</button>
        </Link>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <header>
        <button onClick={() => router.push('/')} className={styles.headerButton}>
          Home
        </button>
      </header>
      <h1 className={styles.title}>Your Tournaments</h1>
      {deleteStatus && <p className={styles.message}>{deleteStatus}</p>}
      {loading ? (
        <Spinner />
      ) : tournaments.length > 0 ? (
        <>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Name</th>
                <th>Code</th>
                <th>Status</th>
                <th>Participants</th>
                <th>Description</th>
                <th>Date Created</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {tournaments.map((t) => (
                <tr key={t.id}>
                  <td>
                    <Link href={`/tournaments/${t.id}`} className={styles.tournamentLink}>
                      {t.name}
                    </Link>
                  </td>
                  <td>{t.code}</td>
                  <td>{t.status}</td>
                  <td>{t.participant_count || 0}</td>
                  <td>{t.description || 'No description'}</td>
                  <td>{formatDateTime(t.created_at)}</td>
                  <td>
                    <button
                      className={`${styles.button}`}
                      onClick={() => router.push(`/tournaments/${t.id}`)}
                    >
                      View
                    </button>
                    {t.host_id === user.id && (
                      <button
                        className={`${styles.button} ${styles.deleteButton}`}
                        onClick={() => confirmDelete(t.id)}
                      >
                        Delete
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {showConfirmation && (
            <div className={styles.fadeOverlay}>
              <div className={styles.fadeModal}>
                <h2>Confirm Deletion</h2>
                <p>Are you sure you want to delete this tournament?</p>
                <div className={styles.modalActions}>
                  <button className={`${styles.button} ${styles.deleteButton}`} onClick={handleConfirmDelete}>
                    Delete
                  </button>
                  <button className={`${styles.button} ${styles.neutralButton}`} onClick={handleCancelDelete}>
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      ) : (
        <p className={styles.noTournaments}>You are not part of any tournaments yet.</p>
      )}
    </div>
  );
}
