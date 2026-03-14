"use client";

import { useState, useEffect } from "react";
import { Button } from "./button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogBody,
  DialogFooter,
} from "./dialog";

interface TournamentStartModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (numberOfRounds: number, roundLength: number, maxScore: number, byePoints: number, byeDifferential: number, startingTableNumber: number, soundNotifications: boolean) => void;
  participantCount: number;
  suggestedRounds: number;
}

export default function TournamentStartModal({
  isOpen,
  onClose,
  onConfirm,
  participantCount,
  suggestedRounds,
}: TournamentStartModalProps) {
  const [numberOfRounds, setNumberOfRounds] = useState(suggestedRounds);
  const [roundLength, setRoundLength] = useState(45);
  const [maxScore, setMaxScore] = useState(5);
  const [byePoints, setByePoints] = useState(3);
  const [byeDifferential, setByeDifferential] = useState(0);
  const [startingTableNumber, setStartingTableNumber] = useState(1);
  const [soundNotifications, setSoundNotifications] = useState(false);
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setNumberOfRounds(suggestedRounds);
      setRoundLength(45);
      setMaxScore(5);
      setByePoints(3);
      setByeDifferential(0);
      setStartingTableNumber(1);
      setSoundNotifications(false);
    }
  }, [isOpen, suggestedRounds]);

  const handleIncrement = () => {
    setNumberOfRounds(prev => prev + 1);
  };

  const handleDecrement = () => {
    setNumberOfRounds(prev => Math.max(1, prev - 1));
  };

  const inputClasses = "w-full bg-white dark:bg-gray-900/50 border border-gray-300 dark:border-gray-600 text-foreground rounded-lg focus:ring-blue-500 focus:border-blue-500 p-2.5";

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent size="lg" className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl">Start Tournament</DialogTitle>
        </DialogHeader>

        <DialogBody className="bg-gray-50 dark:bg-gray-800 space-y-6">
          <div className="bg-white/90 dark:bg-gray-700/50 border border-gray-200 dark:border-gray-600 rounded-lg p-4">
            <h4 className="text-lg font-medium text-foreground mb-4">Tournament Settings</h4>

            <div className="grid gap-6">
              {/* Number of Rounds */}
              <div className="flex flex-col items-center">
                <div className="text-center mb-2">
                  <label className="text-sm font-medium text-muted-foreground">
                    Number of Rounds
                  </label>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground mt-1 justify-center">
                    <span>{participantCount} participants</span>
                    <span>&bull;</span>
                    <span>Suggested: {suggestedRounds}</span>
                  </div>
                </div>
                <div className="flex items-center space-x-4">
                  <button
                    onClick={handleDecrement}
                    disabled={numberOfRounds <= 1}
                    className="bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 w-10 h-10 rounded-md flex items-center justify-center text-foreground disabled:opacity-50"
                  >
                    <span className="text-lg">&minus;</span>
                  </button>
                  <span className="text-xl font-semibold text-foreground bg-gray-100 dark:bg-gray-900/50 min-w-[3ch] text-center py-1.5 px-3 rounded">
                    {numberOfRounds}
                  </span>
                  <button
                    onClick={handleIncrement}
                    className="bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 w-10 h-10 rounded-md flex items-center justify-center text-foreground"
                  >
                    <span className="text-lg">+</span>
                  </button>
                </div>
              </div>

              {/* Round Length */}
              <div className="flex flex-col items-center">
                <label className="text-sm font-medium text-muted-foreground mb-2">
                  Round Length (minutes)
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    value={roundLength}
                    onChange={(e) => {
                      const value = Math.min(120, Math.max(0, parseInt(e.target.value) || 0));
                      setRoundLength(value);
                    }}
                    min="0"
                    max="120"
                    className="w-24 bg-white dark:bg-gray-900/50 border border-gray-300 dark:border-gray-600 text-foreground rounded-lg focus:ring-blue-500 focus:border-blue-500 p-2.5 text-center"
                    placeholder="Minutes"
                  />
                  <span className="text-sm text-muted-foreground">max 120</span>
                </div>
              </div>

              {/* Advanced Settings Section */}
              <div className="border-t border-gray-200 dark:border-gray-600 pt-4">
                <button
                  onClick={() => setIsAdvancedOpen(!isAdvancedOpen)}
                  className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  <svg
                    className={`w-4 h-4 transition-transform ${isAdvancedOpen ? 'rotate-90' : ''}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      d="M9 5l7 7-7 7"
                    />
                  </svg>
                  Advanced Settings
                </button>

                <div className={`space-y-4 mt-4 ${isAdvancedOpen ? '' : 'hidden'}`}>
                  {/* Maximum Score */}
                  <div>
                    <label className="text-sm font-medium text-muted-foreground mb-2 block">
                      Maximum Lost Souls Score
                    </label>
                    <select
                      value={maxScore}
                      onChange={(e) => setMaxScore(Number(e.target.value))}
                      className={inputClasses}
                    >
                      <option value="5">5 Lost Souls</option>
                      <option value="7">7 Lost Souls</option>
                    </select>
                  </div>

                  {/* Bye Points */}
                  <div>
                    <label className="text-sm font-medium text-muted-foreground mb-2 block">
                      Match Points for Bye
                    </label>
                    <select
                      value={byePoints}
                      onChange={(e) => setByePoints(Number(e.target.value))}
                      className={inputClasses}
                    >
                      <option value="1">1 Point</option>
                      <option value="1.5">1.5 Points</option>
                      <option value="2">2 Points</option>
                      <option value="3">3 Points</option>
                    </select>
                  </div>

                  {/* Bye Differential */}
                  <div>
                    <label className="text-sm font-medium text-muted-foreground mb-2 block">
                      Differential for Bye
                    </label>
                    <select
                      value={byeDifferential}
                      onChange={(e) => setByeDifferential(Number(e.target.value))}
                      className={inputClasses}
                    >
                      <option value="0">0 (No Differential)</option>
                      <option value="1">+1</option>
                      <option value="2">+2</option>
                      <option value="3">+3</option>
                      <option value="4">+4</option>
                      <option value="5">+5</option>
                    </select>
                  </div>

                  {/* Starting Table Number */}
                  <div>
                    <label className="text-sm font-medium text-muted-foreground mb-2 block">
                      Starting Table Number
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        value={startingTableNumber}
                        onChange={(e) => {
                          const value = Math.max(1, parseInt(e.target.value) || 1);
                          setStartingTableNumber(value);
                        }}
                        min="1"
                        className="w-24 bg-white dark:bg-gray-900/50 border border-gray-300 dark:border-gray-600 text-foreground rounded-lg focus:ring-blue-500 focus:border-blue-500 p-2.5 text-center"
                        placeholder="Table #"
                      />
                      <span className="text-sm text-muted-foreground">
                        Tables will be numbered starting from this value
                      </span>
                    </div>
                  </div>

                  {/* Sound Notifications */}
                  <div>
                    <label className="text-sm font-medium text-muted-foreground mb-2 block">
                      Sound Notifications
                    </label>
                    <label className="flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={soundNotifications}
                        onChange={(e) => setSoundNotifications(e.target.checked)}
                        className="mr-3 h-4 w-4 rounded border-2 border-gray-300 dark:border-gray-600 text-blue-600 dark:text-blue-500 dark:bg-gray-800 focus:outline-none focus:ring-0"
                      />
                      <div>
                        <span className="text-sm text-foreground">
                          Play sound when timer expires
                        </span>
                        <p className="text-xs text-muted-foreground">
                          A notification sound will play when each round timer reaches zero
                        </p>
                      </div>
                    </label>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </DialogBody>

        <DialogFooter className="bg-gray-50 dark:bg-gray-800 justify-end">
          <Button
            onClick={() => onConfirm(numberOfRounds, roundLength, maxScore, byePoints, byeDifferential, startingTableNumber, soundNotifications)}
            variant="success"
          >
            Start Tournament
          </Button>
          <Button variant="cancel" onClick={onClose}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
