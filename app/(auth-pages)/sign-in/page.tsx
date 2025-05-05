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
    <div className="w-full">
      <h1 className="text-2xl font-medium mb-2 text-white">Sign in</h1>
      <p className="text-sm text-gray-400 mb-6">
        Don't have an account?{" "}
        <Link className="text-white hover:text-gray-200 underline" href="/sign-up">
          Sign up
        </Link>
      </p>
      
      <form className="flex flex-col w-full">
        <div className="space-y-4 mb-6">
          <div className="space-y-2">
            <Label htmlFor="email" className="text-white">Email</Label>
            <Input 
              name="email" 
              id="email"
              placeholder="you@example.com" 
              required 
              defaultValue={emailValue} 
              className="bg-zinc-800 border-zinc-700 text-white w-full"
            />
          </div>
          
          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <Label htmlFor="password" className="text-white">Password</Label>
              <Link
                className="text-xs text-gray-400 hover:text-white"
                href="/forgot-password"
              >
                Forgot Password?
              </Link>
            </div>
            <Input
              type="password"
              name="password"
              id="password"
              placeholder="Your password"
              required
              className="bg-zinc-800 border-zinc-700 text-white w-full"
            />
          </div>
        </div>
        
        <SubmitButton 
          pendingText="Signing In..."
          className="w-full bg-white hover:bg-gray-200 text-black py-2 font-medium rounded-md"
          // @ts-ignore
          formAction={signInAction}
        >
          Sign in
        </SubmitButton>
        
        <FormMessage message={message} />
      </form>
    </div>
  );
}
