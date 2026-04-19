"use client";

import ConfirmationDialog from "@/components/ui/confirmation-dialog";

interface ClearDeckModalProps {
  deckName: string;
  onConfirm: () => void;
  onClose: () => void;
}

export default function ClearDeckModal({ deckName, onConfirm, onClose }: ClearDeckModalProps) {
  return (
    <ConfirmationDialog
      open={true}
      onOpenChange={(open) => { if (!open) onClose(); }}
      onConfirm={onConfirm}
      variant="warning"
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
      <p className="text-muted-foreground mb-2">
        Are you sure you want to delete:
      </p>
      <p className="text-lg font-semibold text-foreground bg-muted px-3 py-2 rounded border border-border">
        {deckName}
      </p>
      <p className="text-sm text-muted-foreground mt-3">
        This will permanently delete the deck.
      </p>
    </ConfirmationDialog>
  );
}
