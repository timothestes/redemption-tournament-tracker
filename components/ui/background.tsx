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
    <div className="min-h-screen w-full relative">
      {/* Different background styling based on theme */}
      {isLightTheme ? (
        <div className="absolute inset-0 overflow-hidden">
          {/* Light base gradient */}
          <div className="absolute inset-0 bg-gradient-to-r from-gray-50 via-white to-gray-50"></div>
          
          {/* Diffused lor-login-splash.webp image for elegant light mode - with stronger visibility */}
          <div 
            className="absolute inset-0"
            style={{
              backgroundImage: "url('/lor-login-splash.webp')",
              backgroundSize: "cover",
              backgroundPosition: "center",
              filter: "brightness(1.7) contrast(0.6) saturate(0.3) blur(5px)",
              opacity: 0.2,
              mixBlendMode: "soft-light",
            }}
          />
          
          {/* Light overlay with reduced intensity to let more of the image show through */}
          <div className="absolute inset-0 bg-gradient-to-b from-white/40 to-transparent"></div>
          
          {/* Subtle radial highlight in the center */}
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-white via-transparent to-transparent opacity-40"></div>
          
          {/* Stronger texture layer with lor-login-splash */}
          <div 
            className="absolute inset-0"
            style={{
              backgroundImage: "url('/lor-login-splash.webp')",
              backgroundSize: "cover",
              backgroundPosition: "center",
              opacity: 0.12,
              filter: "contrast(0.9) brightness(1.4)",
              mixBlendMode: "color-burn",
            }}
          />
        </div>
      ) : (
        <div className="absolute inset-0 overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-r from-black/50 via-transparent to-black/50 z-[1]"></div>
          <div 
            className="absolute inset-0"
            style={{
              backgroundImage: "url('/lor-login-splash.webp')",
              backgroundSize: "cover",
              backgroundPosition: "center",
            }}
          />
          <div className="absolute inset-0 bg-black bg-opacity-50 z-[1]"></div>
        </div>
      )}
      <div className="relative z-10">{children}</div>
    </div>
  );
};

export default Background;
