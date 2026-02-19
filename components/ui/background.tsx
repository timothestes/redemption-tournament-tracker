"use client";

import React, { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import Image from "next/image";

const Background: React.FC<{ children?: React.ReactNode }> = ({ children }) => {
  const { theme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  
  // Only run on client to avoid hydration mismatch
  useEffect(() => {
    setMounted(true);
  }, []);

  // Use a safe default for server-side rendering and initial load
  const currentTheme = mounted ? (theme === 'system' ? resolvedTheme : theme) : 'light';
  const isLightTheme = currentTheme === 'light';

  return (
    <div className="min-h-screen w-full relative">
      {/* Different background styling based on theme */}
      <div className="absolute inset-0 overflow-hidden">
        {/* Base background color - pure white for maximum light mode contrast */}
        <div className="absolute inset-0 bg-white dark:bg-gray-900"></div>
        
        {/* Image background with extremely reduced opacity for light mode */}
        <Image
          src="/lor-login-splash.webp"
          alt="Background"
          fill
          sizes="100vw"
          className={`object-cover ${isLightTheme ? 'opacity-10' : 'opacity-75'}`}
          style={{
            filter: isLightTheme 
              ? 'brightness(1.8) contrast(0.7) saturate(0.3) blur(1.5px)' 
              : 'brightness(1.05) contrast(0.95)'
          }}
          priority
          placeholder="blur"
          blurDataURL="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxIiBoZWlnaHQ9IjEiPjxyZWN0IHdpZHRoPSIxIiBoZWlnaHQ9IjEiIGZpbGw9IiNmZmZmZmYiLz48L3N2Zz4="
        />
        
        {/* White overlay for light mode to further enhance readability */}
        <div className={`absolute inset-0 ${isLightTheme ? 'bg-white/50 mix-blend-overlay' : 'bg-black/40'}`}></div>
        
        {/* Almost imperceptible bottom vignette for light mode */}
        <div className="absolute inset-0 bg-gradient-to-t from-gray-300/10 dark:from-black/40 via-transparent to-transparent"></div>
        
        {/* Extremely subtle bottom gradient for light mode */}
        <div className="absolute inset-x-0 bottom-0 h-3/4 bg-gradient-to-t from-gray-200/10 dark:from-black/30 via-transparent to-transparent"></div>
        
        {/* Custom gradient with minimal opacity for light mode */}
        <div style={{
            position: 'absolute',
            top: '0px',
            right: '0px',
            bottom: '0px',
            left: '0px',
            backgroundImage: isLightTheme
              ? 'linear-gradient(to top, rgba(0, 0, 0, 0.08) 0%, rgba(0, 0, 0, 0.03) 35%, transparent 65%)'
              : 'linear-gradient(to top, rgba(0, 0, 0, 0.35) 0%, rgba(0, 0, 0, 0.15) 40%, transparent 80%)',
            pointerEvents: 'none',
          }}></div>
      </div>
      
      <div className="relative z-10">{children}</div>
    </div>
  );
};

export default Background;
