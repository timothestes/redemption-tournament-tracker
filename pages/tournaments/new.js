// pages/tournaments/new.js
import { useState, useEffect } from 'react';
import { supabase } from '../../utils/supabaseClient';
import { useRouter } from 'next/router';
import styles from '../../components/common.module.css';
import Spinner from '../../components/spinner';

export default function NewTournament() {
  const [user, setUser] = useState(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const router = useRouter();

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

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsCreating(true);
    setError('');
    setSuccessMessage('');

    if (!name) {
      setError('Name is required.');
      setIsCreating(false);
      return;
    }

    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/v1/tournaments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host_id: user.id,
          name,
          description
        })
      });
      const data = await res.json();
      if (res.ok) {
        setSuccessMessage('Tournament created successfully.');
        setName('');
        setDescription('');
      } else {
        setError(data.error || 'Error creating tournament.');
      }
    } catch (err) {
      setError('Error creating tournament.');
    }
    setIsCreating(false);
  };

  if (!user) {
    return (
      <div className={styles.container}>
        <header>
          <button onClick={() => router.push('/')} className={styles.headerButton}>Home</button>
        </header>
        <h1 className={styles.title}>Creating a Tournament</h1>
        <p>Please log in first.</p>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <header>
        <button onClick={() => router.push('/')} className={styles.headerButton}>Home</button>
      </header>
      <h1 className={styles.title}>Create a New Tournament</h1>
      {error && <p className={styles.error}>{error}</p>}
      {successMessage && <p className={styles.message}>{successMessage}</p>}
      <form onSubmit={handleSubmit} className={styles.form}>
        <input
          className={styles.input}
          placeholder="Tournament Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <textarea
          className={styles.input}
          placeholder="Description (optional)"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <button className={styles.button} type="submit" disabled={isCreating}>
          {isCreating ? <Spinner /> : 'Create'}
        </button>
      </form>
      <button onClick={() => router.push('/tournaments/list')} className={styles.headerButton}>
        Back to My Tournaments
      </button>
    </div>
  );
}
