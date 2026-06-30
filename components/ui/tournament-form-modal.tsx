import React, { useEffect, useRef, useState } from "react";
import { Button } from "./button";
import { STANDARD_CATEGORIES } from "../../utils/tournament/categoryDefaults";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogBody,
  DialogFooter,
} from "./dialog";

interface TournamentFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (name: string, category: string | null) => void;
  defaultName?: string;
  // Categories to offer. Defaults to the standard list when omitted (e.g. an
  // official listing passes its own formats here).
  categoryOptions?: string[];
}

const TournamentFormModal: React.FC<TournamentFormModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
  defaultName,
  categoryOptions,
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [category, setCategory] = useState("");

  const options =
    categoryOptions && categoryOptions.length > 0
      ? categoryOptions
      : [...STANDARD_CATEGORIES];

  useEffect(() => {
    if (isOpen) {
      setCategory("");
      if (inputRef.current) {
        inputRef.current.value = defaultName ?? "";
        inputRef.current.focus();
      }
    }
  }, [isOpen, defaultName]);

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const name = formData.get("name")?.toString();
    if (name) {
      onSubmit(name, category || null);
    }
  };

  const selectClasses =
    "w-full rounded-lg border border-border bg-card text-foreground px-3 py-2 text-sm focus:outline-none";

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold">Add Tournament</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <DialogBody className="space-y-3">
            <input
              id="name"
              name="name"
              type="text"
              placeholder="Tournament Name (max 35 characters)"
              required
              maxLength={35}
              ref={inputRef}
              className="w-full rounded-lg border border-border bg-card text-foreground px-3 py-2 text-sm focus:outline-none"
            />
            <div>
              <label
                htmlFor="category"
                className="block text-xs font-medium text-muted-foreground mb-1"
              >
                Category
              </label>
              <select
                id="category"
                name="category"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className={selectClasses}
              >
                <option value="">No specific category</option>
                {options.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-muted-foreground">
                Sets sensible defaults (souls to win, round length) you can change
                later.
              </p>
            </div>
          </DialogBody>
          <DialogFooter className="justify-end">
            <Button type="submit" variant="success">
              Add
            </Button>
            <Button type="button" variant="cancel" onClick={onClose}>
              Cancel
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default TournamentFormModal;
