"use client";

import { Tabs } from "flowbite-react";
import { HiUserGroup } from "react-icons/hi";
import { FaGear } from "react-icons/fa6";
import ParticipantTable from "./ParticipantTable";
import ParticipantFormModal from "./participant-form-modal";
import { Button } from "flowbite-react";
import { HiPlus } from "react-icons/hi";

interface TournamentTabsProps {
  participants: any[];
  isModalOpen: boolean;
  setIsModalOpen: (value: boolean) => void;
  onAddParticipant: (name: string) => void;
  onEdit: (participant: any) => void;
  onDelete: (id: string) => void;
  loading: boolean;
}

export default function TournamentTabs({
  participants,
  isModalOpen,
  setIsModalOpen,
  onAddParticipant,
  onEdit,
  onDelete,
  loading,
}: TournamentTabsProps) {
  return (
    <Tabs aria-label="Tournament tabs" style={{ marginTop: "1rem" }}>
      <Tabs.Item active title="Participants" icon={HiUserGroup}>
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-2xl font-bold" style={{ width: "200px" }}>
            Participants
          </h2>
          <Button
            onClick={() => setIsModalOpen(true)}
            className="flex items-center gap-2"
            style={{ width: "200px" }}
            outline
            gradientDuoTone="greenToBlue"
          >
            <HiPlus className="w-5 h-5" />
            Add Participant
          </Button>
          <ParticipantFormModal
            isOpen={isModalOpen}
            onClose={() => setIsModalOpen(false)}
            onSubmit={onAddParticipant}
          />
        </div>
        {loading ? (
          <p>Loading participants...</p>
        ) : participants.length === 0 ? (
          <p>No participants found.</p>
        ) : (
          <div className="max-w-4xl overflow-x-auto">
            <ParticipantTable
              participants={participants}
              onEdit={onEdit}
              onDelete={onDelete}
            />
          </div>
        )}
      </Tabs.Item>
      <Tabs.Item title="Settings" icon={FaGear}>
        <div className="p-4">
          <h2 className="text-2xl font-bold mb-4">Settings</h2>
          <p className="text-gray-500">Coming soon...</p>
        </div>
      </Tabs.Item>
    </Tabs>
  );
}
