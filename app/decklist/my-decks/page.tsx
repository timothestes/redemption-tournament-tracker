import { Metadata } from "next";
import { redirect } from "next/navigation";
import MyDecksClient from "./client";
import { createClient } from "../../../utils/supabase/server";

export const metadata: Metadata = {
  title: "My Decks",
  description: "View and manage your Redemption deck collection",
};

export default async function MyDecksPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect("/sign-in");
  }

  return <MyDecksClient />;
}
