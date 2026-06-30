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

// Drop a trailing "- 2P" / "2P" player-count suffix; it reads as clutter.
const cleanCategory = (label: string) => label.replace(/\s*-?\s*2P$/i, "").trim();

const TournamentFormModal: React.FC<TournamentFormModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
  defaultName,
  categoryOptions,
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  // Once the host edits the name, we stop auto-building it from the category.
  const [nameTouched, setNameTouched] = useState(false);

  const options = (
    categoryOptions && categoryOptions.length > 0
      ? categoryOptions
      : [...STANDARD_CATEGORIES]
  ).map(cleanCategory);

  // Build a name like "Jun 29, 2026 Type 1 Tournament" from the selected category.
  const buildAutoName = (type: string) => {
    if (!type) return "";
    const date = new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(new Date());
    return `${date} ${type} Tournament`;
  };

  useEffect(() => {
    if (!isOpen) return;
    const initialCategory = options[0] ?? "";
    setCategory(initialCategory);
    setNameTouched(false);
    // A listing-provided name wins; otherwise auto-build from the default category.
    setName(defaultName ? defaultName : buildAutoName(initialCategory));
    // Focus and select the name so it's easy to override.
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, defaultName]);

  const handleCategoryChange = (value: string) => {
    setCategory(value);
    // Rebuild the name from the category only when the host hasn't edited it and
    // we're not preserving a listing-provided name.
    if (!nameTouched && !defaultName && value) {
      setName(buildAutoName(value));
    }
  };

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (trimmed) {
      onSubmit(trimmed, category || null);
    }
  };

  const fieldClasses =
    "w-full rounded-lg border border-border bg-card text-foreground px-3 py-2 text-sm focus:outline-none";

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold">Add Tournament</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <DialogBody className="space-y-3">
            <div>
              <label
                htmlFor="category"
                className="block text-xs font-medium text-muted-foreground mb-1"
              >
                Category
              </label>
              <select
                id="category"
                value={category}
                onChange={(e) => handleCategoryChange(e.target.value)}
                className={fieldClasses}
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
            <div>
              <label
                htmlFor="name"
                className="block text-xs font-medium text-muted-foreground mb-1"
              >
                Tournament name
              </label>
              <input
                id="name"
                type="text"
                placeholder="Tournament name"
                required
                maxLength={60}
                ref={inputRef}
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setNameTouched(true);
                }}
                className={fieldClasses}
              />
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
