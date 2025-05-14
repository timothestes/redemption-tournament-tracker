"use client";

import React, { useEffect, useState } from "react";
import { useTheme } from "next-themes";

const Background: React.FC<{ children?: React.ReactNode }> = ({ children }) => {
  const { theme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  
  // Only run on client to avoid hydration mismatch
  useEffect(() => {
    setMounted(true);
  }, []);

  // Don't render anything until client-side to avoid hydration mismatch
  if (!mounted) {
    return <div className="min-h-screen w-full">{children}</div>;
  }

  const currentTheme = theme === 'system' ? resolvedTheme : theme;
  const isLightTheme = currentTheme === 'light';

  return (
    <div
      className="min-h-screen w-full relative"
      style={
        isLightTheme 
          ? {
              backgroundImage: "linear-gradient(to right, rgba(243,244,246,1), rgba(255,255,255,1), rgba(243,244,246,1))",
              backgroundSize: "cover",
            }
          : {
              backgroundImage: "url('/lor-login-splash.webp')",
              backgroundSize: "cover",
              backgroundPosition: "center",
              transformOrigin: "center",
            }
      }
    >
      {/* Only add dark overlay for dark mode */}
      {!isLightTheme && <div className="absolute inset-0 bg-black bg-opacity-60"></div>}
      <div className="relative z-10">{children}</div>
    </div>
  );
};

export default Background;
