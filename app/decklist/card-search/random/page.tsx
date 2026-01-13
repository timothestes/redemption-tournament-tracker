import { Metadata } from "next";
import RandomCardClient from "./client";

export const metadata: Metadata = {
  title: "Random Card",
  description: "Get a random Redemption CCG card",
};

export default function Page() {
  return <RandomCardClient />;
}
