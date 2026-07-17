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
  numberingMode: "tables" | "seats";
  seatValue: string;
  setSeatValue: (v: string) => void;
}

const EditParticipantModal: React.FC<EditParticipantModalProps> = ({
  isOpen,
  onClose,
  participant,
  onSave,
  newParticipantName,
  setNewParticipantName,
  numberingMode,
  seatValue,
  setSeatValue,
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
                className="w-full rounded-lg border border-border bg-card text-foreground px-3 py-2 text-sm focus:outline-none"
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="assigned-seat" className="text-sm font-medium text-foreground">
                Static {numberingMode === "seats" ? "seat" : "table"} #{" "}
                <span className="text-muted-foreground font-normal">(optional)</span>
              </label>
              <input
                id="assigned-seat"
                name="assigned-seat"
                type="number"
                min={1}
                step={1}
                value={seatValue}
                onChange={(e) => setSeatValue(e.target.value)}
                placeholder="None"
                className="w-full rounded-lg border border-border bg-card text-foreground px-3 py-2 text-sm focus:outline-none"
              />
              <p className="text-xs text-muted-foreground">
                Always placed at this {numberingMode === "seats" ? "seat" : "table"} when
                pairings are generated. Leave empty for automatic placement.
              </p>
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
