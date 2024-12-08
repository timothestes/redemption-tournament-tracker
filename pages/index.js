import { supabase } from '../utils/supabaseClient';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import styles from '../components/common.module.css';
import Spinner from '../components/spinner';

export default function Home() {
  const [user, setUser] = useState(null);
  const [logoutMessage, setLogoutMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const router = useRouter();

  useEffect(() => {
    (async () => {
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (!user || userError) {
        setUser(null);
      } else {
        setUser(user);
      }
    })();
  }, []);

  useEffect(() => {
    const handleRouteChange = () => setLogoutMessage('');
    router.events.on('routeChangeStart', handleRouteChange);

    return () => {
      router.events.off('routeChangeStart', handleRouteChange);
    };
  }, [router.events]);

  useEffect(() => {
    if (router.query.successMessage) {
      setSuccessMessage(router.query.successMessage);
      const { successMessage, ...rest } = router.query;
      router.replace({ pathname: router.pathname, query: rest }, undefined, { shallow: true });
    }
  }, [router.query]);

  const handleLogout = async () => {
    setIsLoggingOut(true);
    const { error } = await supabase.auth.signOut();
    if (error) {
      setLogoutMessage('Error logging out. Please try again.');
    } else {
      setUser(null);
      setLogoutMessage('You have been logged out successfully.');
    }
    setIsLoggingOut(false);
  };

  return (
    <div className={styles.container}>
      <header>
        <button onClick={() => router.push('/')} className={styles.headerButton}>Home</button>
      </header>
      <h1 className={styles.title}>Land of Redemption Tournament Tracker</h1>
      
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
          <Link href="/tournaments/list">
            <button className={styles.button}>View Your Tournaments</button>
          </Link>
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
