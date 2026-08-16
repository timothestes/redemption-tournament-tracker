import Link from "next/link";
import {
  METAGAME_FORMATS,
  METAGAME_FORMAT_LABELS,
  METAGAME_WINDOWS,
  type MetagameFormatId,
} from "@/lib/tournament/metagameFilters";

/**
 * Format and time-window pickers.
 *
 * Plain links over URL params rather than client state: the filters are the
 * whole identity of the view, so a reader who finds something worth arguing
 * about can paste the address and the other person sees the same numbers.
 * Nothing here needs JavaScript.
 */
export default function MetagameFilters({
  format,
  days,
}: {
  format: MetagameFormatId;
  days: number;
}) {
  const href = (nextFormat: MetagameFormatId, nextDays: number) =>
    `/tournaments/metagame?format=${nextFormat}&days=${nextDays}`;

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-6">
      <FilterRow label="Format">
        {METAGAME_FORMATS.map((id) => (
          <FilterLink key={id} href={href(id, days)} isActive={id === format}>
            {METAGAME_FORMAT_LABELS[id]}
          </FilterLink>
        ))}
      </FilterRow>

      <FilterRow label="Window">
        {METAGAME_WINDOWS.map((window) => (
          <FilterLink
            key={window.days}
            href={href(format, window.days)}
            isActive={window.days === days}
          >
            {window.label}
          </FilterLink>
        ))}
      </FilterRow>
    </div>
  );
}

function FilterRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-[0.65rem] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
        {label}
      </span>
      <div className="inline-flex flex-wrap gap-1 rounded-lg bg-muted/50 p-0.5">{children}</div>
    </div>
  );
}

function FilterLink({
  href,
  isActive,
  children,
}: {
  href: string;
  isActive: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={isActive ? "true" : undefined}
      className={`rounded-md px-2.5 py-1 text-xs transition-colors ${
        isActive
          ? "bg-card font-semibold text-foreground shadow-sm"
          : "font-medium text-muted-foreground hover:text-foreground"
      }`}
    >
      {children}
    </Link>
  );
}
