"use client";

import ConfirmationDialog from "@/components/ui/confirmation-dialog";

interface DeleteDeckModalProps {
  deckName: string;
  onConfirm: () => void;
  onClose: () => void;
}

export default function DeleteDeckModal({ deckName, onConfirm, onClose }: DeleteDeckModalProps) {
  return (
    <ConfirmationDialog
      open={true}
      onOpenChange={(open) => { if (!open) onClose(); }}
      onConfirm={onConfirm}
      variant="destructive"
      title="Delete Deck"
      description="This action cannot be undone"
      confirmLabel="Delete Deck"
      cancelLabel="Cancel"
      icon={
        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
        </svg>
      }
    >
      <p className="text-foreground mb-2">
        Are you sure you want to delete this deck?
      </p>
      <div className="bg-muted rounded-lg px-4 py-3 mt-3">
        <p className="text-sm text-muted-foreground mb-1">Deck name:</p>
        <p className="font-semibold text-foreground break-words">
          {deckName}
        </p>
      </div>
      <p className="text-sm text-muted-foreground mt-3">
        All cards and deck data will be permanently deleted.
      </p>
    </ConfirmationDialog>
  );
}
