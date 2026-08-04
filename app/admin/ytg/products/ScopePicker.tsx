"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import type { MappedSet } from "./actions";

interface ScopePickerProps {
  sets: MappedSet[];
  value: string; // "" = all sets
  onChange: (setCode: string) => void;
  disabled: boolean;
}

/** Searchable select of set codes present in confirmed mappings. */
export default function ScopePicker({ sets, value, onChange, disabled }: ScopePickerProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (q === "") return sets;
    return sets.filter((s) => s.setCode.toLowerCase().includes(q));
  }, [sets, search]);

  function pick(setCode: string) {
    onChange(setCode);
    setOpen(false);
    setSearch("");
  }

  return (
    <div ref={containerRef} className="relative w-full sm:w-64">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between rounded-md bg-muted px-3 py-2 text-left text-sm outline-none hover:bg-muted/80 disabled:opacity-50"
      >
        <span>{value === "" ? "All sets" : value}</span>
        <span className="text-muted-foreground">▾</span>
      </button>
      {open && (
        <div className="absolute z-20 mt-1 w-full rounded-md bg-popover p-2 shadow-lg">
          <Input
            autoFocus
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search set codes…"
            className="mb-2 h-8"
          />
          <ul className="max-h-64 overflow-y-auto text-sm">
            <li>
              <button
                type="button"
                className="w-full rounded px-2 py-1.5 text-left hover:bg-muted"
                onClick={() => pick("")}
              >
                All sets
              </button>
            </li>
            {filtered.map((s) => (
              <li key={s.setCode}>
                <button
                  type="button"
                  className="w-full rounded px-2 py-1.5 text-left hover:bg-muted"
                  onClick={() => pick(s.setCode)}
                >
                  {s.setCode}
                  <span className="ml-2 text-xs text-muted-foreground">{s.count} mapped</span>
                </button>
              </li>
            ))}
            {filtered.length === 0 && (
              <li className="px-2 py-1.5 text-muted-foreground">No sets match</li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
