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
      <h1 className="text-2xl font-medium mb-2 text-black dark:text-white">Sign in</h1>
      <p className="text-sm text-gray-600 dark:text-gray-400 mb-6">
        Don't have an account?{" "}
        <Link className="text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 font-medium underline" href="/sign-up">
          Sign up
        </Link>
      </p>
      
      <form className="flex flex-col w-full">
        <div className="space-y-4 mb-6">
          <div className="space-y-2">
            <Label htmlFor="email" className="text-gray-800 dark:text-gray-200">Email</Label>
            <Input 
              name="email" 
              id="email"
              placeholder="you@example.com" 
              required 
              defaultValue={emailValue} 
              className="bg-white dark:bg-zinc-800 border-gray-300 dark:border-zinc-700 text-gray-900 dark:text-white w-full focus:ring-2 focus:ring-blue-500"
            />
          </div>
          
          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <Label htmlFor="password" className="text-gray-800 dark:text-gray-200">Password</Label>
              <Link
                className="text-xs text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 font-medium"
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
              className="bg-white dark:bg-zinc-800 border-gray-300 dark:border-zinc-700 text-gray-900 dark:text-white w-full focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>
        
        <SubmitButton 
          pendingText="Signing In..."
          className="w-full bg-gray-800 hover:bg-gray-900 text-white py-2 font-medium rounded-md transition-all duration-200 shadow-md border border-gray-700"
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
