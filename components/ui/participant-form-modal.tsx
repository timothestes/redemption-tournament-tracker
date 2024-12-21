import React from "react";
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
      <div className="bg p-4 rounded shadow-lg max-w-sm w-full">
        <h2 className="text-xl font-bold mb-4">Add Participant</h2>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="mb-2 block">
            <Label htmlFor="name" value="Participant Name" />
            <TextInput id="name" name="name" type="text" required />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="submit" color="blue">Add</Button>
            <Button type="button" color="failure" onClick={onClose}>
              Cancel
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default ParticipantFormModal;
