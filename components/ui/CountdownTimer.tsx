"use client";

import { useEffect, useRef, useState } from "react";
import { useRoundCountdown } from "./useRoundCountdown";

interface CountdownTimerProps {
  startTime: string | null;
  durationMinutes: number;
  soundNotifications?: boolean;
}

export default function CountdownTimer({
  startTime,
  durationMinutes,
  soundNotifications = false,
}: CountdownTimerProps) {
  const { remainingSeconds, timeString, isExpired, isWarning, isUrgent } =
    useRoundCountdown(startTime, durationMinutes);
  const [soundPlayed, setSoundPlayed] = useState(false);
  const prevRemainingRef = useRef(remainingSeconds);

  // Reset the once-per-round sound guard whenever a new round starts.
  useEffect(() => {
    setSoundPlayed(false);
  }, [startTime]);

  // Play the alert once, only on the live transition from >0 to 0 (not on mount
  // while already expired) — matches the original CountdownTimer behavior.
  useEffect(() => {
    const prev = prevRemainingRef.current;
    prevRemainingRef.current = remainingSeconds;
    if (!soundNotifications || soundPlayed || !startTime) return;
    if (!(prev > 0 && remainingSeconds === 0)) return;
    setSoundPlayed(true);
    try {
      const audio = new Audio("/notification-alert.mp3");
      audio.volume = 0.5;
      audio.play().catch((error) => {
        console.warn("Could not play notification sound:", error);
      });
    } catch (error) {
      console.warn("Could not play notification sound:", error);
    }
  }, [remainingSeconds, startTime, soundNotifications, soundPlayed]);

  const sizeClass =
    isExpired || isWarning
      ? "text-3xl sm:text-4xl font-bold"
      : "text-xl sm:text-2xl font-semibold";
  const colorClass =
    isExpired || isWarning
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
      {timeString}
    </span>
  );
}
