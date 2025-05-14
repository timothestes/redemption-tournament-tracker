import Link from "next/link";
import { TutorialStep } from "./tutorial-step";

export default function SignUpUserSteps() {
  return (
    <ol className="flex flex-col gap-8">
      <TutorialStep title="Sign up to host a tournament">
        <p className="text-center text-gray-700 dark:text-gray-300">
          Only users that are{" "}
          <Link
            href="/sign-up"
            className="font-bold hover:underline text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 transition-colors"
          >
            signed up
          </Link>{" "}
          can host a tournament
        </p>
      </TutorialStep>
    </ol>
  );
}
