"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogBody,
} from "./dialog";
import { Button } from "./button";
import { normalizeJoinCode } from "../../lib/tournament/joinCodeShared";

interface JoinCodeDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

// Code-entry counterpart to the /join landing page for players already in the
// app: same input, same normalization, and the same /join/<code> flow handles
// everything past this point (bad codes, name pre-fill, decklist requirement).
export default function JoinCodeDialog({ isOpen, onClose }: JoinCodeDialogProps) {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [error, setError] = useState(false);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const code = normalizeJoinCode(value);
    if (code === null) {
      setError(true);
      return;
    }
    router.push(`/join/${code}`);
  }

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) {
          setValue("");
          setError(false);
          onClose();
        }
      }}
    >
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Join a tournament</DialogTitle>
          <DialogDescription>Enter the code your host gave you.</DialogDescription>
        </DialogHeader>
        <DialogBody className="pb-6">
          <form onSubmit={handleSubmit}>
            <label className="block text-sm font-medium text-foreground">
              Join code
              <input
                value={value}
                onChange={(e) => {
                  setValue(e.target.value.toUpperCase());
                  setError(false);
                }}
                autoFocus
                inputMode="text"
                autoCapitalize="characters"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                maxLength={12}
                placeholder="T7K2QF"
                className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-center text-lg uppercase tracking-[0.3em] text-foreground"
              />
            </label>
            {error && (
              <p className="mt-2 text-sm text-destructive">
                That doesn&apos;t look like a valid code. Double-check and try
                again.
              </p>
            )}
            <Button type="submit" className="mt-4 w-full">
              Continue
            </Button>
          </form>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
