import { supabase } from '../utils/supabaseClient';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';

export default function Home({ tournaments, error }) {
  const [user, setUser] = useState(null);
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

  const handleLogout = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) {
      alert('Error logging out');
    } else {
      setUser(null);
      alert('You have been logged out.');
    }
  };

  if (error) {
    return <div>Error: {error.message}</div>;
  }

  return (
    <div>
      <h1>Welcome to the Tournament Tracker</h1>
      <button onClick={() => router.push('/')}>Home</button> {/* Home Button */}
      {user ? (
        <>
          <p>Logged in as: {user?.email || 'Unknown User'}</p>
          <button onClick={handleLogout}>Log Out</button>
          <Link href="/tournaments/new">
            <button>Create a Tournament</button>
          </Link>
          <Link href="/tournaments/join">
            <button>Join a Tournament</button>
          </Link>

          <h2>Your Tournaments</h2>
          <ul>
            {tournaments.length > 0 ? (
              tournaments.map((tournament) => (
                <li key={tournament.id}>
                  <Link href={`/tournaments/${tournament.id}`}>
                    {tournament.name} - Status: {tournament.status}
                  </Link>
                </li>
              ))
            ) : (
              <p>No tournaments found. Create or join one!</p>
            )}
          </ul>
        </>
      ) : (
        <>
          <p>Please log in to manage tournaments.</p>
          <Link href="/auth">
            <button>Login / Sign Up</button>
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
