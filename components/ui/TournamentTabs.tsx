"use client";

import { Tabs } from "flowbite-react";
import PodGenerationModal from "./PodGenerationModal";
import { Dispatch, SetStateAction, useEffect, useRef, useState } from "react";
import { HiUserGroup } from "react-icons/hi";
import { FaGear, FaClipboardList } from "react-icons/fa6";
import { MdPeople } from "react-icons/md";
import TournamentSettings from "./TournamentSettings";
import TournamentRounds from "./TournamentRounds";
import ParticipantTable from "./ParticipantTable";
import ParticipantFormModal from "./participant-form-modal";
import StandingsTable from "./StandingsTable";
import { HiPlus } from "react-icons/hi";
import { GiCardPickup } from "react-icons/gi";
import { HiOutlineChartBar } from "react-icons/hi2";
import { printFinalStandings } from "../../utils/printUtils";
import { Button } from "./button";
import { AuditLogPanel } from "./AuditLogPanel";
import type { TournamentDecklistRow } from "../../app/tracker/tournaments/actions";

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
  decklists: TournamentDecklistRow[];
  onDecklistsChange: () => void;
  isHost?: boolean;
  onRepairCompleted?: () => void;
  matchesRefreshNonce?: number;
  onRoundEnded?: () => void | Promise<void>;
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
  decklists,
  onDecklistsChange,
  isHost = false,
  onRepairCompleted,
  matchesRefreshNonce,
  onRoundEnded,
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
      theme={{
        tablist: {
          base: "flex text-center overflow-x-auto no-scrollbar",
          variant: {
            default: "border-b border-border",
          },
          tabitem: {
            base: "flex items-center justify-center px-3 py-2.5 sm:px-4 sm:py-4 text-sm font-medium first:ml-0 focus:outline-none disabled:cursor-not-allowed disabled:text-muted-foreground whitespace-nowrap -mb-px border-b-2 border-transparent",
            variant: {
              default: {
                base: "",
                active: {
                  // The active tab now signals primacy via foreground text +
                  // a thin foreground underline rather than the bright accent.
                  on: "text-foreground font-semibold border-foreground",
                  off: "text-muted-foreground hover:text-foreground",
                },
              },
            },
          },
        },
      }}
    >
      <Tabs.Item title="Participants" icon={HiUserGroup}>
        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 mb-6">
          <h2 className="text-2xl font-bold">
            Participants{participants.length > 0 && ` (${participants.length})`}
          </h2>
          <div className="flex items-center gap-2 justify-end flex-wrap">
            {/* generate pods button only if more than one participant and tournament hasn't ended */}
            {participants.length > 1 && !tournamentEnded && (
              <Button
                type="button"
                onClick={() => setShowPodsModal(true)}
                variant="outline"
                size="sm"
                className="gap-1.5"
              >
                <GiCardPickup className="w-4 h-4" />
                <span className="hidden sm:inline">Pods</span>
              </Button>
            )}
            {tournamentEnded && (
              <Button
                onClick={() => printFinalStandings(participants, tournamentName || "Tournament")}
                variant="accent"
                size="sm"
              >
                <span className="hidden sm:inline">Print Final Standings</span>
                <span className="sm:hidden">Print</span>
              </Button>
            )}
            {!tournamentEnded && (
              <div className="relative group">
                <Button
                  ref={addParticipantButtonRef}
                  onClick={() => !tournamentStarted && setIsModalOpen(true)}
                  className={`flex items-center gap-2 ${tournamentStarted ? "opacity-50 cursor-not-allowed" : ""}`}
                  variant="success"
                  disabled={tournamentStarted}
                >
                  <div className="flex items-center gap-2">
                    <HiPlus className="w-5 h-5" />
                    <span className="hidden sm:inline">Add Participant</span>
                    <span className="sm:hidden">Add</span>
                  </div>
                </Button>
                {tournamentStarted && (
                  <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 px-3 py-2 bg-foreground text-background text-sm rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-200 whitespace-nowrap">
                    Cannot add participants after tournament has started
                    <div className="absolute left-1/2 -translate-x-1/2 top-full -mt-1 border-4 border-transparent border-t-foreground"></div>
                  </div>
                )}
              </div>
            )}
            <ParticipantFormModal
              isOpen={isModalOpen}
              existingNames={participants.map((p) => p.name)}
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
          <div className="w-full max-w-[800px] mx-auto overflow-x-auto">
            <div className="rounded-lg border border-border bg-card jayden-gradient-bg shadow-sm">
              <div className="flex flex-col items-center justify-center py-12 px-6">
                <p className="text-foreground font-medium mb-2">No participants found</p>
                <p className="text-sm text-muted-foreground">
                  Add participants to get started
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div className="w-full max-w-[800px] mx-auto overflow-x-auto">
            <ParticipantTable
              tournamentStarted={tournamentStarted}
              tournamentEnded={tournamentEnded}
              participants={participants}
              onEdit={onEdit}
              onDelete={onDelete}
              onDropOut={onDropOut}
              onDropIn={onDropIn}
              tournamentId={tournamentId}
              decklists={decklists}
              onDecklistsChange={onDecklistsChange}
            />
          </div>
        )}
      </Tabs.Item>
      <Tabs.Item
        title={
          <div className="relative group">
            Rounds
            {!tournamentStarted && (
              <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-4 px-3 py-2 bg-foreground text-background text-sm rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-200 whitespace-nowrap">
                Add participants and start the tournament to enable this tab
                <div className="absolute left-1/2 -translate-x-1/2 top-full -mt-1 border-4 border-transparent border-t-foreground"></div>
              </div>
            )}
          </div>
        }
        icon={MdPeople}
        disabled={!tournamentStarted}
      >
        <div className="w-full max-w-[800px] mx-auto overflow-x-auto">
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
            isHost={isHost}
            onRepairCompleted={onRepairCompleted}
            matchesRefreshNonce={matchesRefreshNonce}
            onRoundEnded={onRoundEnded}
          />
        </div>
      </Tabs.Item>
      {tournamentStarted && (
        <Tabs.Item title="Standings" icon={HiOutlineChartBar}>
          <div className="w-full max-w-[800px] mx-auto overflow-x-auto">
            <StandingsTable
              tournamentId={tournamentId}
              participants={participants as any}
              tournamentEnded={tournamentEnded}
              matchesRefreshNonce={matchesRefreshNonce}
            />
          </div>
        </Tabs.Item>
      )}
      <Tabs.Item title="Settings" icon={FaGear}>
        <div className="w-full">
          <TournamentSettings
            tournamentId={tournamentId}
            participantCount={participants.length}
            key={activeTab} // Force re-render when tab becomes active
          />
        </div>
      </Tabs.Item>
      {isHost && (
        <Tabs.Item
          title={
            <>
              <span className="hidden sm:inline">Audit log</span>
              <span className="sm:hidden">History</span>
            </>
          }
          icon={FaClipboardList}
        >
          <div className="w-full max-w-[800px] mx-auto">
            <AuditLogPanel tournamentId={tournamentId} />
          </div>
        </Tabs.Item>
      )}
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
