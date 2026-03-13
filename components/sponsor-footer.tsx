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
      <div className="border-t border-border/50">
        <div className="max-w-screen-xl mx-auto px-4 py-4 flex flex-col items-center gap-2">
          <span className="text-[11px] font-medium uppercase tracking-[0.15em] text-muted-foreground/50">
            Sponsored by
          </span>
          <div className="flex items-center justify-center gap-8">
            {sponsors.map((sponsor) => (
              <a
                key={sponsor.name}
                href={sponsor.href}
                target="_blank"
                rel="noopener noreferrer"
                className="group relative flex items-center justify-center opacity-60 hover:opacity-100 transition-opacity duration-200"
                aria-label={`Visit ${sponsor.name}`}
              >
                <Image
                  src={isDark ? sponsor.logoDark : sponsor.logoLight}
                  alt={sponsor.name}
                  width={sponsor.width}
                  height={sponsor.height}
                  className="h-12 w-auto object-contain"
                  style={{ opacity: mounted ? 1 : 0 }}
                />
              </a>
            ))}
          </div>
        </div>
      </div>
    </footer>
  );
}
