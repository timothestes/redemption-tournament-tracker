import React from "react";
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
}

const ParticipantTable: React.FC<ParticipantTableProps> = ({
  tournamentStarted,
  participants,
  onEdit,
  onDelete,
  onDropOut,
  onDropIn,
}) => {
  const sortedParticipants = participants.sort((a, b) => {
    const mpA = a.match_points !== null ? a.match_points : -Infinity;
    const mpB = b.match_points !== null ? b.match_points : -Infinity;

    if (mpA !== mpB) {
      return mpB - mpA; // sort descending by match_points
    }

    const diffA = a.differential !== null ? a.differential : -Infinity;
    const diffB = b.differential !== null ? b.differential : -Infinity;
    return diffB - diffA; // sort descending by differential if match_points are equal
  });

  const winnerMatchPoints = sortedParticipants[0].match_points || 0;
  const winnerDifferential = sortedParticipants[0].differential || 0;
  return (
    <Table hoverable>
      <Table.Head>
        <Table.HeadCell>Name</Table.HeadCell>
        <Table.HeadCell>Match Points</Table.HeadCell>
        <Table.HeadCell>Differential</Table.HeadCell>
        <Table.HeadCell>
          <span className="sr-only">Actions</span>
        </Table.HeadCell>
      </Table.Head>
      <Table.Body>
        {sortedParticipants.map((participant, index) => {
          const isWinner = participant.match_points === winnerMatchPoints && participant.differential === winnerDifferential;
          return <Table.Row
            key={participant.id}
            className={`${isWinner ? "dark:border-yellow-700 dark:bg-yellow-500/50" : "dark:border-gray-700 dark:bg-gray-800"} `}
          >
            <Table.Cell className="whitespace-nowrap font-medium text-gray-900 dark:text-white inline-flex items-center gap-2">
              {isWinner && <Crown className="w-4 h-4 text-orange-300" />} {participant.name} {participant.dropped_out && <span className="text-red-500 text-[12px]">( Dropped )</span>}
            </Table.Cell>
            <Table.Cell>{participant.match_points}</Table.Cell>
            <Table.Cell>{participant.differential}</Table.Cell>
            <Table.Cell className="flex items-center space-x-8">
              <HiPencil
                onClick={() => onEdit(participant)}
                className="text-blue-500 cursor-pointer hover:text-blue-700 w-6 h-6"
                aria-label="Edit"
              />
              {tournamentStarted ?
                participant.dropped_out ? <CirclePlus
                  onClick={() => onDropIn(participant.id)}
                  className="text-gray-400 cursor-pointer hover:text-gray-300 w-6 h-6"
                  aria-label="Delete"
                /> :
                  <CircleMinus
                    onClick={() => onDropOut(participant.id)}
                    className="text-red-500 cursor-pointer hover:text-red-600 w-6 h-6"
                    aria-label="Delete"
                  />
                : (
                  <HiTrash
                    onClick={() => onDelete(participant.id)}
                    className="text-red-500 cursor-pointer hover:text-red-700 w-6 h-6"
                    aria-label="Drop"
                  />
                )}
            </Table.Cell>
          </Table.Row>
        })}
      </Table.Body>
    </Table>
  );
};

export default ParticipantTable;
