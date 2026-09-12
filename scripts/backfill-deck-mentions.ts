/**
 * Wraps card names in existing deck descriptions in `[[ ]]` so they render as
 * card links (see app/decklist/components/DeckDescription.tsx).
 *
 * Only names of cards the deck actually plays are linked, once per paragraph,
 * case-sensitively, never inside code/links/URLs/headings — see
 * scripts/lib/deckMentions/linkCards.ts for the full rule set.
 *
 * Usage:
 *   npx tsx --tsconfig tsconfig.json scripts/backfill-deck-mentions.ts [--apply] [--limit N] [--deck <id>]
 *
 * DRY RUN BY DEFAULT: it writes a report to scripts/output/ and touches
 * nothing. `--apply` writes, after copying every description it is about to
 * change into the backup table (see BACKUP_TABLE) so a revert is one UPDATE.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { candidatesForDeck, isKnownCardName, resolvesTo } from "./lib/deckMentions/candidates";
import { linkCardMentions } from "./lib/deckMentions/linkCards";
import { extractCardMentions, flattenCardMentions } from "@/app/articles/lib/markdown";
import { resolveCardRef } from "@/app/articles/lib/cardRefs";
import { cardNameKey } from "@/lib/cards/nameKey";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

const BACKUP_TABLE = "deck_description_backfill_backup";
const PAGE = 500; // PostgREST caps an unbounded select at 1000 rows, silently.

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const deckArg = args.indexOf("--deck");
const only = deckArg >= 0 ? args[deckArg + 1] : undefined;
const limitArg = args.indexOf("--limit");
const limit = limitArg >= 0 ? Number(args[limitArg + 1]) : Infinity;

interface DeckRow {
  id: string;
  name: string;
  visibility: string;
  description: string;
}

async function loadDecks(): Promise<DeckRow[]> {
  const rows: DeckRow[] = [];
  for (let from = 0; ; from += PAGE) {
    let q = supabase
      .from("decks")
      .select("id, name, visibility, description")
      .not("description", "is", null)
      .neq("description", "")
      .order("id")
      .range(from, from + PAGE - 1);
    if (only) q = q.eq("id", only);
    const { data, error } = await q;
    if (error) throw error;
    rows.push(...((data ?? []) as DeckRow[]));
    if (!data || data.length < PAGE) break;
  }
  return rows;
}

async function loadCardNames(deckIds: string[]): Promise<Map<string, string[]>> {
  const byDeck = new Map<string, string[]>();
  for (let i = 0; i < deckIds.length; i += 50) {
    const chunk = deckIds.slice(i, i + 50);
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase
        .from("deck_cards")
        .select("deck_id, card_name")
        .in("deck_id", chunk)
        .range(from, from + 999);
      if (error) throw error;
      for (const row of data ?? []) {
        const list = byDeck.get(row.deck_id) ?? [];
        list.push(row.card_name);
        byDeck.set(row.deck_id, list);
      }
      if (!data || data.length < 1000) break;
    }
  }
  return byDeck;
}

/** The sentence around a wrapped name, for eyeballing the report. */
function sample(markdown: string, name: string): string {
  const at = markdown.indexOf(`[[${name}]]`);
  if (at < 0) return "";
  return markdown.slice(Math.max(0, at - 70), at + name.length + 74).replace(/\s+/g, " ").trim();
}

async function main() {
  const decks = (await loadDecks()).slice(0, limit);
  console.log(`${decks.length} deck${decks.length === 1 ? "" : "s"} with a description`);
  const cardNames = await loadCardNames(decks.map((d) => d.id));

  const changes: Array<{
    id: string;
    name: string;
    visibility: string;
    added: string[];
    before: string;
    after: string;
    samples: string[];
  }> = [];
  const perName = new Map<string, number>();

  for (const deck of decks) {
    const names = cardNames.get(deck.id) ?? [];
    if (names.length === 0) continue;
    const { markdown, added } = linkCardMentions(deck.description, candidatesForDeck(names), {
      knownName: isKnownCardName,
      resolvesTo,
    });
    if (!added.length) continue;
    // Nothing is written that the renderer would not turn back into a card: a
    // mention that fails to parse or resolve would leave visible brackets in
    // someone's description.
    // cardNameKey, not toLowerCase: the author's apostrophe may be curly where
    // the card's is straight, and the resolver treats those as one name.
    const parsed = new Set(extractCardMentions(markdown, 10_000).map(cardNameKey));
    for (const name of new Set(added)) {
      if (!parsed.has(cardNameKey(name))) throw new Error(`${deck.id}: "${name}" did not survive parsing`);
      if (!resolveCardRef(name)) throw new Error(`${deck.id}: "${name}" does not resolve to a card`);
    }
    // Only brackets (and an alias target ahead of a "|") may have appeared.
    if (flattenCardMentions(markdown) !== flattenCardMentions(deck.description)) {
      throw new Error(`${deck.id}: the backfill changed the words on the page`);
    }
    for (const n of added) perName.set(n, (perName.get(n) ?? 0) + 1);
    changes.push({
      id: deck.id,
      name: deck.name,
      visibility: deck.visibility,
      added,
      before: deck.description,
      after: markdown,
      samples: [...new Set(added)].map((n) => sample(markdown, n)).filter(Boolean),
    });
  }

  const total = changes.reduce((n, c) => n + c.added.length, 0);
  console.log(`${changes.length} decks would change, ${total} mentions added, ${perName.size} distinct cards`);

  const outDir = path.join(process.cwd(), "scripts/output");
  fs.mkdirSync(outDir, { recursive: true });
  const report = path.join(outDir, "deck-mentions-backfill.json");
  fs.writeFileSync(
    report,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        decksScanned: decks.length,
        decksChanged: changes.length,
        mentionsAdded: total,
        byName: [...perName.entries()].sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count })),
        changes,
      },
      null,
      2,
    ),
  );
  console.log(`report → ${report}`);

  if (!apply) {
    console.log("dry run — nothing written. Re-run with --apply to write.");
    return;
  }

  // Backup first: the table is the revert path, so a failure here must stop the
  // run. A deck already in the table keeps its original row — on a second pass
  // `before` is whatever is in the database now, which may already be linked.
  const { error: backupError } = await supabase
    .from(BACKUP_TABLE)
    .upsert(changes.map((c) => ({ deck_id: c.id, description: c.before })), {
      onConflict: "deck_id",
      ignoreDuplicates: true,
    });
  if (backupError) throw new Error(`backup failed, nothing written: ${backupError.message}`);
  console.log(`backed up ${changes.length} descriptions to ${BACKUP_TABLE}`);

  let written = 0;
  for (const c of changes) {
    const { error } = await supabase.from("decks").update({ description: c.after }).eq("id", c.id);
    if (error) {
      console.error(`  FAILED ${c.id} (${c.name}): ${error.message}`);
      continue;
    }
    written += 1;
  }
  console.log(`updated ${written}/${changes.length} decks`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
