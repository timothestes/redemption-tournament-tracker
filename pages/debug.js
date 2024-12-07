import { useState } from 'react';
import { useRouter } from 'next/router';

export default function Debug() {
  const [aboutResponse, setAboutResponse] = useState('');
  const router = useRouter();

  const handlePingAbout = async () => {
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
    }
  };

  return (
    <div>
      <header>
        <button onClick={() => router.push('/')}>Home</button>
      </header>
      <h1>Debug Page</h1>
      <button onClick={handlePingAbout}>Ping About Endpoint</button>
      {aboutResponse && <p>{aboutResponse}</p>}
    </div>
  );
}
