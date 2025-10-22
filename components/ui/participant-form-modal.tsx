import React, { useEffect, useRef, useState } from "react";
import { Button, Label, TextInput } from "flowbite-react";
import { useTheme } from "next-themes";

interface ParticipantFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (name: string) => void;
}

const ParticipantFormModal: React.FC<ParticipantFormModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
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

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const name = formData.get("name")?.toString();
    if (name) {
      onSubmit(name);
    }
  };

  if (!isOpen) return null;
  
  // Don't render theme-specific styling until client-side to avoid hydration mismatch
  const currentTheme = mounted ? (theme === 'system' ? resolvedTheme : theme) : 'dark';
  const isLightTheme = currentTheme === 'light';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-60">
      <div className={`${isLightTheme ? 'bg-white border-gray-200' : 'bg-[#1F2937] border-zinc-300/10'} border-2 py-6 px-6 rounded-lg shadow-lg max-w-sm w-full`}>
        <h2 className={`text-xl font-bold mb-4 ${isLightTheme ? 'text-gray-800' : 'text-white'}`}>Add Participant</h2>
        <form ref={formRef} onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="mb-2 block space-y-1">
            <Label htmlFor="name" value="Participant Name" className={isLightTheme ? 'text-gray-700' : ''} />
            <TextInput
              id="name"
              name="name"
              type="text"
              required
              ref={inputRef}
              maxLength={35}
              placeholder="Max 35 characters"
              className={isLightTheme ? 'bg-gray-50 border-gray-300' : ''}
            />
          </div>
          <div className="flex justify-end gap-3">
            <Button 
              type="submit" 
              outline 
              gradientDuoTone="greenToBlue"
            >
              Add
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

export default ParticipantFormModal;
