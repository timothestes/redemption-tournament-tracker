"use client";

import { Button, Label, Modal } from "flowbite-react";
import { useState, useEffect } from "react";

interface TournamentStartModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (numberOfRounds: number, roundLength: number, maxScore: number) => void;
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

  useEffect(() => {
    if (isOpen) {
      setNumberOfRounds(suggestedRounds);
      setRoundLength(45);
      setMaxScore(5);
    }
  }, [isOpen, suggestedRounds]);

  const handleIncrement = () => {
    setNumberOfRounds(prev => prev + 1);
  };

  const handleDecrement = () => {
    setNumberOfRounds(prev => Math.max(1, prev - 1));
  };

  return (
    <Modal show={isOpen} onClose={onClose}>
      <Modal.Header>Start Tournament</Modal.Header>
      <Modal.Body>
        <div className="space-y-4">
          <div>
            <p className="text-sm text-white-500">Current Participants: {participantCount}</p>
            <p className="text-sm text-white-500">Suggested Number of Rounds: {suggestedRounds}</p>
          </div>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Number of Rounds</Label>
              <div className="flex items-center space-x-4">
                <Button 
                  size="sm" 
                  onClick={handleDecrement}
                  disabled={numberOfRounds <= 1}
                >
                  -
                </Button>
                <span className="text-lg font-semibold">{numberOfRounds}</span>
                <Button size="sm" onClick={handleIncrement}>+</Button>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Round Length in minutes</Label>
              <input
                type="number"
                value={roundLength}
                onChange={(e) => {
                  const value = Math.min(120, Math.max(0, parseInt(e.target.value) || 0));
                  setRoundLength(value);
                }}
                min="0"
                max="120"
                className="rounded-lg border border-gray-300 bg-gray-50 text-gray-900 focus:border-blue-500 focus:ring-blue-500 block w-24 p-2.5"
              />
            </div>
            <div className="space-y-2">
              <Label>Maximum Lost Souls Score</Label>
              <select
                value={maxScore}
                onChange={(e) => setMaxScore(Number(e.target.value))}
                className="rounded-lg border border-gray-300 bg-gray-50 text-gray-900 focus:border-blue-500 focus:ring-blue-500 block w-24 p-2.5"
              >
                <option value="5">5</option>
                <option value="7">7</option>
              </select>
            </div>
          </div>
        </div>
      </Modal.Body>
      <Modal.Footer>
        <Button onClick={() => onConfirm(numberOfRounds, roundLength, maxScore)} outline gradientDuoTone="greenToBlue">
          Start Tournament
        </Button>
        <Button outline color="red" onClick={onClose}>Cancel</Button>
      </Modal.Footer>
    </Modal>
  );
}
