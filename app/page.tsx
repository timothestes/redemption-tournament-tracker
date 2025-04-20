import Header from "../components/header";
import Hero from "../components/hero";
import ConnectSupabaseSteps from "../components/tutorial/connect-supabase-steps";
import SignUpUserSteps from "../components/tutorial/sign-up-user-steps";
import { hasEnvVars } from "../utils/supabase/check-env-vars";
import Link from "next/link";

export default async function Index() {
  return (
    <div className="flex-1 w-full overflow-hidden flex flex-col gap-8 items-center">
      <Header />
      <div className="flex flex-col justify-center items-center w-full gap-6">
        <Hero />
        <main className="flex-1 flex flex-col gap-4 px-4 text-center w-full">
          <h2 className="font-medium text-xl mb-2 text-center">New Here?</h2>
          <div className="flex flex-col gap-3 items-center">
            <Link 
              href="/decklist/generate"
              className="text-lg hover:underline text-blue-500"
            >
              Generate a deck check sheet
            </Link>
            <div className="text-lg">or</div>
          </div>
          {hasEnvVars ? <SignUpUserSteps /> : <ConnectSupabaseSteps />}
        </main>
      </div>
    </div>
  );
}
