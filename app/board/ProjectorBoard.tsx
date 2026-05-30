"use client";

import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { createClient } from "@/utils/supabase/client";
import { fetchActiveBoardData, type BoardTournament } from "./boardData";
import { BoardPanel } from "./BoardPanel";
import { useWakeLock } from "./useWakeLock";

const HIDDEN_KEY = "board:hidden-tournament-ids";

function gridClassFor(count: number): string {
  if (count <= 1) return "grid-cols-1";
  if (count <= 4) return "grid-cols-1 sm:grid-cols-2";
  return "grid-cols-[repeat(auto-fit,minmax(20rem,1fr))]";
}

export function ProjectorBoard() {
  const [tournaments, setTournaments] = useState<BoardTournament[]>([]);
  const [hidden, setHidden] = useState<string[]>([]);
  const [showControls, setShowControls] = useState(false);
  useWakeLock();

  // Restore hidden set from localStorage.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(HIDDEN_KEY);
      if (raw) setHidden(JSON.parse(raw));
    } catch {
      // ignore malformed storage
    }
  }, []);

  const refetch = useCallback(async () => {
    setTournaments(await fetchActiveBoardData());
  }, []);

  // Initial fetch + realtime: refetch the whole active set on any change.
  useEffect(() => {
    refetch();
    const supabase = createClient();
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let cancelled = false;

    (async () => {
      // postgres_changes on RLS-protected tables only delivers rows the socket's
      // JWT can SELECT. Apply the host's token before subscribing — otherwise the
      // connection uses the anon key and every event is filtered out (the channel
      // still reports SUBSCRIBED, so the failure is silent).
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      if (data.session?.access_token) {
        await supabase.realtime.setAuth(data.session.access_token);
        if (cancelled) return;
      }
      channel = supabase
        .channel("projector-board")
        .on("postgres_changes", { event: "*", schema: "public", table: "rounds" }, () => refetch())
        .on("postgres_changes", { event: "*", schema: "public", table: "tournaments" }, () => refetch())
        .subscribe();
    })();

    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
    };
  }, [refetch]);

  const toggleHidden = (id: string) => {
    setHidden((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      try {
        localStorage.setItem(HIDDEN_KEY, JSON.stringify(next));
      } catch {
        // ignore storage write failures
      }
      return next;
    });
  };

  const visible = tournaments.filter((t) => !hidden.includes(t.id));

  return (
    <div className="fixed inset-0 z-50 overflow-hidden bg-neutral-950 p-4 text-neutral-50">
      {visible.length === 0 ? (
        <div className="flex h-full w-full items-center justify-center">
          <p className="font-cinzel text-3xl text-neutral-500 sm:text-4xl">
            No active tournaments
          </p>
        </div>
      ) : (
        <div className={cn("grid h-full w-full auto-rows-fr gap-4", gridClassFor(visible.length))}>
          {visible.map((t) => (
            <BoardPanel key={t.id} tournament={t} />
          ))}
        </div>
      )}

      {/* Hide/show control — unobtrusive, host-facing only. */}
      <div className="absolute right-3 top-3">
        <button
          onClick={() => setShowControls((s) => !s)}
          aria-label="Board settings"
          className="rounded-md bg-neutral-800/70 px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-700"
        >
          &#9881;
        </button>
        {showControls && (
          <div className="mt-1 max-h-[60vh] w-64 overflow-auto rounded-md bg-neutral-900 p-2 text-sm shadow-lg">
            {tournaments.length === 0 ? (
              <p className="p-2 text-neutral-500">No tournaments</p>
            ) : (
              tournaments.map((t) => (
                <label key={t.id} className="flex items-center gap-2 p-1 text-neutral-200">
                  <input
                    type="checkbox"
                    checked={!hidden.includes(t.id)}
                    onChange={() => toggleHidden(t.id)}
                  />
                  <span className="truncate">{t.name}</span>
                </label>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
