import Link from "next/link";

/**
 * Top-level tab strip across the two public results surfaces.
 *
 * Real routes rather than client state, matching the per-event tabs: each view
 * is linkable and server-rendered. The active tab is marked by a tonal surface
 * and a weight shift — the design system forbids 1px sectioning rules, and
 * green is reserved for hover and CTAs rather than resting state.
 */
export default function ResultsSectionTabs({
  active,
}: {
  active: "events" | "metagame";
}) {
  const tabs = [
    { key: "events" as const, label: "Events", href: "/tournaments/results" },
    { key: "metagame" as const, label: "Metagame", href: "/tournaments/metagame" },
  ];

  return (
    <div className="mb-6 flex w-full gap-1 rounded-lg bg-muted/50 p-1 sm:inline-flex sm:w-auto">
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
