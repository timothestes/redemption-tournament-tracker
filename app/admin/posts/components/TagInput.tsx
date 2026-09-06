"use client";

import { useMemo, useState } from "react";
import { MAX_TAGS, MAX_TAG_LEN } from "../lib/validate";

export default function TagInput({
  value,
  onChange,
  suggestions,
  disabled,
}: {
  value: string[];
  onChange: (tags: string[]) => void;
  suggestions: string[];
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState("");
  const has = (t: string) => value.some((v) => v.toLowerCase() === t.toLowerCase());

  const matches = useMemo(() => {
    const q = draft.trim().toLowerCase();
    if (!q) return [];
    return suggestions.filter((s) => s.toLowerCase().includes(q) && !has(s)).slice(0, 6);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, suggestions, value]);

  const add = (raw: string) => {
    const t = raw.trim().replace(/\s+/g, " ");
    setDraft("");
    if (!t || t.length > MAX_TAG_LEN || value.length >= MAX_TAGS || has(t)) return;
    onChange([...value, t]);
  };
  const remove = (t: string) => onChange(value.filter((v) => v !== t));
  const full = value.length >= MAX_TAGS;

  return (
    <div className="rounded-md bg-muted/40 p-2">
      <ul className="flex flex-wrap items-center gap-1.5">
        {value.map((t) => (
          <li key={t} className="inline-flex min-h-11 items-center gap-1 rounded-full bg-muted pl-3 text-sm">
            {t}
            <button
              type="button"
              aria-label={`Remove tag ${t}`}
              onClick={() => remove(t)}
              disabled={disabled}
              className="inline-flex h-11 w-9 items-center justify-center rounded-full text-muted-foreground hover:text-foreground"
            >
              ×
            </button>
          </li>
        ))}
        <li className="min-w-[8rem] flex-1">
          <input
            value={draft}
            disabled={disabled || full}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === ",") {
                e.preventDefault();
                add(draft);
              } else if (e.key === "Backspace" && draft === "" && value.length > 0) {
                remove(value[value.length - 1]);
              }
            }}
            onBlur={() => add(draft)}
            placeholder={full ? `Tag limit (${MAX_TAGS}) reached` : "Add a tag, press Enter"}
            aria-label="Add tag"
            className="h-11 w-full bg-transparent px-1 text-sm outline-none"
          />
        </li>
      </ul>
      {matches.length > 0 && (
        <ul className="mt-1 flex flex-wrap gap-1" aria-label="Tag suggestions">
          {matches.map((s) => (
            <li key={s}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => add(s)}
                className="min-h-11 rounded-full bg-background px-3 text-sm text-muted-foreground hover:text-foreground"
              >
                {s}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
