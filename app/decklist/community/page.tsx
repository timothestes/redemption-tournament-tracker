import { Metadata } from "next";
import CommunityClient from "./client";
import { loadPublicDecksAction } from "../actions";
import { createClient } from "../../../utils/supabase/server";

export const metadata: Metadata = {
  title: "Community Decks",
  description: "Browse public Redemption decks shared by the community",
};

export default async function CommunityDecksPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const result = await loadPublicDecksAction({ page: 1, pageSize: 24, sort: "newest" });
  const initialDecks = result.success ? result.decks : [];
  const initialCount = result.success ? result.totalCount : 0;

  return <CommunityClient initialDecks={initialDecks} initialCount={initialCount} currentUserId={user?.id} />;
}
