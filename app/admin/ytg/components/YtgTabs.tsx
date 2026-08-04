"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { label: "Import Sets", href: "/admin/ytg/import" },
  { label: "Products", href: "/admin/ytg/products" },
  { label: "Matching", href: "/admin/ytg/matching" },
  { label: "Decks", href: "/admin/ytg/decks" },
];

export default function YtgTabs() {
  const pathname = usePathname();

  return (
    <nav aria-label="YTG Store sections" className="flex gap-1 mb-6 overflow-x-auto rounded-md bg-card p-1">
      {TABS.map((tab) => {
        const active = pathname?.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={`px-3 py-2 rounded-md text-sm font-medium whitespace-nowrap transition-colors ${
              active
                ? "bg-muted text-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
