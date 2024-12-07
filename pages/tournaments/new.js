import { useState } from 'react';
import { supabase } from '../../utils/supabaseClient';
import { useRouter } from 'next/router';
import Layout from '../../components/Layout';

export default function NewTournament() {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const router = useRouter();

  const handleCreate = async () => {
    // Fetch the logged-in user
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    console.log('Fetched user:', user); // Debugging user object

    if (!user || userError) {
      alert('You must be logged in to create a tournament!');
      return;
    }

    if (!user.id) {
      console.error('User ID is missing:', user); // Debugging
      alert('Unable to retrieve your user information. Please log in again.');
      return;
    }

    // Build the payload for the tournament
    const payload = {
      name,
      description,
      host_id: user.id, // Include user ID as host_id
      code: Math.random().toString(36).substr(2, 6),
    };

    console.log('Payload to insert:', payload); // Debugging payload

    // Insert tournament into the database
    const { data, error } = await supabase
      .from('tournaments')
      .insert([payload])
      .select(); // Ensure the response includes the inserted rows

    if (error) {
      console.error('Error creating tournament:', error); // Debugging error
      alert(error.message);
      return;
    }

    if (!data || data.length === 0) {
      console.error('No data returned from insert operation:', data); // Debugging
      alert('An unexpected error occurred while creating the tournament.');
      return;
    }

    console.log('Tournament created successfully:', data); // Debugging success
    router.push(`/tournaments/${data[0].id}`);
  };

  return (
    <Layout>
      <h1>Create a Tournament</h1>
      <input
        type="text"
        placeholder="Tournament Name"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <textarea
        placeholder="Description"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      ></textarea>
      <button onClick={handleCreate}>Create</button>
    </Layout>
  );
}
