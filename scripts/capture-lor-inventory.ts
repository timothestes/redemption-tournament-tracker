/**
 * Captures every URL WordPress advertises (wp-sitemap.xml sub-sitemaps) into
 * scripts/data/lor-url-inventory.json with the outcome the tracker must produce
 * (spec §1–2, §8). Run while the WordPress site is still up; output is committed.
 * Usage: npx tsx scripts/capture-lor-inventory.ts
 */
import { writeFileSync } from "node:fs";

type Entry = { url: string; expect: 200 | 404 };
const ORIGIN = "https://landofredemption.com";
// Group C pages + drafts: no tracker home, deliberate 404s (spec §2).
const GONE_PAGES = new Set(["activity", "access-restricted"]);
// 12 WordPress posts that were spam and were deleted from the tracker (not
// imported) on 2026-09-06. WordPress still serves them (200), so a re-capture
// would otherwise re-classify them as expect:200 and regress the inventory.
const GONE_POST_SLUGS = new Set([
  "minecraft-dungeons-official-launch-trailer",
  "beginners-guide-and-tips-for-underworld-adventurers",
  "more-advanced-gameplay-tips-and-tricks-for-valorant",
  "minecraft-dungeons-a-fun-family-friendly-romp-the-review",
  "burning-through-my-cards-of-deck-of-ashes-the-review",
  "valorant-the-art-of-execution-the-review",
  "gunsight-seeing-hunting-simulator-2-preview",
  "port-royale-4-preview",
  "the-waylanders-draggin-age-the-preview",
  "match-of-the-week-esl-xiog123-vs-kraad4",
  "match-of-the-week-esl-oppo-lv-vs-gripexx",
  "i-have-no-regrets-an-interview-with-the-esl-cup-finalist",
]);

const locs = (xml: string): string[] =>
  [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim());

function classify(url: string): Entry {
  const path = new URL(url).pathname;
  // tags + authors were never imported; /type/ is WP's post_format archive — also no home
  if (path.startsWith("/tag/") || path.startsWith("/author/") || path.startsWith("/type/")) return { url, expect: 404 };
  const slug = path.replaceAll("/", "");
  if (GONE_PAGES.has(slug)) return { url, expect: 404 };
  const segments = path.split("/").filter(Boolean);
  if (segments.length === 1 && GONE_POST_SLUGS.has(segments[0])) return { url, expect: 404 };
  return { url, expect: 200 };
}

const EXTRA: Entry[] = [
  { url: `${ORIGIN}/?p=3582`, expect: 200 },        // the ranking short link
  { url: `${ORIGIN}/?p=999999`, expect: 404 },
  { url: `${ORIGIN}/?page_id=13724`, expect: 200 }, // formats (imported page)
  { url: `${ORIGIN}/?cat=766`, expect: 200 },       // Online Play
  { url: `${ORIGIN}/?cat=424242`, expect: 404 },
  { url: `${ORIGIN}/feed/`, expect: 200 },
  { url: `${ORIGIN}/comments/feed/`, expect: 200 },
  { url: `${ORIGIN}/category/podcast/feed/`, expect: 200 },
  { url: `${ORIGIN}/wp-sitemap.xml`, expect: 200 },
  { url: `${ORIGIN}/our-sponsors/`, expect: 200 },
  { url: `${ORIGIN}/deck-lists/`, expect: 200 },
  { url: `${ORIGIN}/home-2/`, expect: 200 },
];

async function main() {
  const index = await (await fetch(`${ORIGIN}/wp-sitemap.xml`)).text();
  const subs = locs(index);
  if (subs.length === 0) throw new Error("wp-sitemap.xml returned no sub-sitemaps — is WordPress still up?");
  const entries: Entry[] = [...EXTRA];
  for (const sub of subs) {
    const xml = await (await fetch(sub)).text();
    for (const url of locs(xml)) entries.push(classify(url));
  }
  const dedup = [...new Map(entries.map((e) => [e.url, e])).values()];
  writeFileSync("scripts/data/lor-url-inventory.json", JSON.stringify(dedup, null, 1) + "\n");
  const n404 = dedup.filter((e) => e.expect === 404).length;
  console.log(`captured ${dedup.length} URLs (${n404} expected 404) from ${subs.length} sub-sitemaps`);
}
main().catch((e) => { console.error(e); process.exit(1); });
