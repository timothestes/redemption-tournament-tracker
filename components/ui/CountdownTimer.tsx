import { useEffect, useState } from 'react';

interface CountdownTimerProps {
  startTime: string | null;
  durationMinutes: number;
}

export default function CountdownTimer({ startTime, durationMinutes }: CountdownTimerProps) {
  const [remainingSeconds, setRemainingSeconds] = useState<number>(durationMinutes * 60);

  useEffect(() => {
    // If there's no start time, just show the full duration
    if (!startTime) {
      setRemainingSeconds(durationMinutes * 60);
      return;
    }

    // Calculate initial remaining time
    const startTimeMs = new Date(startTime).getTime();
    const endTimeMs = startTimeMs + (durationMinutes * 60 * 1000);
    const nowMs = new Date().getTime();
    const initialRemainingMs = Math.max(0, endTimeMs - nowMs);
    setRemainingSeconds(Math.floor(initialRemainingMs / 1000));

    // Set up interval
    const intervalId = setInterval(() => {
      const currentMs = new Date().getTime();
      const remainingMs = Math.max(0, endTimeMs - currentMs);
      setRemainingSeconds(Math.floor(remainingMs / 1000));
    }, 1000);

    return () => clearInterval(intervalId);
  }, [startTime, durationMinutes]);

  // Format the time
  const hours = Math.floor(remainingSeconds / 3600);
  const minutes = Math.floor((remainingSeconds % 3600) / 60);
  const seconds = remainingSeconds % 60;

  const timeString = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;

  return (
    <div className="flex flex-col items-center">
      <div className="text-sm text-gray-500 mb-2">Current Round Timer</div>
      <div className="text-4xl font-mono font-bold bg-gray-800 text-white px-6 py-3 rounded-lg shadow-lg">
        {timeString}
      </div>
    </div>
  );
}
