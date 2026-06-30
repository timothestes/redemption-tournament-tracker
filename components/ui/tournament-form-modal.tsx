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
  // Create one tournament per item. With 0/1 category selected this is a single
  // item carrying the (editable) name; with 2+ it's one auto-named item per type.
  onSubmit: (items: { name: string; category: string | null }[]) => void;
  defaultName?: string;
  // Categories to offer. Defaults to the standard list when omitted (e.g. an
  // official listing passes its own formats here).
  categoryOptions?: string[];
}

// Drop a trailing "- 2P" / "2P" player-count suffix; it reads as clutter.
const cleanCategory = (label: string) => label.replace(/\s*-?\s*2P$/i, "").trim();

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

const TournamentFormModal: React.FC<TournamentFormModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
  defaultName,
  categoryOptions,
}) => {
  const firstCheckboxRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  // The set of checked categories. Each checked type becomes its own tournament.
  const [selected, setSelected] = useState<string[]>([]);
  // Once the host edits the name, we stop auto-building it from the category.
  const [nameTouched, setNameTouched] = useState(false);

  const options = Array.from(
    new Set(
      (categoryOptions && categoryOptions.length > 0
        ? categoryOptions
        : [...STANDARD_CATEGORIES]
      ).map(cleanCategory)
    )
  );

  useEffect(() => {
    if (!isOpen) return;
    // Pre-check the first type so the modal opens ready to add one tournament,
    // matching the previous single-select default. The host can check more.
    const initial = options[0] ? [options[0]] : [];
    setSelected(initial);
    setNameTouched(false);
    // A listing-provided name wins; otherwise auto-build from the first category.
    setName(defaultName ? defaultName : buildAutoName(initial[0] ?? ""));
    requestAnimationFrame(() => {
      firstCheckboxRef.current?.focus();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, defaultName]);

  // Creating multiple tournaments at once: each gets an auto-built name, so the
  // single editable name field is replaced by a preview list.
  const isMulti = selected.length >= 2;

  const toggleCategory = (value: string) => {
    const next = selected.includes(value)
      ? selected.filter((c) => c !== value)
      : [...selected, value];
    setSelected(next);
    // Keep the single name field in sync while exactly one type is checked and the
    // host hasn't taken over the name (and we're not preserving a listing name).
    // Going to 0 or 2+ leaves the field for the host / preview to drive.
    if (!nameTouched && !defaultName) {
      if (next.length === 1) setName(buildAutoName(next[0]));
      else if (next.length === 0) setName("");
    }
  };

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (isMulti) {
      onSubmit(selected.map((c) => ({ name: buildAutoName(c), category: c })));
      return;
    }
    const trimmed = name.trim();
    if (!trimmed) return;
    onSubmit([{ name: trimmed, category: selected[0] ?? null }]);
  };

  const fieldClasses =
    "w-full rounded-lg border border-border bg-card text-foreground px-3 py-2 text-sm focus:outline-none";

  const canSubmit = isMulti || name.trim().length > 0;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold">Add Tournament</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <DialogBody className="space-y-3">
            <div
              role="group"
              aria-labelledby="category-group-label"
              aria-describedby="category-group-help"
            >
              <span
                id="category-group-label"
                className="block text-xs font-medium text-muted-foreground mb-1"
              >
                Categories
              </span>
              <div className="rounded-lg border border-border bg-card divide-y divide-border max-h-72 overflow-y-auto">
                {options.map((opt, i) => {
                  const checked = selected.includes(opt);
                  return (
                    <label
                      key={opt}
                      className="flex items-center gap-2 px-3 py-2 text-sm text-foreground cursor-pointer hover:bg-muted"
                    >
                      <input
                        ref={i === 0 ? firstCheckboxRef : undefined}
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleCategory(opt)}
                        className="h-4 w-4 accent-primary"
                      />
                      <span>{opt}</span>
                    </label>
                  );
                })}
              </div>
              <p
                id="category-group-help"
                className="mt-1 text-xs text-muted-foreground"
              >
                Check more than one to create a tournament for each. Categories set
                sensible defaults (souls to win, round length) you can change later.
              </p>
            </div>
            {isMulti ? (
              <div>
                <span className="block text-xs font-medium text-muted-foreground mb-1">
                  Will create {selected.length} tournaments
                </span>
                <ul className="rounded-lg border border-border bg-muted/40 px-3 py-2 space-y-1">
                  {selected.map((c) => (
                    <li
                      key={c}
                      className="text-sm text-foreground truncate"
                      title={buildAutoName(c)}
                    >
                      {buildAutoName(c)}
                    </li>
                  ))}
                </ul>
                <p className="mt-1 text-xs text-muted-foreground">
                  Rename any of them later from the tournaments list.
                </p>
              </div>
            ) : (
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
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    setNameTouched(true);
                  }}
                  className={fieldClasses}
                />
              </div>
            )}
          </DialogBody>
          <DialogFooter className="justify-end">
            <Button type="submit" variant="success" disabled={!canSubmit}>
              {isMulti ? `Add ${selected.length} tournaments` : "Add"}
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
