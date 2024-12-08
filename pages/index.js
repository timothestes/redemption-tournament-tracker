import { supabase } from '../utils/supabaseClient';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import styles from '../components/common.module.css'; // Import CSS Module
import Spinner from '../components/spinner';

export default function Home({ tournaments, error }) {
  const [user, setUser] = useState(null);
  const [logoutMessage, setLogoutMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [isLoggingOut, setIsLoggingOut] = useState(false); // Loading state for logout
  const router = useRouter();

  useEffect(() => {
    // Get the logged-in user
    const fetchUser = async () => {
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (!user || userError) {
        setUser(null);
      } else {
        setUser(user); // User contains the email
      }
    };
    fetchUser();
  }, []);

  useEffect(() => {
    // Listen to route changes to clear logout message
    const handleRouteChange = () => setLogoutMessage('');
    router.events.on('routeChangeStart', handleRouteChange);

    return () => {
      router.events.off('routeChangeStart', handleRouteChange);
    };
  }, [router.events]);

  useEffect(() => {
    // Check for success message in query parameters
    if (router.query.successMessage) {
      setSuccessMessage(router.query.successMessage);
      // Optionally clear the query parameter from the URL
      const { successMessage, ...rest } = router.query;
      router.replace({ pathname: router.pathname, query: rest }, undefined, { shallow: true });
    }
  }, [router.query]);

  const handleLogout = async () => {
    setIsLoggingOut(true); // Start loading
    const { error } = await supabase.auth.signOut();
    if (error) {
      setLogoutMessage('Error logging out. Please try again.');
    } else {
      setUser(null);
      setLogoutMessage('You have been logged out successfully.');
    }
    setIsLoggingOut(false); // Stop loading
  };

  if (error) {
    return <div className={styles.error}>Error: {error.message}</div>;
  }

  return (
    <div className={styles.container}>
      <header>
        <button onClick={() => router.push('/')} className={styles.headerButton}>
          Home
        </button>
      </header>
      <h1 className={styles.title}>Welcome to the Land of Redemption Tournament Tracker</h1>
      
      {logoutMessage && <p className={styles.message}>{logoutMessage}</p>}
      {successMessage && <p className={styles.message}>{successMessage}</p>}

      {user ? (
        <>
          <p>Logged in as: {user?.email || 'Unknown User'}</p>
          <button onClick={handleLogout} className={`${styles.button} ${styles.secondary}`} disabled={isLoggingOut}>
            {isLoggingOut ? <Spinner /> : 'Log Out'}
          </button>
          <Link href="/tournaments/new">
            <button className={styles.button}>Create a Tournament</button>
          </Link>
          <Link href="/tournaments/join">
            <button className={styles.button}>Join a Tournament</button>
          </Link>

          <h2>Your Tournaments</h2>
          <ul className={styles.tournamentsList}>
            {tournaments.length > 0 ? (
              tournaments.map((tournament) => (
                <li key={tournament.id} className={styles.tournamentItem}>
                  <Link href={`/tournaments/${tournament.id}`}>
                    <a className={styles.tournamentLink}>
                      {tournament.name} - Status: {tournament.status}
                    </a>
                  </Link>
                </li>
              ))
            ) : (
              <p className={styles.noTournaments}>No tournaments found. Create or join one!</p>
            )}
          </ul>
        </>
      ) : (
        <>
          <p>Please log in to manage or join a tournament.</p>
          <Link href="/login">
            <button className={styles.button}>Login</button>
          </Link>
          <Link href="/signup">
            <button className={styles.button}>Sign Up</button>
          </Link>
        </>
      )}
    </div>
  );
}

export async function getServerSideProps() {
  // Fetch tournaments hosted or joined by the logged-in user
  const { data: tournaments, error } = await supabase
    .from('tournaments')
    .select();

  return {
    props: {
      tournaments: tournaments || [],
      error: error || null,
    },
  };
}
