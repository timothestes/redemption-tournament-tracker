import { Metadata } from "next";
import { Suspense } from "react";
import CardSearchClient from "./client";

export const metadata: Metadata = {
  title: "Card Search",
  description: "Search Redemption CCG cards dynamically",
};

export default function Page() {
  return (
    <Suspense>
      <CardSearchClient />
    </Suspense>
  );
}
