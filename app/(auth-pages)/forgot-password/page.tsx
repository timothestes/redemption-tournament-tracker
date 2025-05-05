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
      <h1 className="text-2xl font-medium mb-2 text-white">Reset Password</h1>
      <p className="text-sm text-gray-400 mb-6">
        Already have an account?{" "}
        <Link className="text-white hover:text-gray-200 underline" href="/sign-in">
          Sign in
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
              className="bg-zinc-800 border-zinc-700 text-white w-full"
            />
          </div>
        </div>
        
        <SubmitButton 
          className="w-full bg-white hover:bg-gray-200 text-black py-2 font-medium rounded-md"
          // @ts-ignore
          formAction={forgotPasswordAction}>
          Reset Password
        </SubmitButton>
        
        <FormMessage message={searchParams} />
      </form>
    </div>
  );
}
