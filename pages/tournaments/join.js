import { useState, useEffect, useRef } from 'react';
import { supabase } from '../../utils/supabaseClient';
import { useRouter } from 'next/router';
import Spinner from '../../components/spinner';
import styles from '../../components/common.module.css';

export default function JoinByCode() {
  const [user, setUser] = useState(null);
  const [joinCode, setJoinCode] = useState('');
  const [isJoining, setIsJoining] = useState(false);
  const [joinResponse, setJoinResponse] = useState('');
  const router = useRouter();
  const joinButtonRef = useRef(null); // Reference for the "Join" button

  useEffect(() => {
    (async () => {
      const { data: { user }, error } = await supabase.auth.getUser();
      if (user) {
        setUser(user);
      } else if (error) {
        console.error('Error fetching user:', error.message);
      }
    })();
  }, []);

  useEffect(() => {
    // Focus the "Join" button when the component mounts
    if (joinButtonRef.current) {
      joinButtonRef.current.focus();
    }
  }, []);

  const handleJoinByCode = async () => {
    if (!joinCode.trim()) {
      setJoinResponse('Please enter a valid code.');
      return;
    }

    setIsJoining(true);
    setJoinResponse('');

    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/v1/participants`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: joinCode,
          user_id: user.id,
        }),
      });

      const data = await response.json();

      if (response.ok) {
        setJoinResponse('Successfully joined the tournament!');
        // Navigate to the tournament page using the returned tournament_id
        if (data.tournament_id) {
          router.push(`/tournaments/${data.tournament_id}`);
        } else {
          setJoinResponse('Error: Could not retrieve tournament details.');
        }
      } else {
        setJoinResponse(data.error || 'Error joining the tournament.');
      }
    } catch (error) {
      setJoinResponse('Error: Could not join the tournament.');
      console.error(error);
    } finally {
      setIsJoining(false);
    }
  };

  return (
    <div className={styles.container}>
      <header>
        <button onClick={() => router.push('/')} className={styles.headerButton}>Home</button>
      </header>
      <h1>Join Tournament by Code</h1>
      {user ? (
        <>
          <input
            type="text"
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value)}
            placeholder="Enter tournament code"
            className={styles.input}
          />
          <button
            ref={joinButtonRef} // Attach the ref to the "Join" button
            onClick={handleJoinByCode}
            disabled={isJoining}
            className={styles.button}
          >
            {isJoining ? (
              <>
                Joining...
                <Spinner />
              </>
            ) : (
              'Join'
            )}
          </button>
          {joinResponse && <p>{joinResponse}</p>}
        </>
      ) : (
        <p>Please log in to join a tournament.</p>
      )}
    </div>
  );
}
