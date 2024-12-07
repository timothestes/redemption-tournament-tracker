import { useState } from 'react';
import { supabase } from '../utils/supabaseClient';
import { useRouter } from 'next/router';

export default function SignUp() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const router = useRouter();

  const handleSignUp = async () => {
    setErrorMessage(''); // Reset error message

    // Validate input
    if (!firstName.trim() || !lastName.trim()) {
      setErrorMessage('First and Last Name cannot be empty.');
      return;
    }

    // Sign up using Supabase Auth
    const { data: user, error } = await supabase.auth.signUp({ email, password });
    if (error) {
      setErrorMessage(error.message);
      return;
    }

    // Call Flask API to save additional user data
    try {
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
        alert('Sign-up successful! Check your email for the confirmation link!');
        router.push('/login');
      } else if (response.status === 409) {
        setErrorMessage('This email is already registered. Please login instead.');
      } else {
        const result = await response.json();
        setErrorMessage(result.error || 'An error occurred while saving your data. Please try again.');
      }
    } catch (err) {
      setErrorMessage('Unable to connect to the server. Please try again later.');
    }
  };

  return (
    <div>
      <header>
        <button onClick={() => router.push('/')}>Home</button>
      </header>
      <h1>Sign Up</h1>
      {errorMessage && <p style={{ color: 'red' }}>{errorMessage}</p>}
      <input
        type="text"
        placeholder="First Name"
        value={firstName}
        onChange={(e) => setFirstName(e.target.value)}
      />
      <input
        type="text"
        placeholder="Last Name"
        value={lastName}
        onChange={(e) => setLastName(e.target.value)}
      />
      <input
        type="email"
        placeholder="Email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <input
        type="password"
        placeholder="Password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      <button onClick={handleSignUp}>Sign Up</button>
      <p>
        Already have an account? <a href="/login">Login</a>
      </p>
    </div>
  );
}
