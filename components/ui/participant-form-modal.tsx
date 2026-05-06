import React, { useEffect, useRef, useState } from "react";
import { Button } from "./button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogBody,
  DialogFooter,
} from "./dialog";

interface ParticipantFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (name: string) => void;
  existingNames?: string[];
}

const ParticipantFormModal: React.FC<ParticipantFormModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
  existingNames = [],
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const [duplicateName, setDuplicateName] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
    if (!isOpen) {
      setDuplicateName(null);
    }
  }, [isOpen]);

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const name = formData.get("name")?.toString().trim();
    if (!name) return;

    const normalized = name.toLowerCase();
    const collision = existingNames.find(
      (existing) => existing.trim().toLowerCase() === normalized,
    );
    if (collision) {
      setDuplicateName(name);
      return;
    }
    onSubmit(name);
  };

  const confirmDuplicate = () => {
    if (duplicateName) {
      onSubmit(duplicateName);
      setDuplicateName(null);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold">
            {duplicateName ? "Duplicate name" : "Add Participant"}
          </DialogTitle>
        </DialogHeader>
        {duplicateName ? (
          <>
            <DialogBody>
              <p className="text-sm text-foreground">
                There&apos;s already a participant named{" "}
                <span className="font-semibold">{duplicateName}</span> in this tournament.
                Add another anyway?
              </p>
            </DialogBody>
            <DialogFooter className="justify-end">
              <Button type="button" variant="success" onClick={confirmDuplicate}>
                Add anyway
              </Button>
              <Button
                type="button"
                variant="cancel"
                onClick={() => {
                  setDuplicateName(null);
                  setTimeout(() => inputRef.current?.focus(), 0);
                }}
              >
                Back
              </Button>
            </DialogFooter>
          </>
        ) : (
          <form ref={formRef} onSubmit={handleSubmit}>
            <DialogBody className="space-y-1">
              <label htmlFor="name" className="text-sm font-medium text-foreground">Participant Name</label>
              <input
                id="name"
                name="name"
                type="text"
                required
                ref={inputRef}
                maxLength={35}
                placeholder="Max 35 characters"
                className="w-full rounded-lg border border-border bg-card text-foreground px-3 py-2 text-sm focus:ring-2 focus:ring-ring focus:outline-none"
              />
            </DialogBody>
            <DialogFooter className="justify-end">
              <Button type="submit" variant="success">
                Add
              </Button>
              <Button type="button" variant="cancel" onClick={onClose}>
                Cancel
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default ParticipantFormModal;
