"use client";

import { useMemo } from "react";
import ArticleBody from "@/app/articles/components/ArticleBody";
import { resolveCardRefs } from "@/app/articles/lib/cardRefs";
import { extractCardMentions } from "@/app/articles/lib/markdown";
import type { ArticleRefs } from "@/app/articles/lib/refTypes";

// A deck description, rendered by the same markdown renderer articles use, so
// `[[Card Name]]` gets the hover preview and tap-to-enlarge treatment here too.
//
// Articles resolve mentions on the server because the card index must stay off
// the client. Deck pages already ship that index for the deck itself, so the
// resolution happens right here: no server action, no round-trip, and the
// builder's preview updates as the author types.
//
// `decks` stays empty: a deck link inside a deck description remains an
// ordinary link rather than embedding a whole second decklist.
export default function DeckDescription({
  markdown,
  draft = false,
  className = "prose prose-sm dark:prose-invert max-w-none text-foreground",
}: {
  markdown: string;
  /** Editor preview: flag mentions that resolved to nothing. */
  draft?: boolean;
  className?: string;
}) {
  const refs: ArticleRefs = useMemo(
    () => ({ cards: resolveCardRefs(extractCardMentions(markdown || "")), decks: {} }),
    [markdown],
  );
  return <ArticleBody markdown={markdown} refs={refs} draft={draft} className={className} />;
}
