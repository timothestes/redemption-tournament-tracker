import { forgotPasswordAction } from "../../../app/actions";
import { FormMessage, Message } from "../../../components/form-message";
import { SubmitButton } from "../../../components/submit-button";
import { Input } from "../../../components/ui/input";
import { Label } from "../../../components/ui/label";
import Link from "next/link";

export default async function ForgotPassword(props: {
  searchParams: Promise<Message>;
}) {
  const searchParams = await props.searchParams;
  return (
    <div className="w-full">
      <h1 className="text-2xl font-semibold mb-3 text-gray-900 dark:text-white">Reset Password</h1>
      <p className="text-sm text-gray-700 dark:text-gray-300 mb-6">
        Already have an account?{" "}
        <Link className="text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 font-medium underline" href="/sign-in">
          Sign in
        </Link>
      </p>
      
      <form className="flex flex-col w-full">
        <div className="space-y-6 mb-8">
          <div className="space-y-3">
            <Label htmlFor="email" className="text-gray-800 dark:text-gray-200 font-medium text-base">Email</Label>
            <Input 
              name="email" 
              id="email"
              placeholder="you@example.com" 
              required 
              className="bg-white dark:bg-zinc-800 border-gray-300 dark:border-zinc-700 text-gray-900 dark:text-white w-full focus:ring-2 focus:ring-blue-500 h-11"
            />
          </div>
        </div>
        
        <SubmitButton 
          className="w-full bg-gray-800 hover:bg-gray-900 text-white py-3 font-medium rounded-md transition-all duration-200 shadow-md border border-gray-700 mt-4 text-base"
          // @ts-ignore
          formAction={forgotPasswordAction}>
          Reset Password
        </SubmitButton>
        
        <FormMessage message={searchParams} />
      </form>
    </div>
  );
}
