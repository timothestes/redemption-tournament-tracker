"use client";

import { Tabs } from "flowbite-react";
import { useState } from "react";
import { HiUserGroup } from "react-icons/hi";
import { FaGear } from "react-icons/fa6";
import { MdPeople } from "react-icons/md";
import TournamentSettings from "./TournamentSettings";
import TournamentRounds from "./TournamentRounds";
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
  tournamentId: string;
  tournamentStarted?: boolean;
  onTournamentEnd?: () => void;
}

export default function TournamentTabs({
  participants,
  isModalOpen,
  setIsModalOpen,
  onAddParticipant,
  onEdit,
  onDelete,
  loading,
  tournamentId,
  tournamentStarted = false,
  onTournamentEnd,
}: TournamentTabsProps) {
  const [activeTab, setActiveTab] = useState(0);
  return (
    <Tabs 
      aria-label="Tournament tabs" 
      style={{ marginTop: "1rem" }}
      onActiveTabChange={(tab) => setActiveTab(tab)}
    >
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
          <div className="min-w-[800px] max-w-[1200px] w-full mx-auto overflow-x-auto">
            <ParticipantTable
              participants={participants}
              onEdit={onEdit}
              onDelete={onDelete}
            />
          </div>
        )}
      </Tabs.Item>
      <Tabs.Item title="Rounds" icon={MdPeople} disabled={!tournamentStarted}>
        <div className="p-4 min-w-[800px] max-w-[1200px] w-full mx-auto">
          <TournamentRounds
            tournamentId={tournamentId}
            isActive={activeTab === 1}
            key={activeTab} // Force re-render when tab becomes active
            onTournamentEnd={onTournamentEnd}
          />
        </div>
      </Tabs.Item>
      <Tabs.Item title="Settings" icon={FaGear}>
        <div className="p-4 min-w-[800px] max-w-[1200px] w-full mx-auto">
          <TournamentSettings 
            tournamentId={tournamentId}
            participantCount={participants.length}
            key={activeTab} // Force re-render when tab becomes active
          />
        </div>
      </Tabs.Item>
    </Tabs>
  );
}
