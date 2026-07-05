"use client";

import { useRef } from "react";
import { Button } from "@/components/ui/button";

// Design-system replacement for a bare <input type="file">: an outline button
// that opens the OS picker, with an optional hint line beside it.
export default function FilePicker({
  label,
  accept,
  disabled,
  onFile,
  hint,
}: {
  label: string;
  accept?: string;
  disabled?: boolean;
  onFile: (file: File) => void;
  hint?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = "";
        }}
      />
      <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => inputRef.current?.click()}>
        {label}
      </Button>
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </div>
  );
}
