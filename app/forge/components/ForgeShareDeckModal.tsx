"use client";

import { useState } from "react";
import { Lock, Users, Check, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogBody,
  DialogFooter,
} from "@/components/ui/dialog";

/**
 * Forge counterpart of the public ShareDeckModal, reduced to the two states
 * that exist here: Private, or Shared with every Forge member. The share link
 * is the auth-gated read-only view page.
 */
export default function ForgeShareDeckModal({
  open,
  onOpenChange,
  deckId,
  deckName,
  isShared,
  onSetShared,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  deckId: string;
  deckName?: string;
  /** Current share state (controlled by the parent). */
  isShared: boolean;
  /** Apply a new share state; the parent owns the server action + refresh. */
  onSetShared: (shared: boolean) => void | Promise<void>;
}) {
  const [pending, setPending] = useState<boolean | null>(null);
  const [copied, setCopied] = useState(false);

  const shareUrl =
    typeof window !== "undefined" ? `${window.location.origin}/forge/play/decks/${deckId}/view` : "";

  async function select(next: boolean) {
    if (next === isShared) return;
    setPending(next);
    try {
      await onSetShared(next);
      // Sharing mints a link — drop it straight onto the clipboard.
      if (next) copyLink();
    } finally {
      setPending(null);
    }
  }

  function copyLink() {
    navigator.clipboard
      .writeText(shareUrl)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => {});
  }

  const options = [
    { shared: false, label: "Private", description: "Only you can see this deck.", icon: <Lock className="h-5 w-5" /> },
    { shared: true, label: "Shared with the Forge", description: "Every playtester and elder can view it and open the link.", icon: <Users className="h-5 w-5" /> },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Share deck</DialogTitle>
          <DialogDescription>
            {deckName ? `Choose who can see "${deckName}".` : "Choose who can see this deck."}
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="space-y-2">
          {options.map((opt) => {
            const active = isShared === opt.shared;
            const loading = pending === opt.shared;
            return (
              <button
                key={opt.label}
                onClick={() => select(opt.shared)}
                disabled={pending !== null}
                aria-pressed={active}
                className={`w-full flex items-start gap-3 rounded-lg border p-3 text-left transition-colors disabled:opacity-60 ${
                  active ? "border-primary bg-primary/5" : "border-border hover:bg-muted"
                }`}
              >
                <span className={`mt-0.5 ${active ? "text-primary" : "text-muted-foreground"}`}>{opt.icon}</span>
                <span className="flex-1 min-w-0">
                  <span className="block font-medium text-foreground">{opt.label}</span>
                  <span className="block text-xs text-muted-foreground">{opt.description}</span>
                </span>
                {loading ? (
                  <Loader2 className="h-5 w-5 animate-spin text-primary" />
                ) : active ? (
                  <Check className="h-5 w-5 text-primary" />
                ) : null}
              </button>
            );
          })}

          {isShared ? (
            <div className="pt-2">
              <label className="block text-xs font-medium text-muted-foreground mb-1">Share link</label>
              <div className="flex gap-2">
                <input
                  readOnly
                  value={shareUrl}
                  onFocus={(e) => e.currentTarget.select()}
                  className="flex-1 min-w-0 rounded-md border border-border bg-muted px-3 py-2 text-sm text-foreground"
                />
                <button
                  onClick={copyLink}
                  className="flex-shrink-0 rounded-md bg-green-700 px-4 py-2 text-sm font-medium text-white hover:bg-green-800 transition-colors"
                >
                  {copied ? "Copied!" : "Copy"}
                </button>
              </div>
              <p className="mt-1.5 text-xs text-muted-foreground">
                {copied ? "Link copied to your clipboard." : "Only Forge members can open this link."}
              </p>
            </div>
          ) : (
            <p className="pt-2 text-sm text-muted-foreground">
              This deck is private. Share it with the Forge to get a link.
            </p>
          )}
        </DialogBody>

        <DialogFooter className="justify-end">
          <button
            onClick={() => onOpenChange(false)}
            className="rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted transition-colors"
          >
            Done
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
