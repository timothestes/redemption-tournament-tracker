"use client";

import { useState, useEffect } from "react";
import { useTheme } from "next-themes";
import Image from "next/image";

interface Sponsor {
  name: string;
  href: string;
  logoDark: string;
  logoLight: string;
  width: number;
  height: number;
}

const sponsors: Sponsor[] = [
  {
    name: "Your Turn Games",
    href: "https://www.yourturngames.biz",
    logoDark: "/sponsors/ytg-dark.png",
    logoLight: "/sponsors/ytg-light.png",
    width: 100,
    height: 100,
  },
];

export default function SponsorFooter() {
  const { theme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const isDark = mounted && (theme === "system" ? resolvedTheme : theme) === "dark";

  return (
    <footer className="w-full mt-auto">
      {/* Ornamental separator */}
      <div className="flex items-center justify-center gap-2 px-8">
        <div className="h-px flex-1 max-w-16 bg-gradient-to-r from-transparent to-border/60" />
        <div className="w-0.5 h-0.5 rounded-full bg-border/60" />
        <div className="h-px flex-1 max-w-16 bg-gradient-to-l from-transparent to-border/60" />
      </div>

      <div className="max-w-screen-xl mx-auto px-4 py-3 flex flex-col items-center gap-1.5">
        <span className="font-cinzel text-[10px] uppercase tracking-[0.2em] text-muted-foreground/60 select-none">
          Sponsored by
        </span>

        <div className="flex items-center justify-center gap-8">
          {sponsors.map((sponsor) => (
            <a
              key={sponsor.name}
              href={sponsor.href}
              target="_blank"
              rel="noopener noreferrer"
              className="group relative flex items-center justify-center opacity-60 hover:opacity-100 hover:scale-[1.04] transition-all duration-200"
              aria-label={`Visit ${sponsor.name}`}
            >
              <div className="absolute inset-0 rounded-lg bg-foreground/[0.03] opacity-0 group-hover:opacity-100 scale-110 blur-xl transition-opacity duration-300" />
              <Image
                src={isDark ? sponsor.logoDark : sponsor.logoLight}
                alt={sponsor.name}
                width={sponsor.width}
                height={sponsor.height}
                className="relative h-8 w-auto object-contain transition-[filter] duration-300 group-hover:drop-shadow-[0_0_8px_rgba(128,128,128,0.15)]"
                style={{ opacity: mounted ? 1 : 0 }}
              />
            </a>
          ))}
        </div>
      </div>
    </footer>
  );
}
