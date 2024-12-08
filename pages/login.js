// pages/Login.js
import { useState } from 'react';
import { supabase } from '../utils/supabaseClient';
import { useRouter } from 'next/router';
import Link from 'next/link';
import styles from '../components/common.module.css'; // Ensure the correct casing for the CSS Module
import Spinner from '../components/spinner';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false); // Loading state
  const router = useRouter();

  const handleLogin = async () => {
    setErrorMessage(''); // Reset error message
    setIsLoading(true); // Start loading

    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        if (error.message === 'Email not confirmed') {
          setErrorMessage('Please confirm your email before logging in. Check your spam folder for the confirmation link.');
        } else {
          if (error.message === "Invalid login credentials") {
            setErrorMessage("Invalid login credentials or account doesn't exist.");
          } else {
            setErrorMessage(error.message);
          }
        }
        setIsLoading(false); // Stop loading on error
        return;
      }

      router.push('/'); // Redirect to Home on successful login
    } catch (err) {
      setErrorMessage('An unexpected error occurred. Please try again.');
      setIsLoading(false); // Stop loading on unexpected error
    }
  };

  return (
    <div className={styles.container}>
      <header>
        <button onClick={() => router.push('/')} className={styles.headerButton}>
          Home
        </button>
      </header>
      <h1 className={styles.title}>Login</h1>
      {errorMessage && <p className={styles.error}>{errorMessage}</p>}
      <input
        type="email"
        placeholder="Email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className={styles.input}
        aria-label="Email"
      />
      <input
        type="password"
        placeholder="Password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        className={styles.input}
        aria-label="Password"
      />
      <button onClick={handleLogin} className={styles.button} disabled={isLoading}>
        {isLoading ? <Spinner /> : 'Login'}
      </button>
      <p>
        Don't have an account?{' '}
        <Link href="/signup" className={styles.linkText}>
          Sign Up
        </Link>
      </p>
    </div>
  );
}
