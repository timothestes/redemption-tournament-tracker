import { Metadata } from "next";
import CardSearchClient from "./client";

export const metadata: Metadata = {
  title: "Card Search",
  description: "Search Redemption CCG cards dynamically",
};

export default function Page() {
  return <CardSearchClient />;
}
