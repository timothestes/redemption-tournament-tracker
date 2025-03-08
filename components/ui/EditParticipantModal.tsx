import React, { useEffect, useRef } from "react";
import { Button, Label, TextInput } from "flowbite-react";

interface EditParticipantModalProps {
  isOpen: boolean;
  onClose: () => void;
  participant: any;
  onSave: () => void;
  newParticipantName: string;
  setNewParticipantName: (name: string) => void;
  newMatchPoints: string;
  setNewMatchPoints: (points: string) => void;
  newDifferential: string;
  setNewDifferential: (differential: string) => void;
  newDroppedOut: boolean;
  setNewDroppedOut: (droppedOut: boolean) => void;
  isTournamentStarted: boolean;
}

const EditParticipantModal: React.FC<EditParticipantModalProps> = ({
  isOpen,
  onClose,
  participant,
  onSave,
  newParticipantName,
  setNewParticipantName,
  newMatchPoints,
  setNewMatchPoints,
  newDifferential,
  setNewDifferential,
  isTournamentStarted
}) => {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  if (!isOpen || !participant) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-60">
      <div className="bg-[#1F2937] border-2 border-zinc-300/10 py-6 px-6 rounded-lg shadow-lg max-w-sm w-full">
        <h2 className="text-xl font-bold mb-4">Edit Participant</h2>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSave();
          }}
          className="flex flex-col gap-4"
        >
          <div className="mb-2 block space-y-1">
            <Label htmlFor="name" value="Participant Name" />
            <TextInput
              id="name"
              name="name"
              type="text"
              value={newParticipantName}
              onChange={(e) => setNewParticipantName(e.target.value)}
              required
              ref={inputRef}
            />
          </div>
          <div className="mb-2 block space-y-1">
            <Label htmlFor="match_points" value="Match Points" />
            <TextInput
              id="match_points"
              name="match_points"
              type="number"
              value={newMatchPoints}
              onChange={(e) => setNewMatchPoints(e.target.value)}
              disabled={!isTournamentStarted}
            />
          </div>
          <div className="mb-2 block space-y-1">
            <Label htmlFor="differential" value="Differential" />
            <TextInput
              id="differential"
              name="differential"
              type="number"
              value={newDifferential}
              onChange={(e) => setNewDifferential(e.target.value)}
              disabled={!isTournamentStarted}
            />
          </div>
          <div className="flex justify-end gap-3">
            <Button type="submit" outline gradientDuoTone="greenToBlue">
              Save
            </Button>
            <Button type="button" outline color="red" onClick={onClose}>
              Cancel
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default EditParticipantModal;
