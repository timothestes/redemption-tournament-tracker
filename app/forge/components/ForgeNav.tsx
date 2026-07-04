"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Inlined (not imported from lib/auth) so this client component never pulls the
// server-only supabase client into the browser bundle.
type ForgeRole = "superadmin" | "elder" | "playtester";

type NavItem = { href: string; label: string; match: (p: string) => boolean };

export default function ForgeNav({ role }: { role: ForgeRole }) {
  const pathname = usePathname() ?? "";

  const items: NavItem[] =
    role === "playtester"
      ? [
          { href: "/forge/play", label: "Sets", match: (p) => p === "/forge/play" || /^\/forge\/play\/[^/]+$/.test(p) },
          { href: "/forge/play/decks", label: "Decks", match: (p) => p.startsWith("/forge/play/decks") },
        ]
      : [
          { href: "/forge/ideas", label: "Ideas", match: (p) => p.startsWith("/forge/ideas") },
          { href: "/forge/sets", label: "Sets", match: (p) => p.startsWith("/forge/sets") },
          { href: "/forge/play", label: "Play", match: (p) => p.startsWith("/forge/play") },
          { href: "/forge/missives", label: "Missives", match: (p) => p.startsWith("/forge/missives") },
          ...(role === "superadmin"
            ? [{ href: "/forge/admin", label: "Admin", match: (p: string) => p.startsWith("/forge/admin") }]
            : []),
        ];

  return (
    <div className="sticky top-16 z-40 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <div className="mx-auto flex max-w-6xl items-center gap-1 px-4">
        <Link
          href="/forge"
          className="mr-3 shrink-0 py-3 text-sm font-semibold tracking-wide text-foreground"
          style={{ fontFamily: "Cinzel, serif" }}
        >
          The Forge
        </Link>
        <nav className="flex items-center gap-1 overflow-x-auto">
          {items.map((it) => {
            const active = it.match(pathname);
            return (
              <Link
                key={it.href}
                href={it.href}
                aria-current={active ? "page" : undefined}
                className={`whitespace-nowrap border-b-2 px-3 py-3 text-sm transition-colors ${
                  active
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                {it.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
