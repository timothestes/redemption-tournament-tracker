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

interface ParticipantFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (name: string) => void;
}

const ParticipantFormModal: React.FC<ParticipantFormModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const name = formData.get("name")?.toString();
    if (name) {
      onSubmit(name);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold">Add Participant</DialogTitle>
        </DialogHeader>
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
              className="w-full rounded-lg border border-gray-300 dark:border-zinc-600 bg-gray-50 dark:bg-zinc-800 text-foreground px-3 py-2 text-sm focus:ring-2 focus:ring-ring focus:outline-none"
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
      </DialogContent>
    </Dialog>
  );
};

export default ParticipantFormModal;
