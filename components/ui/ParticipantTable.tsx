import React, { useMemo, useState } from "react";
import { Table } from "flowbite-react";
import { HiPencil, HiTrash } from "react-icons/hi";
import { BookOpen, CircleMinus, CirclePlus, Crown, Link2Off } from "lucide-react";
import AttachDeckDialog from "./AttachDeckDialog";
import type { TournamentDecklistRow, DeckSearchResult } from "../../app/tracker/tournaments/actions";
import { attachDeckToParticipantAction, detachDeckFromParticipantAction } from "../../app/tracker/tournaments/actions";
import ConfirmationDialog from "./confirmation-dialog";

interface Participant {
  id: string;
  name: string;
  match_points: number;
  differential: number;
  dropped_out: boolean;
}

interface ParticipantTableProps {
  tournamentStarted: boolean;
  participants: Participant[];
  onEdit: (participant: Participant) => void;
  onDelete: (id: string) => void;
  onDropOut: (id: string) => void;
  onDropIn: (id: string) => void;
  tournamentEnded?: boolean;
  tournamentId: string;
  decklists: TournamentDecklistRow[];
  onDecklistsChange: () => void;
}

const ParticipantTable: React.FC<ParticipantTableProps> = ({
  tournamentStarted,
  participants,
  onEdit,
  onDelete,
  onDropOut,
  onDropIn,
  tournamentEnded = false,
  tournamentId,
  decklists,
  onDecklistsChange,
}) => {
  const [attachDialogOpen, setAttachDialogOpen] = useState(false);
  const [attachTarget, setAttachTarget] = useState<Participant | null>(null);
  const [dropTarget, setDropTarget] = useState<Participant | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Participant | null>(null);

  const decklistMap = useMemo(() => {
    const map = new Map<string, TournamentDecklistRow>();
    for (const dl of decklists) {
      map.set(dl.participant_id, dl);
    }
    return map;
  }, [decklists]);

  // Participants tab is a roster view — sort alphabetically so hosts can find
  // players by name. Score-based ranking lives in the Standings tab.
  const sortedParticipants = useMemo(() =>
    [...participants].sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
    ),
    [participants]
  );

  // Winner crown still highlights the final-standings leader; compute it from
  // raw match_points/differential regardless of the alphabetical display order.
  const { winnerMatchPoints, winnerDifferential } = useMemo(() => {
    const ranked = [...participants].sort((a, b) => {
      const mpA = a.match_points !== null ? a.match_points : -Infinity;
      const mpB = b.match_points !== null ? b.match_points : -Infinity;
      if (mpA !== mpB) return mpB - mpA;
      const diffA = a.differential !== null ? a.differential : -Infinity;
      const diffB = b.differential !== null ? b.differential : -Infinity;
      return diffB - diffA;
    });
    return {
      winnerMatchPoints: ranked[0]?.match_points ?? 0,
      winnerDifferential: ranked[0]?.differential ?? 0,
    };
  }, [participants]);

  async function handleAttachDeck(deck: DeckSearchResult) {
    if (!attachTarget) return;
    const result = await attachDeckToParticipantAction(tournamentId, attachTarget.id, deck.id);
    if (result.success) {
      onDecklistsChange();
    }
  }

  async function handleDetachDeck(participantId: string) {
    const result = await detachDeckFromParticipantAction(participantId);
    if (result.success) {
      onDecklistsChange();
    }
  }

  function renderActionButtons(participant: Participant) {
    return (
      <div className="flex items-center gap-1">
        <button
          onClick={() => onEdit(participant)}
          className="p-2 rounded-md text-muted-foreground hover:text-primary hover:bg-primary/10 touch-manipulation transition-colors"
          aria-label={`Edit ${participant.name}`}
        >
          <HiPencil className="w-5 h-5" />
        </button>
        {tournamentStarted ? (
          participant.dropped_out ? (
            <button
              onClick={() => onDropIn(participant.id)}
              className="p-2 rounded-md text-muted-foreground hover:text-primary hover:bg-primary/10 touch-manipulation transition-colors"
              aria-label={`Restore ${participant.name}`}
              title="Restore participant"
            >
              <CirclePlus className="w-5 h-5" />
            </button>
          ) : (
            <button
              onClick={() => setDropTarget(participant)}
              className="p-2 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 touch-manipulation transition-colors"
              aria-label={`Drop ${participant.name}`}
              title="Drop from tournament"
            >
              <CircleMinus className="w-5 h-5" />
            </button>
          )
        ) : (
          <button
            onClick={() => setDeleteTarget(participant)}
            className="p-2 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 touch-manipulation transition-colors"
            aria-label={`Delete ${participant.name}`}
            title="Remove participant"
          >
            <HiTrash className="w-5 h-5" />
          </button>
        )}
      </div>
    );
  }

  function renderDeckCell(participant: Participant) {
    const linkedDeck = decklistMap.get(participant.id);
    if (linkedDeck) {
      return (
        <div className="flex items-center gap-2 min-w-0">
          <a
            href={`/decklist/${linkedDeck.deck_id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-primary hover:underline truncate"
            title={linkedDeck.deck_name}
          >
            {linkedDeck.deck_name}
          </a>
          <span className="text-xs text-muted-foreground tabular-nums flex-shrink-0">
            {linkedDeck.deck_card_count}c
          </span>
          <button
            onClick={() => handleDetachDeck(participant.id)}
            className="p-1 -m-0.5 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors flex-shrink-0"
            title="Remove deck"
            aria-label={`Remove deck from ${participant.name}`}
          >
            <Link2Off className="w-3.5 h-3.5" />
          </button>
        </div>
      );
    }
    return (
      <button
        onClick={() => {
          setAttachTarget(participant);
          setAttachDialogOpen(true);
        }}
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary transition-colors group"
      >
        <BookOpen className="w-3.5 h-3.5" />
        <span className="group-hover:underline">Attach deck</span>
      </button>
    );
  }

  return (
    <>
      {/* Mobile card list */}
      <ul className="md:hidden space-y-2">
        {sortedParticipants.map((participant) => {
          const isWinner =
            participant.match_points === winnerMatchPoints &&
            participant.differential === winnerDifferential;
          return (
            <li
              key={participant.id}
              className={`rounded-lg border border-border bg-card p-3 ${
                isWinner && tournamentEnded ? "ring-1 ring-yellow-500/40 bg-yellow-500/5" : ""
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 min-w-0 flex-wrap">
                    {isWinner && tournamentEnded && (
                      <Crown className="w-4 h-4 text-orange-300 flex-shrink-0" />
                    )}
                    <span className="font-medium text-foreground truncate">
                      {participant.name}
                    </span>
                    {participant.dropped_out && (
                      <span className="text-destructive text-[11px] flex-shrink-0 uppercase tracking-wide">
                        Dropped
                      </span>
                    )}
                  </div>
                  <div className="mt-2">{renderDeckCell(participant)}</div>
                </div>
                <div className="flex-shrink-0">{renderActionButtons(participant)}</div>
              </div>
            </li>
          );
        })}
      </ul>

      {/* Desktop table */}
      <div className="hidden md:block">
        <Table
          hoverable
          theme={{
            root: {
              base: "w-full text-left text-sm text-muted-foreground",
              shadow: "absolute left-0 top-0 -z-10 h-full w-full rounded-lg bg-card drop-shadow-md",
              wrapper: "relative",
            },
            head: {
              base: "group/head text-xs uppercase text-muted-foreground",
              cell: {
                base: "bg-muted px-6 py-3 group-first/head:first:rounded-tl-lg group-first/head:last:rounded-tr-lg",
              },
            },
            row: {
              base: "group/row",
              hovered: "hover:bg-muted/50",
            },
          }}
        >
          <Table.Head>
            <Table.HeadCell className="py-3">Name</Table.HeadCell>
            <Table.HeadCell className="py-3">Deck</Table.HeadCell>
            <Table.HeadCell className="py-3">
              <span className="sr-only">Actions</span>
            </Table.HeadCell>
          </Table.Head>
          <Table.Body>
            {sortedParticipants.map((participant) => {
              const isWinner =
                participant.match_points === winnerMatchPoints &&
                participant.differential === winnerDifferential;

              return (
                <Table.Row
                  key={participant.id}
                  className={`${isWinner && tournamentEnded ? "bg-yellow-500/5 dark:bg-yellow-500/10 border-yellow-500/20" : ""} `}
                >
                  <Table.Cell className="font-medium text-foreground py-3">
                    <div className="flex items-center gap-2 min-w-0 flex-wrap">
                      {isWinner && tournamentEnded && (
                        <Crown className="w-4 h-4 text-orange-300 flex-shrink-0" />
                      )}
                      <span className="truncate">{participant.name}</span>
                      {participant.dropped_out && (
                        <span className="text-destructive text-[11px] flex-shrink-0 uppercase tracking-wide">Dropped</span>
                      )}
                    </div>
                  </Table.Cell>

                  <Table.Cell className="py-3">
                    <div className="max-w-[200px]">{renderDeckCell(participant)}</div>
                  </Table.Cell>

                  <Table.Cell className="py-3">{renderActionButtons(participant)}</Table.Cell>
                </Table.Row>
              );
            })}
          </Table.Body>
        </Table>
      </div>

      <AttachDeckDialog
        open={attachDialogOpen}
        onOpenChange={setAttachDialogOpen}
        participantName={attachTarget?.name || ""}
        onSelect={handleAttachDeck}
      />

      <ConfirmationDialog
        open={dropTarget !== null}
        onOpenChange={(open) => { if (!open) setDropTarget(null); }}
        onConfirm={() => {
          if (dropTarget) onDropOut(dropTarget.id);
        }}
        variant="warning"
        title={dropTarget ? `Drop ${dropTarget.name}?` : ""}
        description="They will not appear in next round's pairings. You can restore them later from this list."
        confirmLabel="Drop player"
        cancelLabel="Cancel"
      />

      <ConfirmationDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
        onConfirm={() => {
          if (deleteTarget) onDelete(deleteTarget.id);
        }}
        variant="destructive"
        title={deleteTarget ? `Delete ${deleteTarget.name}?` : ""}
        description="This permanently removes them from the tournament."
        confirmLabel="Delete"
        cancelLabel="Cancel"
      />
    </>
  );
};

export default ParticipantTable;
