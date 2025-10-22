import React, { useEffect, useRef, useState } from "react";
import { Button, Label, TextInput } from "flowbite-react";
import { useTheme } from "next-themes";

interface EditParticipantModalProps {
  isOpen: boolean;
  onClose: () => void;
  participant: any;
  onSave: () => void;
  newParticipantName: string;
  setNewParticipantName: (name: string) => void;
  newMatchPoints: string;
  setNewMatchPoints: (points: string) => void;
  newDifferential: string;
  setNewDifferential: (differential: string) => void;
  newDroppedOut: boolean;
  setNewDroppedOut: (droppedOut: boolean) => void;
  isTournamentStarted: boolean;
}

const EditParticipantModal: React.FC<EditParticipantModalProps> = ({
  isOpen,
  onClose,
  participant,
  onSave,
  newParticipantName,
  setNewParticipantName,
  newMatchPoints,
  setNewMatchPoints,
  newDifferential,
  setNewDifferential,
  isTournamentStarted
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const { theme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  
  // Handle ESC key to close modal
  useEffect(() => {
    if (!isOpen) return;
    
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose]);
  
  // Only run on client to avoid hydration mismatch
  useEffect(() => {
    setMounted(true);
    
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  if (!isOpen || !participant) return null;
  
  // Don't render theme-specific styling until client-side to avoid hydration mismatch
  const currentTheme = mounted ? (theme === 'system' ? resolvedTheme : theme) : 'dark';
  const isLightTheme = currentTheme === 'light';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-60">
      <div className={`${isLightTheme ? 'bg-white border-gray-200' : 'bg-[#1F2937] border-zinc-300/10'} border-2 py-6 px-6 rounded-lg shadow-lg max-w-sm w-full`}>
        <h2 className={`text-xl font-bold mb-4 ${isLightTheme ? 'text-gray-800' : 'text-white'}`}>Edit Participant</h2>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSave();
          }}
          className="flex flex-col gap-4"
        >
          <div className="mb-2 block space-y-1">
            <Label htmlFor="name" value="Participant Name" className={isLightTheme ? 'text-gray-700' : ''} />
            <TextInput
              id="name"
              name="name"
              type="text"
              value={newParticipantName}
              onChange={(e) => setNewParticipantName(e.target.value)}
              required
              ref={inputRef}
              className={isLightTheme ? 'bg-gray-50 border-gray-300' : ''}
            />
          </div>
          <div className="mb-2 block space-y-1">
            <Label htmlFor="match_points" value="Match Points" className={isLightTheme ? 'text-gray-700' : ''} />
            <TextInput
              id="match_points"
              name="match_points"
              type="number"
              value={newMatchPoints}
              onChange={(e) => setNewMatchPoints(e.target.value)}
              disabled={!isTournamentStarted}
              className={isLightTheme ? 'bg-gray-50 border-gray-300' : ''}
            />
          </div>
          <div className="mb-2 block space-y-1">
            <Label htmlFor="differential" value="Differential" className={isLightTheme ? 'text-gray-700' : ''} />
            <TextInput
              id="differential"
              name="differential"
              type="number"
              value={newDifferential}
              onChange={(e) => setNewDifferential(e.target.value)}
              disabled={!isTournamentStarted}
              className={isLightTheme ? 'bg-gray-50 border-gray-300' : ''}
            />
          </div>
          <div className="flex justify-end gap-3">
            <Button type="submit" outline gradientDuoTone="greenToBlue">
              Save
            </Button>
            <Button 
              type="button" 
              outline 
              gradientDuoTone="pinkToOrange" 
              onClick={onClose}
              className="border-red-500 hover:bg-red-500/10"
            >
              Cancel
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default EditParticipantModal;
