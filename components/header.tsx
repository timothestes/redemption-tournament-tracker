"use client";

import { hasEnvVars } from "../utils/supabase/check-env-vars";
import { EnvVarWarning } from "./env-var-warning";

export default function Header() {
  return (
    <nav className="w-full flex justify-center border-b border-b-foreground/10 h-17">
      <div className="w-full max-w-1xl flex justify-between items-center p-3 px-5 text-sm">
        <div className="flex gap-5 items-center font-semibold">
          <div className="flex items-center">
            <img src="/lor-lightmode.png" className="w-48 block dark:hidden" alt="Land of Redemption Logo" />
            <img src="/lor.png" className="w-48 hidden dark:block" alt="Land of Redemption Logo" />
          </div>
        </div>
        {!hasEnvVars && <EnvVarWarning />}
      </div>
    </nav>
  );
}
