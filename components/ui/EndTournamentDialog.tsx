"use client";

import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "./button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./dialog";
import { Input } from "./input";

interface EndTournamentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tournamentName: string;
  onConfirm: () => Promise<void> | void;
  isEnding?: boolean;
}

/**
 * Typed-confirmation gate for ending a tournament. The owner explicitly
 * wanted "End Tournament" to require typing the tournament name to defuse
 * accidental clicks on what is otherwise an irreversible host action.
 *
 * We intentionally do NOT modify the shared `ConfirmationDialog` primitive
 * here — that component is wired into ~12 other destructive flows where
 * a typed gate would be overkill, and bending its API just for End
 * Tournament would muddy the contract for everyone else.
 *
 * Match semantics: case-insensitive comparison with both sides trimmed.
 * Paste is allowed. The mismatch error stays hidden until the user has
 * typed at least one character.
 */
export function EndTournamentDialog({
  open,
  onOpenChange,
  tournamentName,
  onConfirm,
  isEnding = false,
}: EndTournamentDialogProps) {
  const [typed, setTyped] = useState("");
  const matches =
    typed.trim().toLowerCase() === tournamentName.trim().toLowerCase();
  // Only nag once the user has actually typed something — don't yell at
  // an empty input.
  const showMismatchError = typed.length > 0 && !matches;

  // Reset the input every time the dialog opens so a previous attempt
  // doesn't pre-fill the confirmation gate.
  useEffect(() => {
    if (open) setTyped("");
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle
              className="size-5 text-destructive"
              aria-hidden="true"
            />
            <span>
              End &quot;{tournamentName}&quot;?
            </span>
          </DialogTitle>
          <DialogDescription>
            This permanently locks all results, freezes standings, and ends
            the tournament for all players. You cannot undo this.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-2">
          <label
            htmlFor="end-tournament-confirm-name"
            className="block text-sm font-medium text-foreground"
          >
            To confirm, type the tournament name:
          </label>
          <Input
            id="end-tournament-confirm-name"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={tournamentName}
            autoFocus
            autoComplete="off"
            disabled={isEnding}
            // Owner feedback: the project's --ring token is the bright
            // accent green, which reads as jarring on form inputs. Override
            // to the same muted foreground ring used on `Button`.
            className="focus-visible:ring-foreground/40 focus-visible:border-foreground/40"
            aria-invalid={showMismatchError || undefined}
            aria-describedby={
              showMismatchError ? "end-tournament-mismatch" : undefined
            }
          />
          {showMismatchError && (
            <p
              id="end-tournament-mismatch"
              className="text-sm text-destructive"
              role="alert"
            >
              That doesn&apos;t match. Type &quot;{tournamentName}&quot; to
              enable End tournament.
            </p>
          )}
        </DialogBody>
        <DialogFooter className="justify-end">
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={isEnding}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={!matches || isEnding}
            onClick={onConfirm}
          >
            {isEnding ? "Ending…" : "End tournament"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default EndTournamentDialog;
