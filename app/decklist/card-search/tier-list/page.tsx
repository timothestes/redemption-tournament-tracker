import { Metadata } from "next";
import { Suspense } from "react";
import TierListClient from "./client";

export const metadata: Metadata = {
  title: "Tier List Maker",
  description: "Rank Redemption CCG cards into tiers and export the result as an image",
};

export default function Page() {
  return (
    <Suspense>
      <TierListClient />
    </Suspense>
  );
}
