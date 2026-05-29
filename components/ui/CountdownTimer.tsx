"use client";

import { useEffect, useState, useCallback } from 'react';

interface CountdownTimerProps {
  startTime: string | null;
  durationMinutes: number;
  soundNotifications?: boolean;
  key?: string;
}

export default function CountdownTimer({ startTime, durationMinutes, soundNotifications = false }: CountdownTimerProps) {
  const [remainingSeconds, setRemainingSeconds] = useState<number>(durationMinutes * 60);
  const [soundPlayed, setSoundPlayed] = useState<boolean>(false);

  const playNotificationSound = useCallback(() => {
    if (!soundNotifications || soundPlayed) return;

    try {
      const audio = new Audio('/notification-alert.mp3');
      audio.volume = 0.5;

      audio.addEventListener('loadstart', () => {
        setSoundPlayed(true);
      });

      audio.play().catch((error) => {
        console.warn('Could not play notification sound:', error);
      });

    } catch (error) {
      console.warn('Could not play notification sound:', error);
    }
  }, [soundNotifications, soundPlayed]);

  const calculateRemainingTime = useCallback(() => {
    if (!startTime) {
      return durationMinutes * 60;
    }

    const startTimeMs = new Date(startTime).getTime();
    const endTimeMs = startTimeMs + (durationMinutes * 60 * 1000);
    const nowMs = new Date().getTime();
    const remainingMs = Math.max(0, endTimeMs - nowMs);
    return Math.floor(remainingMs / 1000);
  }, [startTime, durationMinutes]);

  useEffect(() => {
    const initialTime = calculateRemainingTime();
    setRemainingSeconds(initialTime);
    setSoundPlayed(false);

    if (!startTime) {
      return;
    }

    const intervalId = setInterval(() => {
      const currentTime = calculateRemainingTime();
      const previousTime = remainingSeconds;

      setRemainingSeconds(currentTime);

      if (previousTime > 0 && currentTime === 0 && !soundPlayed) {
        playNotificationSound();
      }
    }, 1000);

    return () => clearInterval(intervalId);
  }, [startTime, calculateRemainingTime, playNotificationSound]);

  const hours = Math.floor(remainingSeconds / 3600);
  const minutes = Math.floor((remainingSeconds % 3600) / 60);
  const seconds = remainingSeconds % 60;

  const timeString = hours > 0
    ? `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
    : `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;

  const totalSeconds = durationMinutes * 60;
  const percentRemaining = totalSeconds > 0 ? remainingSeconds / totalSeconds : 0;
  const isExpired = remainingSeconds === 0;
  const isWarning = !isExpired && percentRemaining <= 0.1; // last 10%
  const isUrgent = !isExpired && !isWarning && percentRemaining <= 0.25; // last 25%

  // Resting: confident foreground digits, no pill, no icon — typography (mono +
  // tabular) carries the "this is data" signal. Color escalates with urgency;
  // size only escalates when seconds genuinely matter, so the loud state isn't
  // wasted as the resting baseline.
  const sizeClass = isExpired || isWarning
    ? "text-3xl sm:text-4xl font-bold"
    : "text-xl sm:text-2xl font-semibold";
  const colorClass = isExpired || isWarning
    ? "text-destructive animate-pulse"
    : isUrgent
      ? "text-amber-600 dark:text-amber-400"
      : "text-foreground";

  return (
    <span
      className={`font-mono tabular-nums leading-none whitespace-nowrap ${sizeClass} ${colorClass}`}
      aria-label={isExpired ? "Time's up" : `Round timer: ${timeString} remaining`}
      role="status"
    >
      {isExpired ? "Time's up" : timeString}
    </span>
  );
}
