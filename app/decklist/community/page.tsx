import { Metadata } from "next";
import CommunityClient from "./client";

export const metadata: Metadata = {
  title: "Community Decks",
  description: "Browse public Redemption decks shared by the community",
};

export default function CommunityDecksPage() {
  return <CommunityClient />;
}
