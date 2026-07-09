"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogBody } from "@/components/ui/dialog";
import { MobileDrawer } from "@/components/ui/mobile-drawer";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { cn } from "@/lib/utils";
import type { ForgeDeckSummary, SharedForgeDeckSummary } from "@/app/forge/lib/deckTypes";

// The picker only needs these fields; both summary shapes structurally satisfy
// it (shared decks add ownerName, your decks omit it).
type PickerDeck = { id: string; name: string; format: string; cardCount: number; ownerName?: string };

interface Props {
  decks: ForgeDeckSummary[];
  sharedDecks: SharedForgeDeckSummary[];
  selectedDeckId: string | null;
  onSelect: (deckId: string) => void;
}

function summaryLine(d: PickerDeck): string {
  return `${d.format || "Type 1"} · ${d.cardCount} cards${d.ownerName ? ` · ${d.ownerName}` : ""}`;
}

export function ForgeDeckPicker({ decks, sharedDecks, selectedDeckId, onSelect }: Props) {
  const [open, setOpen] = useState(false);
  const isDesktop = useMediaQuery("(min-width: 768px)");

  const selected: PickerDeck | null =
    decks.find((d) => d.id === selectedDeckId) ??
    sharedDecks.find((d) => d.id === selectedDeckId) ??
    null;

  const body = (
    <PickerBody
      decks={decks}
      sharedDecks={sharedDecks}
      selectedDeckId={selectedDeckId}
      onPick={(id) => {
        onSelect(id);
        setOpen(false);
      }}
    />
  );

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center justify-between gap-2 rounded-md border bg-background p-2 text-left text-sm hover:bg-muted/50"
      >
        <span className="min-w-0 flex-1">
          {selected ? (
            <>
              <span className="block truncate font-medium text-foreground">{selected.name}</span>
              <span className="block truncate text-xs text-muted-foreground">{summaryLine(selected)}</span>
            </>
          ) : (
            <span className="text-muted-foreground">Choose a deck…</span>
          )}
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
      </button>

      {isDesktop ? (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent size="md" className="max-h-[85vh] flex flex-col">
            <DialogHeader>
              <DialogTitle>Choose a deck</DialogTitle>
            </DialogHeader>
            <DialogBody className="flex-1 overflow-hidden flex flex-col gap-3 p-4">{body}</DialogBody>
          </DialogContent>
        </Dialog>
      ) : (
        <MobileDrawer isOpen={open} onClose={() => setOpen(false)} title="Choose a deck">
          <div className="flex h-full flex-col gap-3 overflow-hidden px-4 pb-4">{body}</div>
        </MobileDrawer>
      )}
    </>
  );
}

function PickerBody({
  decks,
  sharedDecks,
  selectedDeckId,
  onPick,
}: {
  decks: ForgeDeckSummary[];
  sharedDecks: SharedForgeDeckSummary[];
  selectedDeckId: string | null;
  onPick: (deckId: string) => void;
}) {
  const [search, setSearch] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const lc = search.trim().toLowerCase();
  // Client-side filter over the already-loaded arrays — no server round-trip.
  // This is what makes the picker scale to hundreds of decks.
  const mine = useMemo(
    () =>
      decks.filter(
        (d) => !lc || d.name.toLowerCase().includes(lc) || (d.format || "").toLowerCase().includes(lc),
      ),
    [decks, lc],
  );
  const shared = useMemo(
    () =>
      sharedDecks.filter(
        (d) =>
          !lc ||
          d.name.toLowerCase().includes(lc) ||
          (d.format || "").toLowerCase().includes(lc) ||
          (d.ownerName ?? "").toLowerCase().includes(lc),
      ),
    [sharedDecks, lc],
  );
  const empty = mine.length === 0 && shared.length === 0;

  return (
    <>
      <div className="relative shrink-0">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          ref={inputRef}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search decks…"
          className="pl-8"
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {empty ? (
          <p className="px-2 py-6 text-center text-sm text-muted-foreground">
            {search ? `No decks match “${search}”.` : "No decks available."}
          </p>
        ) : (
          <div className="space-y-3">
            {mine.length > 0 && (
              <PickerGroup title="Your decks" decks={mine} selectedDeckId={selectedDeckId} onPick={onPick} />
            )}
            {shared.length > 0 && (
              <PickerGroup title="Shared by others" decks={shared} selectedDeckId={selectedDeckId} onPick={onPick} />
            )}
          </div>
        )}
      </div>
    </>
  );
}

function PickerGroup({
  title,
  decks,
  selectedDeckId,
  onPick,
}: {
  title: string;
  decks: PickerDeck[];
  selectedDeckId: string | null;
  onPick: (deckId: string) => void;
}) {
  return (
    <div>
      <div className="px-2 py-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</div>
      <ul>
        {decks.map((d) => (
          <li key={d.id}>
            <button
              type="button"
              onClick={() => onPick(d.id)}
              className={cn(
                "flex w-full items-start gap-2 rounded-md px-2 py-2 text-left hover:bg-muted",
                d.id === selectedDeckId && "bg-muted",
              )}
            >
              <Check
                className={cn(
                  "mt-0.5 h-4 w-4 shrink-0",
                  d.id === selectedDeckId ? "text-primary opacity-100" : "opacity-0",
                )}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-foreground">{d.name}</span>
                <span className="block truncate text-xs text-muted-foreground">{summaryLine(d)}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
