// pages/SignUp.js
import { useState } from 'react';
import { supabase } from '../utils/supabaseClient';
import { useRouter } from 'next/router';
import Link from 'next/link';
import styles from '../components/common.module.css';
import Spinner from '../components/spinner';

export default function SignUp() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false); // Loading state
  const router = useRouter();

  const handleSignUp = async () => {
    setErrorMessage('');
    setSuccessMessage('');
    setIsLoading(true); // Start loading

    // Validate input
    if (!firstName.trim() || !lastName.trim()) {
      setErrorMessage('First and Last Name cannot be empty.');
      setIsLoading(false); // Stop loading
      return;
    }

    try {
      // Sign up using Supabase Auth
      const { data: user, error } = await supabase.auth.signUp({ email, password });
      if (error) {
        setErrorMessage(error.message);
        setIsLoading(false); // Stop loading
        return;
      }

      // Call Flask API to save additional user data
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/save-user-data`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: user.user?.id,
          email: user.user?.email,
          firstName,
          lastName,
        }),
      });

      // Handle API response
      if (response.ok) {
        setSuccessMessage('Sign-up successful! Check your email for the confirmation link.');
        router.push(`/?successMessage=Sign-up successful! Check your email for the confirmation link.`);
      } else if (response.status === 409) {
        setErrorMessage('This email is already registered. Please login instead.');
      } else {
        const result = await response.json();
        setErrorMessage(result.error || 'An error occurred while saving your data. Please try again.');
      }
    } catch (err) {
      setErrorMessage('Unable to connect to the server. Please try again later.');
    } finally {
      setIsLoading(false); // Stop loading in all cases
    }
  };

  return (
    <div className={styles.container}>
      <header>
        <button onClick={() => router.push('/')} className={styles.headerButton}>
          Home
        </button>
      </header>
      <h1 className={styles.title}>Sign Up</h1>
      {errorMessage && <p className={styles.error}>{errorMessage}</p>}
      {successMessage && <p className={styles.success}>{successMessage}</p>}
      <input
        type="text"
        placeholder="First Name"
        value={firstName}
        onChange={(e) => setFirstName(e.target.value)}
        className={styles.input}
        aria-label="First Name"
      />
      <input
        type="text"
        placeholder="Last Name"
        value={lastName}
        onChange={(e) => setLastName(e.target.value)}
        className={styles.input}
        aria-label="Last Name"
      />
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
      <button onClick={handleSignUp} className={styles.button} disabled={isLoading}>
        {isLoading ? <Spinner /> : 'Sign Up'}
      </button>
      <p>
        Already have an account?{' '}
        <Link href="/login" className={styles.linkText}>
          Login
        </Link>
      </p>
    </div>
  );
}
