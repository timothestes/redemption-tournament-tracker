import Header from "../components/header";
import Hero from "../components/hero";
import ConnectSupabaseSteps from "../components/tutorial/connect-supabase-steps";
import SignUpUserSteps from "../components/tutorial/sign-up-user-steps";
import { hasEnvVars } from "../utils/supabase/check-env-vars";

export default async function Index() {
  return (
    <div className="flex-1 w-full overflow-hidden flex flex-col gap-20 items-center">
      <Header />
      <div className="flex flex-col justify-center items-center w-full">
        <Hero />
        <main className="flex-1 flex flex-col gap-6 px-4 mt-16">
          <h2 className="font-medium text-xl mb-4">New Here?</h2>
          {hasEnvVars ? <SignUpUserSteps /> : <ConnectSupabaseSteps />}
        </main>
      </div>
    </div>
  );
}
