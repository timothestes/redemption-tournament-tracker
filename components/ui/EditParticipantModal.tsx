import React, { useEffect, useRef } from "react";
import { Button } from "./button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogBody,
  DialogFooter,
} from "./dialog";

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

  if (!participant) return null;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold">Edit Participant</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSave();
          }}
        >
          <DialogBody className="space-y-4">
            <div className="space-y-1">
              <label htmlFor="name" className="text-sm font-medium text-foreground">Participant Name</label>
              <input
                id="name"
                name="name"
                type="text"
                value={newParticipantName}
                onChange={(e) => setNewParticipantName(e.target.value)}
                required
                ref={inputRef}
                className="w-full rounded-lg border border-border bg-card text-foreground px-3 py-2 text-sm focus:ring-2 focus:ring-ring focus:outline-none"
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="match_points" className="text-sm font-medium text-foreground">Match Points</label>
              <input
                id="match_points"
                name="match_points"
                type="number"
                value={newMatchPoints}
                onChange={(e) => setNewMatchPoints(e.target.value)}
                disabled={!isTournamentStarted}
                className="w-full rounded-lg border border-border bg-card text-foreground px-3 py-2 text-sm focus:ring-2 focus:ring-ring focus:outline-none disabled:opacity-50"
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="differential" className="text-sm font-medium text-foreground">Differential</label>
              <input
                id="differential"
                name="differential"
                type="number"
                value={newDifferential}
                onChange={(e) => setNewDifferential(e.target.value)}
                disabled={!isTournamentStarted}
                className="w-full rounded-lg border border-border bg-card text-foreground px-3 py-2 text-sm focus:ring-2 focus:ring-ring focus:outline-none disabled:opacity-50"
              />
            </div>
          </DialogBody>
          <DialogFooter className="justify-end">
            <Button type="submit" variant="success">
              Save
            </Button>
            <Button type="button" variant="cancel" onClick={onClose}>
              Cancel
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default EditParticipantModal;
