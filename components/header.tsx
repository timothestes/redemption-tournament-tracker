import { HomeIcon } from "lucide-react";
import { hasEnvVars } from "../utils/supabase/check-env-vars";
import HeaderAuth, { AuthLogo } from "../components/header-auth";

export default function Header() {
  return (
    <nav className="w-full flex justify-center border-b border-b-foreground/10 h-17">
      <div className="w-full max-w-1xl flex justify-between items-center p-3 px-5 text-sm">
        <div className="flex gap-5 items-center font-semibold">
          {
            // @ts-ignore
            <AuthLogo />
          }
        </div>
        {
          // @ts-ignore
          !hasEnvVars ? <EnvVarWarning /> : <HeaderAuth />
        }
      </div>
    </nav>
  );
}
