"use client";

import { hasEnvVars } from "../utils/supabase/check-env-vars";
import { EnvVarWarning } from "./env-var-warning";

export default function HeaderServer() {
  // Only render if there's a warning to show
  if (hasEnvVars) {
    return null;
  }

  return (
    <div className="w-full flex justify-center border-b border-b-foreground/10">
      <div className="w-full max-w-1xl flex justify-center items-center p-3 text-sm">
        <EnvVarWarning />
      </div>
    </div>
  );
}