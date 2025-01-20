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
      <div className="bg-black p-4 rounded shadow-lg max-w-sm w-full">
        <h2 className="text-xl font-bold mb-4">Add Participant</h2>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="mb-2 block">
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
            <Button type="submit" outline gradientDuoTone="greenToBlue">Add</Button>
            <Button type="button" outline color="red" onClick={onClose}>
              Cancel
            </Button>
          </div>
        </form>
      </div>
      <EditTournamentNameModal
        isOpen={isEditModalOpen}
        onClose={() => setIsEditModalOpen(false)}
        onSave={async () => {
          try {
            const { error } = await supabase
              .from("tournaments")
              .update({ name: newTournamentName })
              .eq("id", id);
            
            if (error) throw error;
            
            setTournament(prev => ({
              ...prev,
              name: newTournamentName
            }));
            setIsEditModalOpen(false);
            showToast("Tournament name updated successfully!", "success");
          } catch (error) {
            console.error("Error updating tournament name:", error);
            showToast("Error updating tournament name", "error");
          }
        }}
        tournamentName={newTournamentName}
        setTournamentName={setNewTournamentName}
      />
    </div>
  );
};

export default ParticipantFormModal;
