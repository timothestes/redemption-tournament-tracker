import { Metadata } from "next";
import MyDecksClient from "./client";

export const metadata: Metadata = {
  title: "My Decks",
  description: "View and manage your Redemption deck collection",
};

export default function MyDecksPage() {
  return <MyDecksClient />;
}
