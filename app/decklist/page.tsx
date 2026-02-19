import { redirect } from "next/navigation";
import { createClient } from "../../utils/supabase/server";

export default async function DecklistPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (user) {
    redirect("/decklist/my-decks");
  } else {
    redirect("/decklist/card-search");
  }
}
