"use client";

import { useEffect, useState } from "react";
import {
  getRemainingSeconds,
  formatRemaining,
  getUrgency,
  type Urgency,
} from "@/lib/tournament/roundTimer";

export interface RoundCountdown extends Urgency {
  remainingSeconds: number;
  timeString: string;
}

/** Ticks every second off `startTime` + `durationMinutes`. Pure of audio/theme. */
export function useRoundCountdown(
  startTime: string | null,
  durationMinutes: number,
): RoundCountdown {
  const [remainingSeconds, setRemainingSeconds] = useState<number>(() =>
    getRemainingSeconds(startTime, durationMinutes, new Date().getTime()),
  );

  useEffect(() => {
    setRemainingSeconds(
      getRemainingSeconds(startTime, durationMinutes, new Date().getTime()),
    );
    if (!startTime) return;
    const id = setInterval(() => {
      setRemainingSeconds(
        getRemainingSeconds(startTime, durationMinutes, new Date().getTime()),
      );
    }, 1000);
    return () => clearInterval(id);
  }, [startTime, durationMinutes]);

  return {
    remainingSeconds,
    timeString: formatRemaining(remainingSeconds),
    ...getUrgency(remainingSeconds, durationMinutes),
  };
}
