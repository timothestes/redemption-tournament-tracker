"use client";

import { useEffect, useState } from "react";
import { parseStatInput, type StatValue } from "@/app/forge/lib/designCard";

// Text input for a stat that may be a number, "X", or a paired dual-side value
// like "6 (0)". Holds a local draft so partially-typed text ("6 (") isn't
// clobbered by the controlled snapshot value — commits upward only when the
// text parses (or empties); blur resyncs an abandoned draft to the saved value.
export default function StatInput({
  value,
  onCommit,
  className,
}: {
  value: StatValue | undefined;
  onCommit: (v: StatValue) => void;
  className?: string;
}) {
  const [draft, setDraft] = useState(value == null ? "" : String(value));
  useEffect(() => { setDraft(value == null ? "" : String(value)); }, [value]);
  return (
    <input
      type="text"
      placeholder="6 · X · 6 (0)"
      value={draft}
      className={className}
      onChange={(e) => {
        const t = e.target.value;
        setDraft(t);
        const parsed = parseStatInput(t);
        if (parsed !== null || t.trim() === "") onCommit(parsed);
      }}
      onBlur={() => setDraft(value == null ? "" : String(value))}
    />
  );
}
