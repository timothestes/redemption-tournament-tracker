"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { hasEnvVars } from "../utils/supabase/check-env-vars";
import { EnvVarWarning } from "./env-var-warning";
import Link from "next/link";
import { Button } from "./ui/button";


export default function Header() {
  const { theme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const currentTheme = mounted ? (theme === 'system' ? resolvedTheme : theme) : 'light';
  const logoSrc = currentTheme === 'light'
    ? '/lightmode_redemptionccgapp.webp'
    : '/darkmode_redemptionccgapp.webp';

  return (
    <nav className="w-full flex justify-center border-b border-b-foreground/10 h-17 bg-white dark:bg-gray-900">
      <div className="w-full max-w-1xl flex justify-between items-center p-3 px-5 text-sm">
        <div className="flex gap-5 items-center font-semibold">
          <Link href="/decklist/community">
            <img src={logoSrc} className="w-48" alt="RedemptionCCG App Logo" />
          </Link>
        </div>
        <div className="flex items-center gap-3">
          {!hasEnvVars && <EnvVarWarning />}
          <Button asChild size="sm" variant="outline">
            <Link href="/sign-in">Sign in</Link>
          </Button>
          <Button asChild size="sm" variant="default">
            <Link href="/sign-up">Sign up</Link>
          </Button>
        </div>
      </div>
    </nav>
  );
}
