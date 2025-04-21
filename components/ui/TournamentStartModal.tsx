"use client";

import { Button, Label, Modal } from "flowbite-react";
import { useState, useEffect } from "react";

interface TournamentStartModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (numberOfRounds: number, roundLength: number, maxScore: number, byePoints: number, byeDifferential: number) => void;
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
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setNumberOfRounds(suggestedRounds);
      setRoundLength(45);
      setMaxScore(5);
      setByePoints(3);
      setByeDifferential(0);
    }
  }, [isOpen, suggestedRounds]);

  const handleIncrement = () => {
    setNumberOfRounds(prev => prev + 1);
  };

  const handleDecrement = () => {
    setNumberOfRounds(prev => Math.max(1, prev - 1));
  };

  return (
    <Modal show={isOpen} onClose={onClose} size="lg">
      <Modal.Header className="border-b border-gray-600 bg-gray-800">
        <span className="text-xl font-semibold text-white">Start Tournament</span>
      </Modal.Header>
      <Modal.Body className="bg-gray-800 space-y-6 p-6">
        {/* Tournament Settings Section */}
        <div className="bg-gray-700/50 rounded-lg p-4 border border-gray-600">
          <h4 className="text-lg font-medium text-white mb-4">Tournament Settings</h4>
          
          <div className="grid gap-6">
            {/* Number of Rounds */}
            <div className="flex flex-col items-center">
              <div className="text-center mb-2">
                <Label className="text-sm font-medium text-gray-300">
                  Number of Rounds
                </Label>
                <div className="flex items-center gap-2 text-sm text-gray-400 mt-1 justify-center">
                  <span>{participantCount} participants</span>
                  <span>•</span>
                  <span>Suggested: {suggestedRounds}</span>
                </div>
              </div>
              <div className="flex items-center space-x-4">
                <Button 
                  size="sm" 
                  onClick={handleDecrement}
                  disabled={numberOfRounds <= 1}
                  className="bg-gray-700 hover:bg-gray-600 w-10 h-10 p-0 flex items-center justify-center"
                >
                  <span className="text-lg">−</span>
                </Button>
                <span className="text-xl font-semibold text-white min-w-[3ch] text-center bg-gray-900/50 py-1.5 px-3 rounded">
                  {numberOfRounds}
                </span>
                <Button 
                  size="sm" 
                  onClick={handleIncrement}
                  className="bg-gray-700 hover:bg-gray-600 w-10 h-10 p-0 flex items-center justify-center"
                >
                  <span className="text-lg">+</span>
                </Button>
              </div>
            </div>

            {/* Round Length */}
            <div className="flex flex-col items-center">
              <Label className="text-sm font-medium text-gray-300 mb-2">
                Round Length (minutes)
              </Label>
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
                  className="w-24 bg-gray-900/50 border border-gray-600 text-white rounded-lg focus:ring-blue-500 focus:border-blue-500 p-2.5 text-center"
                  placeholder="Minutes"
                />
                <span className="text-sm text-gray-400">max 120</span>
              </div>
            </div>

            {/* Advanced Settings Section */}
            <div className="border-t border-gray-600 pt-4">
              <button
                onClick={() => setIsAdvancedOpen(!isAdvancedOpen)}
                className="flex items-center gap-2 text-sm text-gray-300 hover:text-white transition-colors"
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
                  <Label className="text-sm font-medium text-gray-300 mb-2">
                    Maximum Lost Souls Score
                  </Label>
                  <select
                    value={maxScore}
                    onChange={(e) => setMaxScore(Number(e.target.value))}
                    className="w-full bg-gray-900/50 border border-gray-600 text-white rounded-lg focus:ring-blue-500 focus:border-blue-500 p-2.5"
                  >
                    <option value="5">5 Lost Souls</option>
                    <option value="7">7 Lost Souls</option>
                  </select>
                </div>

                {/* Bye Points */}
                <div>
                  <Label className="text-sm font-medium text-gray-300 mb-2">
                    Match Points for Bye
                  </Label>
                  <select
                    value={byePoints}
                    onChange={(e) => setByePoints(Number(e.target.value))}
                    className="w-full bg-gray-900/50 border border-gray-600 text-white rounded-lg focus:ring-blue-500 focus:border-blue-500 p-2.5"
                  >
                    <option value="1">1 Point</option>
                    <option value="1.5">1.5 Points</option>
                    <option value="2">2 Points</option>
                    <option value="3">3 Points</option>
                  </select>
                </div>

                {/* Bye Differential */}
                <div>
                  <Label className="text-sm font-medium text-gray-300 mb-2">
                    Differential for Bye
                  </Label>
                  <select
                    value={byeDifferential}
                    onChange={(e) => setByeDifferential(Number(e.target.value))}
                    className="w-full bg-gray-900/50 border border-gray-600 text-white rounded-lg focus:ring-blue-500 focus:border-blue-500 p-2.5"
                  >
                    <option value="0">0 (No Differential)</option>
                    <option value="1">+1</option>
                    <option value="2">+2</option>
                    <option value="3">+3</option>
                    <option value="4">+4</option>
                    <option value="5">+5</option>
                  </select>
                </div>
              </div>
            </div>
          </div>
        </div>
      </Modal.Body>
      
      <Modal.Footer className="border-t border-gray-600 bg-gray-800">
        <div className="flex justify-end gap-3 w-full">
          <Button
            onClick={() => onConfirm(numberOfRounds, roundLength, maxScore, byePoints, byeDifferential)}
            gradientDuoTone="greenToBlue"
            className="px-6"
          >
            Start Tournament
          </Button>
          <Button 
            color="gray"
            onClick={onClose}
            className="px-6"
          >
            Cancel
          </Button>
        </div>
      </Modal.Footer>
    </Modal>
  );
}
