"use client";

import { useEffect, useState, useCallback } from 'react';

interface CountdownTimerProps {
  startTime: string | null;
  durationMinutes: number;
  soundNotifications?: boolean;
  key?: string; // Add key prop
}

export default function CountdownTimer({ startTime, durationMinutes, soundNotifications = false }: CountdownTimerProps) {
  const [remainingSeconds, setRemainingSeconds] = useState<number>(durationMinutes * 60);
  const [soundPlayed, setSoundPlayed] = useState<boolean>(false);

  const playNotificationSound = useCallback(() => {
    if (!soundNotifications || soundPlayed) return;

    try {
      // Play MP3 notification sound
      const audio = new Audio('/notification-alert.mp3');
      audio.volume = 0.5; // Set volume to 50%

      // Ensure we only play once
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
    // Immediately set initial time
    const initialTime = calculateRemainingTime();
    setRemainingSeconds(initialTime);

    // Reset sound played state when timer restarts
    setSoundPlayed(false);

    // Only set up interval if we have a start time
    if (!startTime) {
      return;
    }

    const intervalId = setInterval(() => {
      const currentTime = calculateRemainingTime();
      const previousTime = remainingSeconds;

      setRemainingSeconds(currentTime);

      // Play sound only when timer transitions from 1 to 0 (not when it stays at 0)
      if (previousTime > 0 && currentTime === 0 && !soundPlayed) {
        playNotificationSound();
      }
    }, 1000);

    return () => clearInterval(intervalId);
  }, [startTime, calculateRemainingTime, playNotificationSound]);

  // Format the time
  const hours = Math.floor(remainingSeconds / 3600);
  const minutes = Math.floor((remainingSeconds % 3600) / 60);
  const seconds = remainingSeconds % 60;

  const timeString = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;

  // Color states based on remaining time
  const totalSeconds = durationMinutes * 60;
  const percentRemaining = totalSeconds > 0 ? remainingSeconds / totalSeconds : 0;
  const isExpired = remainingSeconds === 0;
  const isWarning = !isExpired && percentRemaining <= 0.1; // last 10%
  const isUrgent = !isExpired && !isWarning && percentRemaining <= 0.25; // last 25%

  const timerColorClass = isExpired
    ? "text-destructive border-destructive/30 bg-destructive/5"
    : isWarning
      ? "text-red-500 dark:text-red-400 border-red-500/30 bg-red-500/5"
      : isUrgent
        ? "text-amber-500 dark:text-amber-400 border-amber-500/30 bg-amber-500/5"
        : "text-foreground border-border bg-muted/50";

  return (
    <div className="w-full">
      <div className={`flex items-center justify-between rounded-lg border px-5 py-3 ${timerColorClass}`}>
        <span className="text-sm font-medium text-muted-foreground">
          {isExpired ? "Time's Up" : "Round Timer"}
        </span>
        <span className={`text-4xl sm:text-5xl font-mono font-bold tracking-tight tabular-nums ${isExpired ? "text-destructive" : ""}`}>
          {timeString}
        </span>
      </div>
    </div>
  );
}
