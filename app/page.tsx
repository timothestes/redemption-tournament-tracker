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
          <div className="bg-white/90 dark:bg-black/80 p-8 rounded-lg shadow-lg border border-gray-200 dark:border-zinc-800 max-w-lg mx-auto">
            <h2 className="font-medium text-2xl mb-4 text-center text-gray-800 dark:text-white">New Here?</h2>
            <div className="flex flex-col gap-4 items-center">
              <Link 
                href="/decklist/generate"
                className="text-lg hover:underline text-blue-600 dark:text-blue-400 font-medium transition-all duration-200 hover:text-blue-800 dark:hover:text-blue-300"
              >
                Generate a deck check sheet
              </Link>
              <div className="text-lg text-gray-700 dark:text-gray-300">or</div>
            </div>
            {hasEnvVars ? <SignUpUserSteps /> : <ConnectSupabaseSteps />}
          </div>
        </main>
      </div>
    </div>
  );
}
