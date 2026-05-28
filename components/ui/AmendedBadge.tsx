"use client";

import { useState } from "react";

interface Props {
  round: number;
  editedAt: string; // ISO timestamp
}

export function AmendedBadge({ round, editedAt }: Props) {
  const [show, setShow] = useState(false);
  const date = new Date(editedAt).toLocaleDateString();
  return (
    <span
      role="status"
      tabIndex={0}
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
      onFocus={() => setShow(true)}
      onBlur={() => setShow(false)}
      onClick={() => setShow(s => !s)}
      className="relative inline-flex items-center px-1.5 py-0.5 ml-2 text-xs font-medium rounded-md bg-muted text-muted-foreground hover:bg-muted/70 cursor-help"
    >
      amended
      {show && (
        <span className="absolute z-10 top-full left-0 mt-1 px-2 py-1 text-xs rounded-md bg-popover text-popover-foreground border border-border shadow-sm whitespace-nowrap">
          Round {round} result repaired by host on {date}
        </span>
      )}
    </span>
  );
}
