import { createClient } from "../../utils/supabase/server";
import { redirect } from "next/navigation";

export default async function ProtectedPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return redirect("/sign-in");
  }

  return (
    <div className="flex flex-1 w-full">
      <nav className="w-64 bg-gray-800 text-white p-4">
        <ul>
          <li className="mb-2">
            <a href="#" className="hover:underline">
              Tournaments
            </a>
          </li>
        </ul>
      </nav>
      <div className="flex-1 flex flex-col gap-12 p-4">
        <div className="w-full">
        </div>
        <div className="flex flex-col gap-2 items-start">
          <h2 className="font-bold text-2xl mb-4">Your user details</h2>
          <pre className="text-xs font-mono p-3 rounded border max-h-32 overflow-auto">
            {JSON.stringify(user, null, 2)}
          </pre>
        </div>
        <div>
        </div>
      </div>
    </div>
  );
}
