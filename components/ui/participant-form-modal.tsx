import React, { useEffect, useRef } from "react";
import { Button, Label, TextInput } from "flowbite-react";

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

  useEffect(() => {
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-60">
      <div className="bg-[#1F2937] border-2 border-zinc-300/10 py-6 px-6 rounded-lg shadow-lg max-w-sm w-full">
        <h2 className="text-xl font-bold mb-4">Add Participant</h2>
        <form ref={formRef} onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="mb-2 block space-y-1">
            <Label htmlFor="name" value="Participant Name" />
            <TextInput
              id="name"
              name="name"
              type="text"
              required
              ref={inputRef}
              maxLength={35}
              placeholder="Max 35 characters"
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
            <Button type="button" outline color="red" onClick={onClose}>
              Cancel
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default ParticipantFormModal;
