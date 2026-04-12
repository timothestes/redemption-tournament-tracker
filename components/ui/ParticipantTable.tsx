import React, { useMemo, useState } from "react";
import { Table } from "flowbite-react";
import { HiPencil, HiTrash } from "react-icons/hi";
import { BookOpen, CircleMinus, CirclePlus, Crown, Link2Off } from "lucide-react";
import AttachDeckDialog from "./AttachDeckDialog";
import type { TournamentDecklistRow, DeckSearchResult } from "../../app/tracker/tournaments/actions";
import { attachDeckToParticipantAction, detachDeckFromParticipantAction } from "../../app/tracker/tournaments/actions";

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

  const decklistMap = useMemo(() => {
    const map = new Map<string, TournamentDecklistRow>();
    for (const dl of decklists) {
      map.set(dl.participant_id, dl);
    }
    return map;
  }, [decklists]);

  const sortedParticipants = useMemo(() =>
    [...participants].sort((a, b) => {
      const mpA = a.match_points !== null ? a.match_points : -Infinity;
      const mpB = b.match_points !== null ? b.match_points : -Infinity;

      if (mpA !== mpB) {
        return mpB - mpA;
      }

      const diffA = a.differential !== null ? a.differential : -Infinity;
      const diffB = b.differential !== null ? b.differential : -Infinity;
      return diffB - diffA;
    }),
    [participants]
  );

  const winnerMatchPoints = sortedParticipants[0]?.match_points || 0;
  const winnerDifferential = sortedParticipants[0]?.differential || 0;

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

  return (
    <>
      <Table hoverable>
        <Table.Head>
          <Table.HeadCell className="py-3">Name</Table.HeadCell>
          <Table.HeadCell className="py-3">Deck</Table.HeadCell>
          <Table.HeadCell className="py-3">Match Points</Table.HeadCell>
          <Table.HeadCell className="py-3">Differential</Table.HeadCell>
          <Table.HeadCell className="py-3">
            <span className="sr-only">Actions</span>
          </Table.HeadCell>
        </Table.Head>
        <Table.Body>
          {sortedParticipants.map((participant) => {
            const isWinner = participant.match_points === winnerMatchPoints && participant.differential === winnerDifferential;
            const linkedDeck = decklistMap.get(participant.id);

            return (
              <Table.Row
                key={participant.id}
                className={`${isWinner && tournamentEnded ? "dark:border-yellow-700 dark:bg-yellow-500/50" : ""} `}
              >
                <Table.Cell className="font-medium text-foreground py-3">
                  <div className="flex items-center gap-2 min-w-0">
                    {isWinner && tournamentEnded && <Crown className="w-4 h-4 text-orange-300 flex-shrink-0" />}
                    <span className="truncate">{participant.name}</span>
                    {participant.dropped_out && <span className="text-red-500 text-[12px] flex-shrink-0">( Dropped )</span>}
                  </div>
                </Table.Cell>

                {/* Deck column */}
                <Table.Cell className="py-3">
                  {linkedDeck ? (
                    <div className="flex items-center gap-2 min-w-0">
                      <a
                        href={`/decklist/${linkedDeck.deck_id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm text-primary hover:underline truncate max-w-[160px]"
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
                  ) : (
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
                  )}
                </Table.Cell>

                <Table.Cell className="py-3 tabular-nums">{participant.match_points ?? 0}</Table.Cell>
                <Table.Cell className="py-3 tabular-nums">{participant.differential ?? 0}</Table.Cell>
                <Table.Cell className="py-3">
                  <div className="flex items-center gap-4">
                    <button
                      onClick={() => onEdit(participant)}
                      className="p-2 -m-1 rounded-md text-muted-foreground hover:text-primary hover:bg-primary/10 touch-manipulation transition-colors"
                      aria-label={`Edit ${participant.name}`}
                    >
                      <HiPencil className="w-5 h-5" />
                    </button>
                    {tournamentStarted ? (
                      participant.dropped_out ? (
                        <button
                          onClick={() => onDropIn(participant.id)}
                          className="p-2 -m-1 rounded-md text-muted-foreground hover:text-primary hover:bg-primary/10 touch-manipulation transition-colors"
                          aria-label={`Restore ${participant.name}`}
                          title="Restore participant"
                        >
                          <CirclePlus className="w-5 h-5" />
                        </button>
                      ) : (
                        <button
                          onClick={() => onDropOut(participant.id)}
                          className="p-2 -m-1 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 touch-manipulation transition-colors"
                          aria-label={`Drop ${participant.name}`}
                          title="Drop from tournament"
                        >
                          <CircleMinus className="w-5 h-5" />
                        </button>
                      )
                    ) : (
                      <button
                        onClick={() => onDelete(participant.id)}
                        className="p-2 -m-1 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 touch-manipulation transition-colors"
                        aria-label={`Delete ${participant.name}`}
                        title="Remove participant"
                      >
                        <HiTrash className="w-5 h-5" />
                      </button>
                    )}
                  </div>
                </Table.Cell>
              </Table.Row>
            );
          })}
        </Table.Body>
      </Table>

      <AttachDeckDialog
        open={attachDialogOpen}
        onOpenChange={setAttachDialogOpen}
        participantName={attachTarget?.name || ""}
        onSelect={handleAttachDeck}
      />
    </>
  );
};

export default ParticipantTable;
