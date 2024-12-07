import { useState } from 'react';
import { supabase } from '../../utils/supabaseClient';
import Layout from '../../components/Layout';

export default function JoinTournament() {
  const [code, setCode] = useState('');

  const handleJoin = async () => {
    const { data: user, error: userError } = await supabase.auth.getUser();
    if (!user || userError) {
      alert('You must be logged in to join a tournament!');
      return;
    }

    const { data, error } = await supabase
      .from('tournaments')
      .select('*')
      .eq('code', code)
      .single();

    if (error) {
      alert('Tournament not found!');
    } else {
      await supabase
        .from('participants')
        .insert([{ tournament_id: data.id, user_id: user.id }]);
      alert('Successfully joined!');
    }
  };

  return (
    <Layout>
      <h1>Join a Tournament</h1>
      <input
        type="text"
        placeholder="Enter Tournament Code"
        value={code}
        onChange={(e) => setCode(e.target.value)}
      />
      <button onClick={handleJoin}>Join</button>
    </Layout>
  );
}
