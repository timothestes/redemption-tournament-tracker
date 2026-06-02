"use client";

import { useEffect, useState } from "react";

interface RoundProgressBarProps {
  startTime: string | null;
  durationMinutes: number;
}

// Thin ambient indicator pinned to the top edge of the round-active sticky
// header. Gives at-a-glance "how much time is left" without forcing the player
// to read the digits — they fill in the precision.
export default function RoundProgressBar({ startTime, durationMinutes }: RoundProgressBarProps) {
  const [remainingSeconds, setRemainingSeconds] = useState<number>(durationMinutes * 60);

  useEffect(() => {
    if (!startTime) return;

    const tick = () => {
      const startMs = new Date(startTime).getTime();
      const endMs = startMs + durationMinutes * 60 * 1000;
      const remaining = Math.max(0, Math.floor((endMs - Date.now()) / 1000));
      setRemainingSeconds(remaining);
    };

    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [startTime, durationMinutes]);

  const total = durationMinutes * 60;
  const percent = total > 0 ? Math.max(0, Math.min(1, remainingSeconds / total)) : 0;
  const isExpired = remainingSeconds === 0;
  const isWarning = !isExpired && percent <= 0.1;
  const isUrgent = !isExpired && !isWarning && percent <= 0.25;

  const fillClass = isExpired || isWarning
    ? "bg-destructive"
    : isUrgent
      ? "bg-amber-500"
      : "bg-foreground/40";

  return (
    <div
      className="absolute top-0 left-0 right-0 h-1 bg-muted/40 overflow-hidden"
      aria-hidden="true"
    >
      <div
        className={`h-full transition-[width] duration-1000 ease-linear ${fillClass}`}
        style={{ width: `${percent * 100}%` }}
      />
    </div>
  );
}
