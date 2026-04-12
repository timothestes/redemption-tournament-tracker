"use client";

import { useState, useEffect } from "react";
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
}

interface TournamentSettingsProps {
  tournamentId: string;
  participantCount: number;
}

export default function TournamentSettings({
  tournamentId,
  participantCount,
}: TournamentSettingsProps) {
  const [enabled, setEnabled] = useState(false);
  const [tournamentInfo, setTournamentInfo] = useState<TournamentInfo>({
    n_rounds: null,
    current_round: null,
    round_length: null,
    max_score: null,
    bye_points: null,
    bye_differential: null,
    starting_table_number: null,
    sound_notifications: null,
  });

  const suggestedRounds = suggestNumberOfRounds(participantCount);

  useEffect(() => {
    const fetchTournamentInfo = async () => {
      if (!tournamentId) return;

      const client = createClient();
      const { data, error } = await client
        .from("tournaments")
        .select("n_rounds, current_round, round_length, max_score, bye_points, bye_differential, starting_table_number, sound_notifications")
        .eq("id", tournamentId)
        .single();

      if (error) {
        console.error("Error fetching tournament info:", error);
        return;
      }

      setTournamentInfo(data);
    };

    fetchTournamentInfo();
  }, [tournamentId]);

  return (
    <div className="w-[800px] max-xl:w-full mx-auto overflow-x-auto">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          Tournament Settings
        </h2>
      </div>

      <div className="bg-card shadow-md dark:shadow-none border border-border rounded-xl overflow-hidden">
        {/* Tournament ID section with special styling */}
        <div className="px-6 py-4 border-b border-border bg-muted/50">
          <div className="flex items-center">
            <div className="mr-3 p-2 rounded-full bg-primary/15">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
              </svg>
            </div>
            <div className="flex-1">
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Tournament ID</p>
              <div className="flex items-center gap-2">
                <p className="text-sm font-mono text-foreground">{tournamentId}</p>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(tournamentId);
                  }}
                  className="p-1 rounded-md hover:bg-muted transition-colors"
                  title="Copy tournament ID to clipboard"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-muted-foreground hover:text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Main settings content with grid layout */}
        <div className="p-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Tournament Status Section */}
            <div className="p-4 rounded-lg bg-muted/50">
              <h3 className="text-sm font-semibold uppercase tracking-wider mb-4 text-muted-foreground">Tournament Status</h3>
              <div className="space-y-3">
                <div className="flex items-center">
                  <div className="w-8 h-8 rounded-full flex items-center justify-center mr-3 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                    </svg>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Current Participants</p>
                    <p className="text-lg font-semibold text-foreground">{participantCount}</p>
                  </div>
                </div>

                {typeof tournamentInfo.round_length === "number" && (
                  <div className="flex items-center">
                    <div className="w-8 h-8 rounded-full flex items-center justify-center mr-3 bg-primary/15 text-primary">
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Round Length</p>
                      <p className="text-lg font-semibold text-foreground">{tournamentInfo.round_length} minutes</p>
                    </div>
                  </div>
                )}

                {typeof tournamentInfo.n_rounds === "number" && (
                  <div className="flex items-center">
                    <div className="w-8 h-8 rounded-full flex items-center justify-center mr-3 bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400">
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2 1 3 3 3h10c2 0 3-1 3-3V7c0-2-1-3-3-3H7c-2 0-3 1-3 3z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h8M12 16V8" />
                      </svg>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Total Rounds</p>
                      <p className="text-lg font-semibold text-foreground">{tournamentInfo.n_rounds}</p>
                    </div>
                  </div>
                )}

                {typeof tournamentInfo.current_round === "number" && (
                  <p className="text-sm text-muted-foreground">
                    Current Round: <span className="text-foreground">{tournamentInfo.current_round}</span>
                  </p>
                )}
                {typeof tournamentInfo.max_score === "number" && (
                  <p className="text-sm text-muted-foreground">
                    Maximum Lost Souls Score: <span className="text-foreground">{tournamentInfo.max_score}</span>
                  </p>
                )}
                {typeof tournamentInfo.bye_points === "number" && (
                  <p className="text-sm text-muted-foreground">
                    Match Points for Bye: <span className="text-foreground">{tournamentInfo.bye_points}</span>
                  </p>
                )}
                {typeof tournamentInfo.bye_differential === "number" && (
                  <p className="text-sm text-muted-foreground">
                    Differential for Bye: <span className="text-foreground">+{tournamentInfo.bye_differential}</span>
                  </p>
                )}
                {typeof tournamentInfo.starting_table_number === "number" && (
                  <p className="text-sm text-muted-foreground">
                    Starting Table Number: <span className="text-foreground">{tournamentInfo.starting_table_number}</span>
                  </p>
                )}
                {participantCount > 0 &&
                  (!tournamentInfo.n_rounds || tournamentInfo.n_rounds === 0) && (
                    <p className="text-sm text-muted-foreground">
                      Suggested Number of Rounds: <span className="text-foreground">{suggestedRounds}</span>
                    </p>
                  )}
              </div>
            </div>

            {/* Advanced Settings Section */}
            <div className="p-4 rounded-lg bg-muted/50">
              <h3 className="text-sm font-semibold uppercase tracking-wider mb-4 text-muted-foreground">Advanced Settings</h3>
              <div className="space-y-4">
                <div className="flex items-center">
                  <div className="w-8 h-8 rounded-full flex items-center justify-center mr-3 bg-orange-100 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5L6 9H2v6h4l5 4V5zM19.07 4.93a10 10 0 010 14.14M15.54 8.46a5 5 0 010 7.08" />
                    </svg>
                  </div>
                  <div className="flex-1">
                    <label className="flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={tournamentInfo.sound_notifications ?? false}
                        onChange={async (e) => {
                          const newValue = e.target.checked;

                          // Update local state immediately for responsive UI
                          setTournamentInfo(prev => ({
                            ...prev,
                            sound_notifications: newValue
                          }));

                          // Update database
                          try {
                            const client = createClient();
                            const { error } = await client
                              .from("tournaments")
                              .update({ sound_notifications: newValue })
                              .eq("id", tournamentId);

                            if (error) {
                              console.error("Error updating sound notifications:", error);
                              // Revert local state on error
                              setTournamentInfo(prev => ({
                                ...prev,
                                sound_notifications: !newValue
                              }));
                            }
                          } catch (error) {
                            console.error("Error updating sound notifications:", error);
                            // Revert local state on error
                            setTournamentInfo(prev => ({
                              ...prev,
                              sound_notifications: !newValue
                            }));
                          }
                        }}
                        className="mr-3 h-4 w-4 rounded border-2 border-input text-primary focus:outline-none focus:ring-0"
                      />
                      <div>
                        <p className="text-sm font-medium text-foreground">
                          Sound Notification
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Play a sound when the round timer expires
                        </p>
                      </div>
                    </label>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
