import React from "react";
import { Table } from "flowbite-react";
import { HiPencil, HiTrash } from "react-icons/hi";

interface Participant {
  id: string;
  name: string;
  match_points: number;
  differential: number;
  dropped_out: boolean;
}

interface ParticipantTableProps {
  participants: Participant[];
  onEdit: (participant: Participant) => void;
  onDelete: (id: string) => void;
}

const ParticipantTable: React.FC<ParticipantTableProps> = ({
  participants,
  onEdit,
  onDelete,
}) => {
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
      <Table.Body className="divide-y">
        {participants.map((participant) => (
          <Table.Row
            key={participant.id}
            className="bg-white dark:border-gray-700 dark:bg-gray-800"
          >
            <Table.Cell className="whitespace-nowrap font-medium text-gray-900 dark:text-white">
              {participant.name}
            </Table.Cell>
            <Table.Cell>{participant.match_points}</Table.Cell>
            <Table.Cell>{participant.differential}</Table.Cell>
            <Table.Cell className="flex items-center space-x-4">
              <div className="group relative">
                <HiPencil
                  onClick={() => onEdit(participant)}
                  className="text-blue-500 cursor-pointer hover:text-blue-700 w-6 h-6"
                  aria-label="Edit"
                />
                <span className="absolute -top-8 left-1/2 -translate-x-1/2 bg-gray-800 text-white px-2 py-1 rounded text-sm opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-10">
                  Edit participant
                </span>
              </div>
              <div className="group relative">
                <HiTrash
                  onClick={() => onDelete(participant.id)}
                  className="text-red-500 cursor-pointer hover:text-red-700 w-6 h-6"
                  aria-label="Delete"
                />
                <span className="absolute -top-8 left-1/2 -translate-x-1/2 bg-gray-800 text-white px-2 py-1 rounded text-sm opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-10">
                  Drop participant
                </span>
              </div>
            </Table.Cell>
          </Table.Row>
        ))}
      </Table.Body>
    </Table>
  );
};

export default ParticipantTable;
