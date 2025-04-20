import Link from "next/link";
import { TutorialStep } from "./tutorial-step";

export default function SignUpUserSteps() {
  return (
    <ol className="flex flex-col gap-8">
      <TutorialStep title="Sign up to host a tournament">
        <p className="text-center">
          Only users that are{" "}
          <Link
            href="/sign-up"
            className="font-bold hover:underline text-blue-500"
          >
            signed up
          </Link>{" "}
          can host a tournament
        </p>
      </TutorialStep>
    </ol>
  );
}
