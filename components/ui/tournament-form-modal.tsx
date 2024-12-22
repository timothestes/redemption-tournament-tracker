import React, { useEffect, useRef } from "react";
import { Button, Label, TextInput } from "flowbite-react";

interface TournamentFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (name: string) => void;
}

const TournamentFormModal: React.FC<TournamentFormModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
}) => {
  const inputRef = useRef<HTMLInputElement>(null);

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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-30">
      <div className="bg-background p-4 rounded shadow-lg max-w-sm w-full">
        <h2 className="text-xl font-bold mb-4">Add Tournament</h2>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="mb-2 block">
            <Label htmlFor="name" value="" />
            <TextInput
              id="name"
              name="name"
              type="text"
              placeholder="My tournament name"
              required
              ref={inputRef}
            />
          </div>
          <div className="flex justify-end gap-3">
            <Button type="submit" outline gradientDuoTone="greenToBlue">Add</Button>
            <Button type="button" outline color="red" onClick={onClose}>
              Cancel
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default TournamentFormModal;
