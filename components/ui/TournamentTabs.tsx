"use client";

import { Tabs, Card, Button } from "flowbite-react";
import PodGenerationModal from "./PodGenerationModal";
import { Dispatch, SetStateAction, useEffect, useRef, useState } from "react";
import { HiUserGroup } from "react-icons/hi";
import { FaGear } from "react-icons/fa6";
import { MdPeople } from "react-icons/md";
import TournamentSettings from "./TournamentSettings";
import TournamentRounds from "./TournamentRounds";
import ParticipantTable from "./ParticipantTable";
import ParticipantFormModal from "./participant-form-modal";
import { HiPlus } from "react-icons/hi";
import { GiCardPickup } from "react-icons/gi";

interface TournamentTabsProps {
  participants: any[];
  isModalOpen: boolean;
  setIsModalOpen: (value: boolean) => void;
  onAddParticipant: (name: string) => void;
  onEdit: (participant: any) => void;
  onDelete: (id: string) => void;
  onDropOut: (id: string) => void;
  onDropIn: (id: string) => void;
  loading: boolean;
  tournamentId: string;
  tournamentStarted?: boolean;
  tournamentEnded?: boolean;
  tournamentName?: string | null;
  onTournamentEnd?: () => void;
  setLatestRound: Dispatch<SetStateAction<any>>;
  onRoundActiveChange?: (
    isActive: boolean,
    roundStartTime: string | null
  ) => void;
  createPairing: (round: number) => void;
  matchErrorIndex: any;
  setMatchErrorIndex: Dispatch<SetStateAction<any>>;
  activeTab: number;
  setActiveTab: Dispatch<SetStateAction<number>>;
  fetchParticipants: () => void;
}

export default function TournamentTabs({
  participants,
  isModalOpen,
  setIsModalOpen,
  onAddParticipant,
  onEdit,
  onDelete,
  onDropOut,
  onDropIn,
  loading,
  tournamentId,
  tournamentStarted = false,
  tournamentEnded = false,
  tournamentName,
  onTournamentEnd,
  setLatestRound,
  createPairing,
  matchErrorIndex,
  setMatchErrorIndex,
  activeTab,
  setActiveTab,
  fetchParticipants,
}: TournamentTabsProps) {
  // state for booster draft pods
  const [showPodsModal, setShowPodsModal] = useState(false);
  const [podSize, setPodSize] = useState(4);
  const [pods, setPods] = useState<any[][]>([]);
  const tabsRef = useRef(null);
  const addParticipantButtonRef = useRef<HTMLButtonElement>(null);

  // Use effect to programmatically change tabs when activeTab state changes
  useEffect(() => {
    if (tabsRef.current) {
      tabsRef.current.setActiveTab(activeTab);
    }

    if (activeTab === 0) {
      fetchParticipants();
    }
  }, [activeTab]);
  return (
    <>
      <Tabs
      ref={tabsRef}
      aria-label="Tournament tabs"
      style={{ marginTop: "1rem" }}
      onActiveTabChange={(tab) => setActiveTab(tab)}
    >
      <Tabs.Item title="Participants" icon={HiUserGroup}>
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-2xl font-bold" style={{ width: "200px" }}>
            Participants{participants.length > 0 && ` (${participants.length})`}
          </h2>
          <div className="flex items-center gap-3">
            {/* generate pods button only if more than one participant */}
            {participants.length > 1 && (
              <div className="relative group">
                <button
                  type="button"
                  onClick={() => setShowPodsModal(true)}
                  className="inline-flex items-center justify-center p-2 rounded-md border border-blue-500 text-blue-500 hover:bg-blue-500 hover:text-white"
                  aria-label="Generate booster draft pods"
                >
                  <GiCardPickup className="w-5 h-5" />
                </button>
                <div className="absolute left-1/2 transform -translate-x-1/2 bottom-full mb-2 px-3 py-1 bg-gray-900 text-white text-sm rounded-md opacity-0 group-hover:opacity-100 transition-opacity">
                  Generate booster draft pods
                  <div className="absolute left-1/2 transform -translate-x-1/2 top-full -mt-1 border-4 border-transparent border-t-gray-900"></div>
                </div>
              </div>
            )}
            <div className="relative group">
              <Button
                ref={addParticipantButtonRef}
                onClick={() => !tournamentStarted && setIsModalOpen(true)}
                className={`flex items-center gap-2 ${tournamentStarted ? "opacity-50 cursor-not-allowed" : ""}`}
                style={{ width: "200px" }}
                outline
                gradientDuoTone="greenToBlue"
                disabled={tournamentStarted}
              >
                <div className="flex gap-2">
                  <HiPlus className="w-5 h-5" />
                  Add Participant
                </div>
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
              onClose={() => {
                setIsModalOpen(false);
                setTimeout(() => {
                  addParticipantButtonRef.current?.focus();
                }, 0);
              }}
              onSubmit={(name) => {
                onAddParticipant(name);
                setIsModalOpen(false);
                setTimeout(() => {
                  addParticipantButtonRef.current?.focus();
                }, 0);
              }}
            />
          </div>
        </div>
        {loading ? (
          <p>Loading participants...</p>
        ) : participants.length === 0 ? (
          <div className="w-[800px] max-xl:w-full mx-auto overflow-x-auto">
            <Card>
              <div className="flex flex-col items-center justify-center py-8">
                <p className="text-gray-500 mb-4">No participants found</p>
                <p className="text-sm text-gray-400">
                  Add participants to get started
                </p>
              </div>
            </Card>
          </div>
        ) : (
          <div className="w-[800px] max-xl:w-full mx-auto overflow-x-auto">
            <ParticipantTable
              tournamentStarted={tournamentStarted}
              tournamentEnded={tournamentEnded}
              participants={participants}
              onEdit={onEdit}
              onDelete={onDelete}
              onDropOut={onDropOut}
              onDropIn={onDropIn}
            />
          </div>
        )}
      </Tabs.Item>
      <Tabs.Item
        title={
          <div className="relative group">
            Rounds
            {!tournamentStarted && (
              <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-4 px-3 py-2 bg-gray-900 text-white text-sm rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-200 whitespace-nowrap">
                Add participants and start the tournament to enable this tab
                <div className="absolute left-1/2 -translate-x-1/2 top-full -mt-1 border-4 border-transparent border-t-gray-900"></div>
              </div>
            )}
          </div>
        }
        icon={MdPeople}
        disabled={!tournamentStarted}
      >
        <div className="min-w-[800px] max-xl:min-w-full w-full mx-auto overflow-x-auto">
          <TournamentRounds
            tournamentId={tournamentId}
            isActive={activeTab === 1}
            key={activeTab} // Force re-render when tab becomes active
            onTournamentEnd={onTournamentEnd}
            setLatestRound={setLatestRound}
            createPairing={createPairing}
            matchErrorIndex={matchErrorIndex}
            setMatchErrorIndex={setMatchErrorIndex}
            activeTab={activeTab}
            tournamentName={tournamentName}
          />
        </div>
      </Tabs.Item>
      <Tabs.Item title="Settings" icon={FaGear}>
        <div className="w-full">
          <TournamentSettings
            tournamentId={tournamentId}
            participantCount={participants.length}
            key={activeTab} // Force re-render when tab becomes active
          />
        </div>
      </Tabs.Item>
    </Tabs>
    {/* use external pod generation modal */}
    <PodGenerationModal
      show={showPodsModal}
      participants={participants}
      onClose={() => setShowPodsModal(false)}
    />
  </>
  );
}
