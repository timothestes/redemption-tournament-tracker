// pages/debug.js
import { useState } from 'react';
import { useRouter } from 'next/router';
import Spinner from '../components/spinner';

export default function Debug() {
  const [aboutResponse, setAboutResponse] = useState('');
  const [isLoadingPing, setIsLoadingPing] = useState(false); // Loading state for Ping button
  const router = useRouter();

  // Handler for Ping About Endpoint button
  const handlePingAbout = async () => {
    setIsLoadingPing(true); // Show spinner in Ping button
    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/about`, {
        method: 'GET',
      });

      if (!response.ok) {
        throw new Error('Failed to fetch /about endpoint');
      }

      const data = await response.text();
      setAboutResponse(data);
    } catch (error) {
      setAboutResponse('Error: Could not reach the /about endpoint.');
    } finally {
      setIsLoadingPing(false); // Hide spinner in Ping button
    }
  };

  return (
    <div style={styles.container}>
      <header style={styles.header}>
        <button onClick={() => router.push('/')} style={styles.homeButton}>
          Home
        </button>
      </header>
      <h1>Debug Page</h1>
      
      {/* Ping About Endpoint Button */}
      <div style={styles.buttonContainer}>
        <button 
          onClick={handlePingAbout} 
          disabled={isLoadingPing} 
          style={styles.button}
        >
          {isLoadingPing ? (
            <>
              Pinging...
              <Spinner />
            </>
          ) : (
            'Ping About Endpoint'
          )}
        </button>
      </div>
      
      {/* Display the aboutResponse */}
      {aboutResponse && <p>{aboutResponse}</p>}
    </div>
  );
}

// Inline styles for simplicity; consider using CSS modules or styled-components for better scalability
const styles = {
  container: {
    padding: '20px',
    fontFamily: 'Arial, sans-serif',
  },
  header: {
    marginBottom: '20px',
  },
  homeButton: {
    padding: '10px 20px',
    fontSize: '16px',
  },
  buttonContainer: {
    marginBottom: '15px',
  },
  button: {
    padding: '10px 20px',
    fontSize: '16px',
    display: 'flex',
    alignItems: 'center',
  },
};
