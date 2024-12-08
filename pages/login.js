// pages/Login.js
import { useState, useEffect, useRef } from 'react';
import { supabase } from '../utils/supabaseClient';
import { useRouter } from 'next/router';
import Link from 'next/link';
import styles from '../components/common.module.css';
import Spinner from '../components/spinner';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();
  const loginButtonRef = useRef(null);

  useEffect(() => {
    if (loginButtonRef.current) {
      loginButtonRef.current.focus();
    }
  }, []);

  const handleLogin = async () => {
    setErrorMessage('');
    setIsLoading(true);

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
        setIsLoading(false);
        return;
      }
      router.push('/');
    } catch (err) {
      setErrorMessage('An unexpected error occurred. Please try again.');
      setIsLoading(false);
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
      <button ref={loginButtonRef} onClick={handleLogin} className={styles.button} disabled={isLoading}>
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
