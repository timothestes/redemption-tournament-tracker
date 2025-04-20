import { signInAction } from "../../../app/actions";
import { FormMessage, Message } from "../../../components/form-message";
import { SubmitButton } from "../../../components/submit-button";
import { Input } from "../../../components/ui/input";
import { Label } from "../../../components/ui/label";
import Link from "next/link";

type SearchParams = {
  email?: string;
  error?: string;
}

export default async function Login({ 
  searchParams 
}: { 
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  // Clean up the email parameter by removing any query string portions
  const emailValue = params.email?.split('?')[0] || '';
  const message: Message | undefined = params.error 
    ? { error: decodeURIComponent(params.error) }
    : undefined;
  
  return (
    <form className="flex-1 flex flex-col min-w-64">
      <h1 className="text-2xl font-medium">Sign in</h1>
      <p className="text-sm text-foreground">
        Don't have an account?{" "}
        <Link className="text-foreground font-medium underline" href="/sign-up">
          Sign up
        </Link>
      </p>
      <div className="flex flex-col gap-2 [&>input]:mb-3 mt-8">
        <Label htmlFor="email">Email</Label>
        <Input name="email" placeholder="you@example.com" required defaultValue={emailValue} />
        <div className="flex justify-between items-center">
          <Label htmlFor="password">Password</Label>
          <Link
            className="text-xs text-foreground underline"
            href="/forgot-password"
          >
            Forgot Password?
          </Link>
        </div>
        <Input
          type="password"
          name="password"
          placeholder="Your password"
          required
        />
        <SubmitButton pendingText="Signing In..."
          // @ts-ignore
          formAction={signInAction}>
          Sign in
        </SubmitButton>
        <FormMessage message={message} />
      </div>
    </form>
  );
}
