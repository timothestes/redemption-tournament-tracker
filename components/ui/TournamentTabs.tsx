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
          <div className="relative group">
            <Button
              onClick={() => !tournamentStarted && setIsModalOpen(true)}
              className={`flex items-center gap-2 ${tournamentStarted ? 'opacity-50 cursor-not-allowed' : ''}`}
              style={{ width: "200px" }}
              outline
              gradientDuoTone="greenToBlue"
              disabled={tournamentStarted}
            >
              <HiPlus className="w-5 h-5" />
              Add Participant
            </Button>
            {tournamentStarted && (
              <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 px-3 py-2 bg-gray-900 text-white text-sm rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-200 whitespace-nowrap">
                Cannot add participants after tournament has started
                <div className="absolute left-1/2 -translate-x-1/2 top-full -mt-1 border-4 border-transparent border-t-gray-900"></div>
              </div>
            )}
          </div>
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
        <div className="min-w-[800px] max-w-[1200px] w-full mx-auto overflow-x-auto">
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
