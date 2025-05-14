"use client";

import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import Image from "next/image";

export default function Header() {
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  // Only run on client to avoid hydration mismatch
  useEffect(() => {
    setMounted(true);
  }, []);

  const isLightMode = mounted && resolvedTheme === 'light';

  return (
    <div className="flex flex-col gap-6 items-center text-center">
      <div className="flex gap-8 justify-center items-center mb-4">
        <Image 
          src={isLightMode ? "/lor-lightmode.png" : "/lor.png"} 
          alt="Land of Redemption Logo" 
          width={300} 
          height={100} 
          className="max-w-full"
        />
      </div>
      <h1 className="sr-only">Welcome message</h1>
      <p className="text-3xl lg:text-4xl !leading-tight mx-auto max-w-xl text-center text-gray-800 dark:text-white">
        A new way to host{" "}
        <span className="font-bold text-4xl lg:text-5xl text-gray-900 dark:text-white">
          Redemption Tournaments
        </span>
      </p>
      <div className="w-full p-[1px] bg-gradient-to-r from-transparent via-foreground/10 to-transparent my-4" />
    </div>
  );
}
