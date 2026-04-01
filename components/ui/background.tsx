"use client";

import React, { useState, useEffect } from "react";
import { usePathname } from "next/navigation";
import { useTheme } from "next-themes";
import Image from "next/image";

// Routes where the background image is fully covered and doesn't need to render
const SKIP_BACKGROUND_PREFIXES = ["/decklist/", "/tracker/", "/admin/", "/play"];

const Background: React.FC<{ children?: React.ReactNode }> = ({ children }) => {
  const pathname = usePathname();
  const { theme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  // Only run on client to avoid hydration mismatch
  useEffect(() => {
    setMounted(true);
  }, []);

  // Use a safe default for server-side rendering and initial load
  const currentTheme = mounted ? (theme === 'system' ? resolvedTheme : theme) : 'light';
  const isLightTheme = currentTheme === 'light';
  const isJaydenTheme = currentTheme === 'jayden';

  const skipBackground = SKIP_BACKGROUND_PREFIXES.some(prefix => pathname.startsWith(prefix));

  if (skipBackground) {
    return (
      <div className="min-h-screen w-full bg-background">
        {children}
      </div>
    );
  }

  return (
    <div className="min-h-screen w-full relative">
      {/* Different background styling based on theme */}
      <div className="fixed inset-0 overflow-hidden">
        {/* Base background color */}
        <div className={`absolute inset-0 ${isJaydenTheme ? 'bg-[hsl(270,20%,4%)]' : 'bg-white dark:bg-gray-900'}`}></div>

      {/* Hero image container */}
      <div className="fixed inset-x-0 top-14 bottom-0 overflow-hidden">
        {/* Base background color */}
        <div className="absolute inset-0 bg-white dark:bg-gray-900" />

        {/* Hero image */}
        <Image
          src="/lor-login-splash.webp"
          alt=""
          fill
          sizes="100vw"
          className={`object-cover object-top ${isLightTheme ? 'opacity-10' : isJaydenTheme ? 'opacity-50' : 'opacity-75'}`}
          style={{
            filter: isLightTheme
              ? 'brightness(1.8) contrast(0.7) saturate(0.3) blur(1.5px)'
              : isJaydenTheme
              ? 'brightness(0.7) contrast(1.15) saturate(2.2) hue-rotate(280deg)'
              : 'brightness(1.05) contrast(0.95)'
          }}
          priority
        />

        {/* Overlay for readability */}
        <div
          className={`absolute inset-0 ${isLightTheme ? 'bg-white/50 mix-blend-overlay' : !isJaydenTheme ? 'bg-black/40' : ''}`}
          style={isJaydenTheme ? { background: 'linear-gradient(135deg, hsla(0, 90%, 30%, 0.7) 0%, hsla(330, 85%, 35%, 0.55) 35%, hsla(270, 70%, 30%, 0.45) 60%, hsla(230, 85%, 35%, 0.7) 100%)' } : undefined}
        ></div>

        {/* Bottom vignette */}
        <div className={`absolute inset-0 bg-gradient-to-t ${isJaydenTheme ? 'from-[hsl(230,40%,5%)]/60' : 'from-gray-300/10 dark:from-black/40'} via-transparent to-transparent`}></div>

        {/* Bottom gradient */}
        <div className={`absolute inset-x-0 bottom-0 h-3/4 bg-gradient-to-t ${isJaydenTheme ? 'from-[hsl(230,40%,5%)]/50' : 'from-gray-200/10 dark:from-black/30'} via-transparent to-transparent`}></div>

        {/* Depth gradient */}
        <div style={{
            position: 'absolute',
            top: '0px',
            right: '0px',
            bottom: '0px',
            left: '0px',
            backgroundImage: isLightTheme
              ? 'linear-gradient(to top, rgba(0, 0, 0, 0.08) 0%, rgba(0, 0, 0, 0.03) 35%, transparent 65%)'
              : isJaydenTheme
              ? 'linear-gradient(135deg, rgba(120, 0, 0, 0.35) 0%, rgba(140, 0, 80, 0.15) 40%, rgba(60, 0, 120, 0.15) 60%, rgba(0, 20, 120, 0.35) 100%)'
              : 'linear-gradient(to top, rgba(0, 0, 0, 0.35) 0%, rgba(0, 0, 0, 0.15) 40%, transparent 80%)',
            pointerEvents: 'none',
          }}></div>
      </div>
      </div>

      <div className="relative z-10">{children}</div>
    </div>
  );
};

export default Background;
