import { useEffect, useState } from 'react';

interface CountdownTimerProps {
  startTime: string;
  durationMinutes: number;
}

export default function CountdownTimer({ startTime, durationMinutes }: CountdownTimerProps) {
  const [timeLeft, setTimeLeft] = useState<string>('');

  useEffect(() => {
    const calculateTimeLeft = () => {
      if (!startTime) {
        // If no start time, show the full duration
        const hours = Math.floor(durationMinutes / 60);
        const minutes = durationMinutes % 60;
        return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:00`;
      }

      const start = new Date(startTime).getTime();
      const end = start + (durationMinutes * 60 * 1000);
      const now = new Date().getTime();
      const difference = end - now;

      if (difference <= 0) {
        return '00:00:00';
      }

      const hours = Math.floor(difference / (1000 * 60 * 60));
      const minutes = Math.floor((difference % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((difference % (1000 * 60)) / 1000);

      return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    };

    const timer = startTime ? setInterval(() => {
      setTimeLeft(calculateTimeLeft());
    }, 1000) : null;

    setTimeLeft(calculateTimeLeft());

    return () => {
      if (timer) clearInterval(timer);
    };
  }, [startTime, durationMinutes]);

  return (
    <div className="flex flex-col items-center">
      <div className="text-sm text-gray-500 mb-2">Current Round Timer</div>
      <div className="text-4xl font-mono font-bold bg-gray-800 text-white px-6 py-3 rounded-lg shadow-lg">
        {timeLeft}
      </div>
    </div>
  );
}
