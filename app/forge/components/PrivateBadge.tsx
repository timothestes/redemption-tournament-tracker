import { Lock } from "lucide-react";

// Neutral (non-green) lock chip marking a private set. Kept DRY across the sets
// grid, the set header, and the progress privacy panel.
export default function PrivateBadge({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground ${className}`}
      title="Private set — hidden from other elders"
    >
      <Lock size={10} aria-hidden />
      Private
    </span>
  );
}
