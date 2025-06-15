"use client";

import { Card } from "flowbite-react";
import { useState, useEffect } from "react";
import { suggestNumberOfRounds } from "../../utils/tournamentUtils";
import { createClient } from "../../utils/supabase/client";
import { useTheme } from "next-themes";

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

  // Use theme for styling
  const { theme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  
  useEffect(() => {
    setMounted(true);
  }, []);
  
  // Don't render theme-specific styling until client-side to avoid hydration mismatch
  const currentTheme = mounted ? (theme === 'system' ? resolvedTheme : theme) : 'dark';
  const isLightTheme = currentTheme === 'light';

  return (
    <div className="w-[800px] max-xl:w-full mx-auto overflow-x-auto">
      <div className="flex justify-between items-center mb-6">
        <h2 className={`text-2xl font-bold ${isLightTheme ? 'text-gray-800' : 'text-white'} flex items-center gap-2`}>
          <svg xmlns="http://www.w3.org/2000/svg" className={`h-6 w-6 ${isLightTheme ? 'text-blue-600' : 'text-blue-400'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          Tournament Settings
        </h2>
      </div>

      <Card className={`${isLightTheme ? 'bg-white shadow-md' : 'bg-gray-800 border-gray-700'} rounded-xl overflow-hidden`}>
        {/* Tournament ID section with special styling */}
        <div className={`px-6 py-4 border-b ${isLightTheme ? 'border-gray-100 bg-gray-50' : 'border-gray-700 bg-gray-700/30'}`}>
          <div className="flex items-center">
            <div className={`mr-3 p-2 rounded-full ${isLightTheme ? 'bg-blue-100' : 'bg-blue-900/30'}`}>
              <svg xmlns="http://www.w3.org/2000/svg" className={`h-5 w-5 ${isLightTheme ? 'text-blue-600' : 'text-blue-400'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
              </svg>
            </div>
            <div className="flex-1">
              <p className={`text-xs font-medium uppercase tracking-wider ${isLightTheme ? 'text-gray-500' : 'text-gray-400'}`}>Tournament ID</p>
              <div className="flex items-center gap-2">
                <p className={`text-sm font-mono ${isLightTheme ? 'text-gray-800' : 'text-zinc-300'}`}>{tournamentId}</p>
                <button 
                  onClick={() => {
                    navigator.clipboard.writeText(tournamentId);
                    // Optional: Add toast notification here
                  }}
                  className={`p-1 rounded-md hover:bg-opacity-20 ${isLightTheme ? 'hover:bg-gray-200' : 'hover:bg-gray-700'} transition-colors`}
                  title="Copy tournament ID to clipboard"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className={`h-4 w-4 ${isLightTheme ? 'text-gray-500 hover:text-blue-600' : 'text-gray-400 hover:text-blue-400'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
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
            <div className={`p-4 rounded-lg ${isLightTheme ? 'bg-gray-50' : 'bg-gray-700/20'}`}>
              <h3 className={`text-sm font-semibold uppercase tracking-wider mb-4 ${isLightTheme ? 'text-gray-600' : 'text-gray-300'}`}>Tournament Status</h3>
              <div className="space-y-3">
                <div className="flex items-center">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center mr-3 ${isLightTheme ? 'bg-emerald-100 text-emerald-600' : 'bg-emerald-900/30 text-emerald-400'}`}>
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                    </svg>
                  </div>
                  <div>
                    <p className={`text-xs ${isLightTheme ? 'text-gray-500' : 'text-gray-400'}`}>Current Participants</p>
                    <p className={`text-lg font-semibold ${isLightTheme ? 'text-gray-800' : 'text-zinc-200'}`}>{participantCount}</p>
                  </div>
                </div>
                
                {typeof tournamentInfo.round_length === "number" && (
                  <div className="flex items-center">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center mr-3 ${isLightTheme ? 'bg-blue-100 text-blue-600' : 'bg-blue-900/30 text-blue-400'}`}>
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    </div>
                    <div>
                      <p className={`text-xs ${isLightTheme ? 'text-gray-500' : 'text-gray-400'}`}>Round Length</p>
                      <p className={`text-lg font-semibold ${isLightTheme ? 'text-gray-800' : 'text-zinc-200'}`}>{tournamentInfo.round_length} minutes</p>
                    </div>
                  </div>
                )}
                
                {typeof tournamentInfo.n_rounds === "number" && (
                  <div className="flex items-center">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center mr-3 ${isLightTheme ? 'bg-purple-100 text-purple-600' : 'bg-purple-900/30 text-purple-400'}`}>
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2 1 3 3 3h10c2 0 3-1 3-3V7c0-2-1-3-3-3H7c-2 0-3 1-3 3z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h8M12 16V8" />
                      </svg>
                    </div>
                    <div>
                      <p className={`text-xs ${isLightTheme ? 'text-gray-500' : 'text-gray-400'}`}>Total Rounds</p>
                      <p className={`text-lg font-semibold ${isLightTheme ? 'text-gray-800' : 'text-zinc-200'}`}>{tournamentInfo.n_rounds}</p>
                    </div>
                  </div>
                )}
                
                {typeof tournamentInfo.current_round === "number" && (
                  <p className={`text-sm ${isLightTheme ? 'text-gray-600' : 'text-gray-400'}`}>
                    Current Round: <span className={isLightTheme ? 'text-gray-800' : 'text-zinc-300'}>{tournamentInfo.current_round}</span>
                  </p>
                )}
                {typeof tournamentInfo.max_score === "number" && (
                  <p className={`text-sm ${isLightTheme ? 'text-gray-600' : 'text-gray-400'}`}>
                    Maximum Lost Souls Score: <span className={isLightTheme ? 'text-gray-800' : 'text-zinc-300'}>{tournamentInfo.max_score}</span>
                  </p>
                )}
                {typeof tournamentInfo.bye_points === "number" && (
                  <p className={`text-sm ${isLightTheme ? 'text-gray-600' : 'text-gray-400'}`}>
                    Match Points for Bye: <span className={isLightTheme ? 'text-gray-800' : 'text-zinc-300'}>{tournamentInfo.bye_points}</span>
                  </p>
                )}
                {typeof tournamentInfo.bye_differential === "number" && (
                  <p className={`text-sm ${isLightTheme ? 'text-gray-600' : 'text-gray-400'}`}>
                    Differential for Bye: <span className={isLightTheme ? 'text-gray-800' : 'text-zinc-300'}>+{tournamentInfo.bye_differential}</span>
                  </p>
                )}
                {typeof tournamentInfo.starting_table_number === "number" && (
                  <p className={`text-sm ${isLightTheme ? 'text-gray-600' : 'text-gray-400'}`}>
                    Starting Table Number: <span className={isLightTheme ? 'text-gray-800' : 'text-zinc-300'}>{tournamentInfo.starting_table_number}</span>
                  </p>
                )}
                {participantCount > 0 &&
                  (!tournamentInfo.n_rounds || tournamentInfo.n_rounds === 0) && (
                    <p className={`text-sm ${isLightTheme ? 'text-gray-600' : 'text-gray-400'}`}>
                      Suggested Number of Rounds: <span className={isLightTheme ? 'text-gray-800' : 'text-zinc-300'}>{suggestedRounds}</span>
                    </p>
                  )}
              </div>
            </div>

            {/* Advanced Settings Section */}
            <div className={`p-4 rounded-lg ${isLightTheme ? 'bg-gray-50' : 'bg-gray-700/20'}`}>
              <h3 className={`text-sm font-semibold uppercase tracking-wider mb-4 ${isLightTheme ? 'text-gray-600' : 'text-gray-300'}`}>Advanced Settings</h3>
              <div className="space-y-4">
                <div className="flex items-center">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center mr-3 ${isLightTheme ? 'bg-orange-100 text-orange-600' : 'bg-orange-900/30 text-orange-400'}`}>
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5L6 9H2v6h4l5 4V5zM19.07 4.93a10 10 0 010 14.14M15.54 8.46a5 5 0 010 7.08" />
                    </svg>
                  </div>
                  <div className="flex-1">
                    <label className={`flex items-center cursor-pointer`}>
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
                        className={`mr-3 h-4 w-4 rounded border-2 ${isLightTheme ? 'border-gray-300 text-blue-600 focus:ring-blue-500' : 'border-gray-600 text-blue-500 bg-gray-800 focus:ring-blue-400'} focus:ring-2 focus:ring-offset-0`}
                      />
                      <div>
                        <p className={`text-sm font-medium ${isLightTheme ? 'text-gray-800' : 'text-zinc-200'}`}>
                          Sound Notification
                        </p>
                        <p className={`text-xs ${isLightTheme ? 'text-gray-500' : 'text-gray-400'}`}>
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
      </Card>
    </div>
  );
}
