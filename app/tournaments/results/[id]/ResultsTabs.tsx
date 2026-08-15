import Link from "next/link";

/**
 * Tab strip shared by the two public views of a finished tournament.
 *
 * These are real routes rather than client state so each view is linkable and
 * server-rendered. The active tab is marked by a tonal surface and a weight
 * shift — the design system forbids 1px sectioning rules, and green is reserved
 * for hover and CTAs rather than resting state.
 */
export default function ResultsTabs({
  tournamentId,
  active,
  showBreakdown,
}: {
  tournamentId: string;
  active: "standings" | "breakdown";
  showBreakdown: boolean;
}) {
  if (!showBreakdown) return null;

  const tabs = [
    { key: "standings" as const, label: "Standings", href: `/tournaments/results/${tournamentId}` },
    { key: "breakdown" as const, label: "Breakdown", href: `/tournaments/results/${tournamentId}/breakdown` },
  ];

  return (
    <div className="mb-6 flex w-full gap-1 rounded-lg bg-muted/50 p-1 sm:w-auto sm:inline-flex">
      {tabs.map((tab) => {
        const isActive = tab.key === active;
        return (
          <Link
            key={tab.key}
            href={tab.href}
            aria-current={isActive ? "page" : undefined}
            className={`flex-1 rounded-md px-4 py-2 text-center text-sm transition-colors sm:flex-none ${
              isActive
                ? "bg-card font-semibold text-foreground shadow-sm"
                : "font-medium text-muted-foreground hover:text-foreground"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
