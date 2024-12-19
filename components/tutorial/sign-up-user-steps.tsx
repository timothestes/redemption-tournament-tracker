import Link from "next/link";
import { TutorialStep } from "./tutorial-step";

export default function SignUpUserSteps() {
  return (
    <ol className="flex flex-col gap-6">
      <TutorialStep title="Sign up to host a tournament">
        <p>
          Only users that are{" "}
          <Link
            href="/sign-up"
            className="font-bold hover:underline text-foreground/80"
          >
            signed in
          </Link>{" "}
          can host a tournament
        </p>
      </TutorialStep>
    </ol>
  );
}
