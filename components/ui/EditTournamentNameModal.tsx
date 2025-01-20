import { Button, Modal, TextInput } from "flowbite-react";

interface EditTournamentNameModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: () => void;
  tournamentName: string;
  setTournamentName: (name: string) => void;
}

export default function EditTournamentNameModal({
  isOpen,
  onClose,
  onSave,
  tournamentName,
  setTournamentName,
}: EditTournamentNameModalProps) {
  return (
    <Modal
      dismissible
      show={isOpen}
      onClose={onClose}
      size="sm"
    >
      <Modal.Header>Edit Tournament Name</Modal.Header>
      <Modal.Body>
        <div className="space-y-4">
          <TextInput
            value={tournamentName}
            onChange={(e) => setTournamentName(e.target.value)}
            placeholder="Tournament Name (max 35 characters)"
            required
            maxLength={35}
          />
        </div>
      </Modal.Body>
      <Modal.Footer className="flex justify-end space-x-2">
        <Button outline gradientDuoTone="greenToBlue" onClick={onSave}>
          Save
        </Button>
        <Button outline color="red" onClick={onClose}>
          Cancel
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
