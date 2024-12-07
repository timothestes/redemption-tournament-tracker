import { useRouter } from 'next/router';
import { useState, useEffect } from 'react';
import { supabase } from '../../utils/supabaseClient';
import Layout from '../../components/Layout';

export default function TournamentDetails() {
  const router = useRouter();
  const { id } = router.query;

  const [tournament, setTournament] = useState(null);
  const [rounds, setRounds] = useState(3);
  const [roundTime, setRoundTime] = useState(30);
  const [user, setUser] = useState(null);
  const [participants, setParticipants] = useState([]);
  const [isHostParticipant, setIsHostParticipant] = useState(false);

  useEffect(() => {
    const fetchUserAndTournament = async () => {
      // Fetch the logged-in user using Supabase Auth
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (!user || userError) {
        console.error('Error fetching user:', userError);
        alert('You must be logged in to view this tournament!');
        router.push('/auth');
        return;
      }
      setUser(user);
      console.log('Fetched user:', user); // Log user data

      // Fetch the tournament details
      const { data: tournament, error } = await supabase
        .from('tournaments')
        .select('*')
        .eq('id', id)
        .single();

      if (error) {
        console.error('Error fetching tournament:', error);
        alert('Error loading tournament details.');
      } else {
        setTournament(tournament);
      }

      // Fetch participants for the tournament
      const { data: participants, error: participantsError } = await supabase
        .from('participants')
        .select('user_id')
        .eq('tournament_id', id);

      if (participantsError) {
        console.error('Error fetching participants:', participantsError);
      } else {
        // Get user emails from the Supabase Auth API for each participant
        const participantsWithEmails = [];
        for (let participant of participants) {
          const { data: user, error: userError } = await supabase
            .from('auth.users')
            .select('email')
            .eq('id', participant.user_id)
            .single();
          if (userError) {
            console.error('Error fetching user email:', userError);
            participant.email = 'Unknown User';
          } else {
            participant.email = user?.email || 'Unknown User';
          }
          participantsWithEmails.push(participant);
        }
        setParticipants(participantsWithEmails);
        setIsHostParticipant(participants.some(participant => participant.user_id === user.id));
      }
    };

    if (id) fetchUserAndTournament();
  }, [id, router]);

  const handleHostToggle = async () => {
    if (!user || !tournament) return;

    if (isHostParticipant) {
      // Remove the host from participants
      const { error } = await supabase
        .from('participants')
        .delete()
        .eq('tournament_id', id)
        .eq('user_id', user.id);

      if (error) {
        console.error('Error removing host from participants:', error);
        alert('Failed to remove host from tournament.');
      } else {
        setParticipants((prev) =>
          prev.filter((participant) => participant.user_id !== user.id)
        );
        setIsHostParticipant(false);
        alert('You have been removed from the tournament.');
      }
    } else {
      // Add the host to participants
      const { error } = await supabase
        .from('participants')
        .insert([{ tournament_id: id, user_id: user.id }]);

      if (error) {
        console.error('Error adding host to participants:', error);
        alert('Failed to add host to tournament.');
      } else {
        setParticipants((prev) => [
          ...prev,
          { user_id: user.id, email: user.email },
        ]);
        setIsHostParticipant(true);
        alert('You have joined the tournament.');
      }
    }
  };

  const handleStart = async () => {
    if (!user || !tournament) {
      alert('Data not loaded yet. Please wait and try again.');
      return;
    }

    if (String(user.id) !== String(tournament.host_id)) {
      alert('Only the host can start the tournament!');
      return;
    }

    const { error } = await supabase
      .from('tournaments')
      .update({ status: 'active', settings: { rounds, roundTime } })
      .eq('id', id);

    if (error) {
      alert(error.message);
    } else {
      alert('Tournament started!');
      setTournament({ ...tournament, status: 'active' });
    }
  };

  if (!tournament) return <Layout><div>Loading...</div></Layout>;

  return (
    <Layout>
      <h1>{tournament.name}</h1>
      <p>{tournament.description}</p>
      <p><strong>Join Code:</strong> {tournament.code}</p>
      <p><strong>Host:</strong> {tournament.host_id === user?.id ? 'You' : 'Another User'}</p>
      <h2>Participants</h2>
      <ul>
        {participants.length > 0 ? (
          participants.map((participant) => {
            console.log('Rendering participant:', participant); // Log each participant object
            return (
              <li key={participant.user_id}>
                {participant.email || 'Unknown User'}
              </li>
            );
          })
        ) : (
          <>
            {console.log('No participants found.')} {/* Log when no participants are available */}
            <p>No participants have joined yet.</p>
          </>
        )}
      </ul>
      {tournament.host_id === user?.id && (
        <div>
          <label>
            <input
              type="checkbox"
              checked={isHostParticipant}
              onChange={handleHostToggle}
            />
            Join as Participant
          </label>
        </div>
      )}
      <h2>Settings</h2>
      <input
        type="number"
        placeholder="Number of Rounds"
        value={rounds}
        onChange={(e) => setRounds(e.target.value)}
      />
      <input
        type="number"
        placeholder="Round Time (minutes)"
        value={roundTime}
        onChange={(e) => setRoundTime(e.target.value)}
      />
      <button
        onClick={handleStart}
        disabled={tournament.status === 'active'} // Disable if status is 'active'
      >
        {tournament.status === 'active' ? 'Tournament Active' : 'Start Tournament'}
      </button>
    </Layout>
  );
}
