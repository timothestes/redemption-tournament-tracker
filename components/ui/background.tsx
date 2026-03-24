"use client";

import React from "react";
import { usePathname } from "next/navigation";
import Image from "next/image";

// Routes where the background image is fully covered and doesn't need to render
const SKIP_BACKGROUND_PREFIXES = ["/decklist/", "/tracker/", "/admin/"];

const Background: React.FC<{ children?: React.ReactNode }> = ({ children }) => {
  const pathname = usePathname();

  const skipBackground = SKIP_BACKGROUND_PREFIXES.some(prefix => pathname.startsWith(prefix));

  if (skipBackground) {
    return (
      <div className="min-h-screen w-full bg-white dark:bg-gray-900">
        {children}
      </div>
    );
  }

  return (
    <div className="min-h-screen w-full relative">
      {/* Solid background behind nav area */}
      <div className="fixed inset-x-0 top-0 h-14 bg-white dark:bg-gray-900 z-0" />

      {/* Hero image container — starts below the nav */}
      <div className="fixed inset-x-0 top-14 bottom-0 overflow-hidden">
        {/* Base background color */}
        <div className="absolute inset-0 bg-white dark:bg-gray-900" />

        {/* Hero image — CSS-only theme handling, no JS state needed */}
        <Image
          src="/lor-login-splash.webp"
          alt=""
          fill
          sizes="100vw"
          className="object-cover object-top opacity-10 dark:opacity-75 brightness-[1.8] contrast-[0.7] saturate-[0.3] blur-[1.5px] dark:brightness-[1.05] dark:contrast-[0.95] dark:saturate-100 dark:blur-0"
          priority
        />

        {/* Overlay — light gets white wash, dark gets dark wash */}
        <div className="absolute inset-0 bg-white/50 mix-blend-overlay dark:bg-black/40 dark:mix-blend-normal" />

        {/* Bottom vignette */}
        <div className="absolute inset-0 bg-gradient-to-t from-gray-300/10 dark:from-black/40 via-transparent to-transparent" />

        {/* Bottom gradient */}
        <div className="absolute inset-x-0 bottom-0 h-3/4 bg-gradient-to-t from-gray-200/10 dark:from-black/30 via-transparent to-transparent" />

        {/* Depth gradient */}
        <div className="absolute inset-0 pointer-events-none bg-gradient-to-t from-black/[0.08] dark:from-black/35 via-black/[0.03] dark:via-black/15 via-35% dark:via-40% to-transparent to-65% dark:to-80%" />
      </div>

      <div className="relative z-10">{children}</div>
    </div>
  );
};

export default Background;
