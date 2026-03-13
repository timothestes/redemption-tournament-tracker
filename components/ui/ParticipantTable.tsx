import React, { useMemo } from "react";
import { Table } from "flowbite-react";
import { HiPencil, HiTrash } from "react-icons/hi";
import { CircleMinus, CirclePlus, Crown } from "lucide-react";

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
}

const ParticipantTable: React.FC<ParticipantTableProps> = ({
  tournamentStarted,
  participants,
  onEdit,
  onDelete,
  onDropOut,
  onDropIn,
  tournamentEnded = false,
}) => {
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

  const winnerMatchPoints = sortedParticipants[0].match_points || 0;
  const winnerDifferential = sortedParticipants[0].differential || 0;
  return (
    <Table hoverable>
      <Table.Head>
        <Table.HeadCell className="py-3">Name</Table.HeadCell>
        <Table.HeadCell className="py-3">Match Points</Table.HeadCell>
        <Table.HeadCell className="py-3">Differential</Table.HeadCell>
        <Table.HeadCell className="py-3">
          <span className="sr-only">Actions</span>
        </Table.HeadCell>
      </Table.Head>
      <Table.Body>
        {sortedParticipants.map((participant, index) => {
          const isWinner = participant.match_points === winnerMatchPoints && participant.differential === winnerDifferential;
          return <Table.Row
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
        })}
      </Table.Body>
    </Table>
  );
};

export default ParticipantTable;
