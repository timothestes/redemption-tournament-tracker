import { Metadata } from "next";

export const metadata: Metadata = {
  title: "Decklist",
  description: "Decklist generation and management",
};

export default function DecklistLayout() {
  return (
    <div className="flex-1 w-full flex flex-col gap-20 items-center">
      <div className="w-full">
        <h1 className="text-3xl font-bold mb-8">Decklist</h1>
      </div>
    </div>
  );
}