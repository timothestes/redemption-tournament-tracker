"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export default function SetTabs({ setId }: { setId: string }) {
  const pathname = usePathname() ?? "";
  const tabs = [
    { href: `/forge/sets/${setId}/cards`, label: "Cards" },
    { href: `/forge/sets/${setId}/notes`, label: "Notes" },
    { href: `/forge/sets/${setId}/progress`, label: "Progress" },
    { href: `/forge/sets/${setId}/review`, label: "Review" },
  ];
  return (
    <nav className="mt-2 flex gap-1 text-sm">
      {tabs.map((t) => {
        const active = pathname.startsWith(t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={`rounded-md px-2.5 py-1 transition-colors ${
              active ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
