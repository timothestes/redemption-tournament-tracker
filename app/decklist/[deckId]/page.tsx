import { Metadata } from "next";
import { notFound } from "next/navigation";
import { loadPublicDeckAction } from "../actions";
import PublicDeckClient from "./client";

interface PageProps {
  params: Promise<{ deckId: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { deckId } = await params;
  const result = await loadPublicDeckAction(deckId);

  if (!result.success || !result.deck) {
    return { title: "Deck Not Found" };
  }

  const deck = result.deck;
  const cards = deck.cards || [];
  const mainCards = cards.filter((c: any) => !c.is_reserve);
  const cardCount = mainCards.reduce((sum: number, c: any) => sum + c.quantity, 0);
  const reserveCount = cards.filter((c: any) => c.is_reserve).reduce((sum: number, c: any) => sum + c.quantity, 0);
  const format = deck.format || "Type 1";
  const description = [
    `${format} deck with ${cardCount} cards`,
    reserveCount > 0 ? `+ ${reserveCount} reserve` : "",
    deck.description || "",
  ].filter(Boolean).join(" · ");

  // Pick an OG image: use stored preview card, fall back to first card
  const blobBase = process.env.NEXT_PUBLIC_BLOB_BASE_URL;
  let ogImage: string | undefined;
  if (blobBase) {
    const previewImg = deck.preview_card_1 || mainCards[0]?.card_img_file;
    if (previewImg) {
      const sanitized = previewImg.replace(/\.jpe?g$/i, "");
      ogImage = `${blobBase}/card-images/${sanitized}.jpg`;
    }
  }

  return {
    title: `${deck.name} - Redemption Decklist`,
    description,
    openGraph: {
      title: deck.name,
      description,
      type: "article",
      siteName: "Redemption Tournament Tracker",
      ...(ogImage && {
        images: [{ url: ogImage, width: 375, height: 525, alt: deck.name }],
      }),
    },
    twitter: {
      card: ogImage ? "summary_large_image" : "summary",
      title: deck.name,
      description,
      ...(ogImage && { images: [ogImage] }),
    },
  };
}

export default async function PublicDeckPage({ params }: PageProps) {
  const { deckId } = await params;
  const result = await loadPublicDeckAction(deckId);

  if (!result.success || !result.deck) {
    if (result.error === "This deck is private") {
      return (
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="text-center">
            <svg className="mx-auto h-16 w-16 text-gray-400 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
            <h1 className="text-2xl font-bold mb-2">This deck is private</h1>
            <p className="text-gray-600 dark:text-gray-400">The owner has made this deck private.</p>
          </div>
        </div>
      );
    }
    notFound();
  }

  return (
    <PublicDeckClient
      deck={result.deck}
      isOwner={result.isOwner ?? false}
    />
  );
}
