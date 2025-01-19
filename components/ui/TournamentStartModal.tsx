"use client";

import { Button, Label, Modal } from "flowbite-react";
import { useState } from "react";

interface TournamentStartModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
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
            <p className="text-sm text-gray-500">Current Participants: {participantCount}</p>
            <p className="text-sm text-gray-500">Suggested Number of Rounds: {suggestedRounds}</p>
          </div>
          <div className="space-y-2">
            <Label>Number of Rounds</Label>
            <div className="flex items-center space-x-4">
              <Button size="sm" onClick={handleDecrement}>-</Button>
              <span className="text-lg font-semibold">{numberOfRounds}</span>
              <Button size="sm" onClick={handleIncrement}>+</Button>
            </div>
          </div>
        </div>
      </Modal.Body>
      <Modal.Footer>
        <Button onClick={onConfirm} outline gradientDuoTone="greenToBlue">Start Tournament</Button>
        <Button color="gray" onClick={onClose}>Cancel</Button>
      </Modal.Footer>
    </Modal>
  );
}
