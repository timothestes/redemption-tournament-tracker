import { signUpAction } from "../../../app/actions";
import { FormMessage, Message } from "../../../components/form-message";
import { SubmitButton } from "../../../components/submit-button";
import { Input } from "../../../components/ui/input";
import { Label } from "../../../components/ui/label";
import Link from "next/link";

export default async function Signup(props: {
  searchParams: Promise<Message>;
}) {
  const searchParams = await props.searchParams;
  if ("message" in searchParams) {
    return (
      <div className="w-full">
        <FormMessage message={searchParams} />
      </div>
    );
  }

  return (
    <div className="w-full">
      <h1 className="text-2xl font-medium mb-2 text-white">Sign up</h1>
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
          
          <div className="space-y-2">
            <Label htmlFor="password" className="text-white">Password</Label>
            <Input
              type="password"
              name="password"
              id="password"
              placeholder="Your password"
              minLength={6}
              required
              className="bg-zinc-800 border-zinc-700 text-white w-full"
            />
          </div>
        </div>
        
        <SubmitButton
          className="w-full bg-white hover:bg-gray-200 text-black py-2 font-medium rounded-md"
          // @ts-ignore
          formAction={signUpAction}
          pendingText="Signing up..."
        >
          Sign up
        </SubmitButton>
        
        <FormMessage message={searchParams} />
      </form>
    </div>
  );
}
