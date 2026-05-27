"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Check, Loader2, Lock } from "lucide-react";
import { suggestNumberOfRounds } from "../../utils/tournamentUtils";
import { createClient } from "../../utils/supabase/client";

interface TournamentInfo {
  n_rounds: number | null;
  current_round: number | null;
  round_length: number | null;
  max_score: number | null;
  bye_points: number | null;
  bye_differential: number | null;
  starting_table_number: number | null;
  sound_notifications: boolean | null;
  has_started: boolean | null;
  has_ended: boolean | null;
}

interface TournamentSettingsProps {
  tournamentId: string;
  participantCount: number;
}

type SaveStatus = "idle" | "saving" | "saved" | "error";

export default function TournamentSettings({
  tournamentId,
  participantCount,
}: TournamentSettingsProps) {
  const [tournamentInfo, setTournamentInfo] = useState<TournamentInfo>({
    n_rounds: null,
    current_round: null,
    round_length: null,
    max_score: null,
    bye_points: null,
    bye_differential: null,
    starting_table_number: null,
    sound_notifications: null,
    has_started: null,
    has_ended: null,
  });
  const [round1Started, setRound1Started] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const suggestedRounds = suggestNumberOfRounds(participantCount);

  useEffect(() => {
    const fetchTournamentInfo = async () => {
      if (!tournamentId) return;

      const client = createClient();
      const { data, error } = await client
        .from("tournaments")
        .select(
          "n_rounds, current_round, round_length, max_score, bye_points, bye_differential, starting_table_number, sound_notifications, has_started, has_ended",
        )
        .eq("id", tournamentId)
        .single();

      if (error) {
        console.error("Error fetching tournament info:", error);
        return;
      }

      setTournamentInfo(data);

      const { data: round1 } = await client
        .from("rounds")
        .select("started_at")
        .eq("tournament_id", tournamentId)
        .eq("round_number", 1)
        .maybeSingle();
      setRound1Started(!!round1?.started_at);
    };

    fetchTournamentInfo();
  }, [tournamentId]);

  const flashSaved = useCallback(() => {
    setSaveStatus("saved");
    if (savedTimer.current) clearTimeout(savedTimer.current);
    savedTimer.current = setTimeout(() => setSaveStatus("idle"), 1500);
  }, []);

  const persist = useCallback(
    async (patch: Partial<TournamentInfo>) => {
      const previous = tournamentInfo;
      setTournamentInfo((prev) => ({ ...prev, ...patch }));
      setSaveStatus("saving");
      try {
        const client = createClient();
        const { error } = await client
          .from("tournaments")
          .update(patch)
          .eq("id", tournamentId);
        if (error) throw error;
        flashSaved();
      } catch (err) {
        console.error("Error updating tournament:", err);
        setTournamentInfo(previous);
        setSaveStatus("error");
      }
    },
    [tournamentId, tournamentInfo, flashSaved],
  );

  useEffect(() => {
    return () => {
      if (savedTimer.current) clearTimeout(savedTimer.current);
    };
  }, []);

  const editingDisabled = !!tournamentInfo.has_ended;
  const maxScoreLocked = round1Started || editingDisabled;
  const minRounds = Math.max(1, tournamentInfo.current_round || 1);

  const inputClasses =
    "w-full bg-background border border-border text-foreground rounded-lg p-2.5 focus:outline-none focus:border-primary/60 transition-colors disabled:opacity-60 disabled:cursor-not-allowed";

  return (
    <div className="w-full max-w-[800px] mx-auto">
      <div className="flex items-center justify-between gap-3 mb-6 flex-wrap">
        <h2 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-6 w-6 text-primary"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
            />
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
            />
          </svg>
          Tournament Settings
        </h2>
        <div className="text-xs text-muted-foreground h-5 flex items-center gap-1.5" aria-live="polite">
          {saveStatus === "saving" && (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Saving…
            </>
          )}
          {saveStatus === "saved" && (
            <>
              <Check className="w-3.5 h-3.5 text-primary" />
              Saved
            </>
          )}
          {saveStatus === "error" && (
            <span className="text-destructive">Failed to save</span>
          )}
        </div>
      </div>

      <div className="bg-card jayden-gradient-bg shadow-md dark:shadow-none border border-border rounded-xl overflow-hidden">
        {/* Tournament ID */}
        <div className="px-4 sm:px-6 py-4 border-b border-border bg-muted/30">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">
            Tournament ID
          </p>
          <div className="flex items-center gap-2">
            <p className="text-sm font-mono text-foreground truncate flex-1 min-w-0">
              {tournamentId}
            </p>
            <button
              onClick={() => navigator.clipboard.writeText(tournamentId)}
              className="p-1.5 rounded-md hover:bg-muted transition-colors flex-shrink-0"
              title="Copy tournament ID"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-4 w-4 text-muted-foreground hover:text-primary"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3"
                />
              </svg>
            </button>
          </div>
        </div>

        <div className="p-4 sm:p-6 space-y-6">
          {/* Status row (always read-only) */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div className="rounded-lg bg-muted/40 border border-border p-3">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                Participants
              </p>
              <p className="text-2xl font-semibold text-foreground tabular-nums">
                {participantCount}
              </p>
            </div>
            <div className="rounded-lg bg-muted/40 border border-border p-3">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                Current round
              </p>
              <p className="text-2xl font-semibold text-foreground tabular-nums">
                {tournamentInfo.current_round ?? "—"}
              </p>
            </div>
            <div className="rounded-lg bg-muted/40 border border-border p-3 col-span-2 sm:col-span-1">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                Status
              </p>
              <p className="text-sm font-medium text-foreground mt-1">
                {tournamentInfo.has_ended
                  ? "Ended"
                  : tournamentInfo.has_started
                    ? "In progress"
                    : "Not started"}
              </p>
            </div>
          </div>

          {/* Editable settings */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <label className="block">
              <span className="text-sm font-medium text-foreground mb-1.5 block">
                Number of Rounds
              </span>
              <input
                type="number"
                min={minRounds}
                value={tournamentInfo.n_rounds ?? ""}
                onChange={(e) => {
                  const value = parseInt(e.target.value);
                  if (!Number.isFinite(value)) return;
                  setTournamentInfo((prev) => ({ ...prev, n_rounds: value }));
                }}
                onBlur={(e) => {
                  const value = Math.max(minRounds, parseInt(e.target.value) || minRounds);
                  if (value !== tournamentInfo.n_rounds) {
                    persist({ n_rounds: value });
                  } else {
                    setTournamentInfo((prev) => ({ ...prev, n_rounds: value }));
                  }
                }}
                disabled={editingDisabled}
                className={inputClasses}
              />
              {participantCount > 0 && (
                <p className="text-xs text-muted-foreground mt-1">
                  Suggested for {participantCount} players: {suggestedRounds}
                </p>
              )}
            </label>

            <label className="block">
              <span className="text-sm font-medium text-foreground mb-1.5 block">
                Round Length (minutes)
              </span>
              <input
                type="number"
                min={1}
                max={120}
                value={tournamentInfo.round_length ?? ""}
                onChange={(e) => {
                  const value = parseInt(e.target.value);
                  if (!Number.isFinite(value)) return;
                  setTournamentInfo((prev) => ({ ...prev, round_length: value }));
                }}
                onBlur={(e) => {
                  const value = Math.min(120, Math.max(1, parseInt(e.target.value) || 45));
                  if (value !== tournamentInfo.round_length) {
                    persist({ round_length: value });
                  } else {
                    setTournamentInfo((prev) => ({ ...prev, round_length: value }));
                  }
                }}
                disabled={editingDisabled}
                className={inputClasses}
              />
            </label>

            <label className="block">
              <span className="text-sm font-medium text-foreground mb-1.5 flex items-center gap-1.5">
                Maximum Lost Souls Score
                {maxScoreLocked && !editingDisabled && (
                  <Lock className="w-3.5 h-3.5 text-muted-foreground" aria-label="Locked" />
                )}
              </span>
              <select
                value={tournamentInfo.max_score ?? 5}
                onChange={(e) => persist({ max_score: Number(e.target.value) })}
                disabled={maxScoreLocked}
                className={inputClasses}
              >
                <option value="5">5 Lost Souls</option>
                <option value="7">7 Lost Souls</option>
              </select>
              {maxScoreLocked && !editingDisabled && (
                <p className="text-xs text-muted-foreground mt-1">
                  Locked once round 1 has started
                </p>
              )}
            </label>

            <label className="block">
              <span className="text-sm font-medium text-foreground mb-1.5 block">
                Starting Table Number
              </span>
              <input
                type="number"
                min={1}
                value={tournamentInfo.starting_table_number ?? ""}
                onChange={(e) => {
                  const value = parseInt(e.target.value);
                  if (!Number.isFinite(value)) return;
                  setTournamentInfo((prev) => ({ ...prev, starting_table_number: value }));
                }}
                onBlur={(e) => {
                  const value = Math.max(1, parseInt(e.target.value) || 1);
                  if (value !== tournamentInfo.starting_table_number) {
                    persist({ starting_table_number: value });
                  } else {
                    setTournamentInfo((prev) => ({ ...prev, starting_table_number: value }));
                  }
                }}
                disabled={editingDisabled}
                className={inputClasses}
              />
            </label>

            <label className="block">
              <span className="text-sm font-medium text-foreground mb-1.5 block">
                Match Points for Bye
              </span>
              <select
                value={tournamentInfo.bye_points ?? 3}
                onChange={(e) => persist({ bye_points: Number(e.target.value) })}
                disabled={editingDisabled}
                className={inputClasses}
              >
                <option value="1">1 Point</option>
                <option value="1.5">1.5 Points</option>
                <option value="2">2 Points</option>
                <option value="3">3 Points</option>
              </select>
            </label>

            <label className="block">
              <span className="text-sm font-medium text-foreground mb-1.5 block">
                Differential for Bye
              </span>
              <select
                value={tournamentInfo.bye_differential ?? 0}
                onChange={(e) => persist({ bye_differential: Number(e.target.value) })}
                disabled={editingDisabled}
                className={inputClasses}
              >
                <option value="0">0 (No Differential)</option>
                <option value="1">+1</option>
                <option value="2">+2</option>
                <option value="3">+3</option>
                <option value="4">+4</option>
                <option value="5">+5</option>
              </select>
            </label>
          </div>

          {/* Sound notifications */}
          <label className="flex items-start gap-3 cursor-pointer rounded-lg border border-border bg-background p-3 hover:bg-muted/40 transition-colors">
            <input
              type="checkbox"
              checked={tournamentInfo.sound_notifications ?? false}
              onChange={(e) => persist({ sound_notifications: e.target.checked })}
              className="mt-0.5 h-4 w-4 rounded border-2 border-border text-primary bg-card focus:outline-none focus:ring-0 flex-shrink-0"
            />
            <div className="min-w-0">
              <span className="text-sm font-medium text-foreground">
                Sound notification
              </span>
              <p className="text-xs text-muted-foreground mt-0.5">
                Play a sound when the round timer expires
              </p>
            </div>
          </label>

          {tournamentInfo.has_started && !tournamentInfo.has_ended && (
            <p className="text-xs text-muted-foreground italic">
              Changes apply to future rounds only.
            </p>
          )}
          {editingDisabled && (
            <p className="text-xs text-muted-foreground italic">
              Tournament has ended — settings are locked.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
