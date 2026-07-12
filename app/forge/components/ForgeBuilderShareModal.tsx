"use client";

import { useEffect, useState } from "react";
import ForgeShareDeckModal from "@/app/forge/components/ForgeShareDeckModal";
import { getForgeDeckShared, setForgeDeckShared } from "@/app/forge/lib/forgeDecks";

/**
 * Hosts ForgeShareDeckModal for the deck builder, which doesn't track
 * is_shared: fetches the current state when the modal opens and owns the
 * server action on change. (The deck list page passes both from its
 * server-rendered summaries instead.)
 */
export default function ForgeBuilderShareModal({
  open,
  onOpenChange,
  deckId,
  deckName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  deckId: string;
  deckName?: string;
}) {
  const [isShared, setIsShared] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    getForgeDeckShared(deckId).then((shared) => {
      if (!cancelled) setIsShared(shared);
    });
    return () => {
      cancelled = true;
    };
  }, [open, deckId]);

  return (
    <ForgeShareDeckModal
      open={open}
      onOpenChange={onOpenChange}
      deckId={deckId}
      deckName={deckName}
      isShared={isShared}
      onSetShared={async (shared) => {
        const res = await setForgeDeckShared(deckId, shared);
        if (res.ok) setIsShared(shared);
      }}
    />
  );
}
