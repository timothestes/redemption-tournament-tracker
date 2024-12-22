import React, { useEffect, useRef } from "react";
import { Button, Label, TextInput, Checkbox } from "flowbite-react";

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
  newDroppedOut,
  setNewDroppedOut,
}) => {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  if (!isOpen || !participant) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-30">
      <div className="bg-background p-4 rounded shadow-lg max-w-sm w-full">
        <h2 className="text-xl font-bold mb-4">Edit Participant</h2>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSave();
          }}
          className="flex flex-col gap-4"
        >
          <div className="mb-2 block">
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
          <div className="mb-2 block">
            <Label htmlFor="match_points" value="Match Points" />
            <TextInput
              id="match_points"
              name="match_points"
              type="number"
              value={newMatchPoints}
              onChange={(e) => setNewMatchPoints(e.target.value)}
              required
            />
          </div>
          <div className="mb-2 block">
            <Label htmlFor="differential" value="Differential" />
            <TextInput
              id="differential"
              name="differential"
              type="number"
              value={newDifferential}
              onChange={(e) => setNewDifferential(e.target.value)}
              required
            />
          </div>
          <div className="mb-2 block">
            <Label htmlFor="dropped_out" value="Dropped Out" />
            <Checkbox
              id="dropped_out"
              name="dropped_out"
              checked={newDroppedOut}
              onChange={(e) => setNewDroppedOut(e.target.checked)}
            />
          </div>
          <div className="flex justify-end gap-3">
            <Button type="button" outline color="red" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" outline gradientDuoTone="greenToBlue">
              Save
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default EditParticipantModal;
