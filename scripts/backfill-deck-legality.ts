/**
 * Backfill is_legal and deckcheck_issues for all decks that haven't been checked yet.
 * Requires the Next.js dev server to be running (calls /api/deckcheck).
 *
 * Usage: npx tsx scripts/backfill-deck-legality.ts [--all] [--dry-run]
 *
 * --all      Re-check all decks, not just those missing is_legal
 * --dry-run  Print results without updating the database
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const DECKCHECK_TOKEN = process.env.DECKCHECK_API_TOKEN || "";
const BASE_URL = "http://localhost:3000";

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const args = process.argv.slice(2);
const checkAll = args.includes("--all");
const dryRun = args.includes("--dry-run");

async function checkDeckViaAPI(deckId: string): Promise<{ valid: boolean; issues: any[] } | null> {
  try {
    const res = await fetch(`${BASE_URL}/api/deckcheck`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(DECKCHECK_TOKEN ? { Authorization: `Bearer ${DECKCHECK_TOKEN}` } : {}),
      },
      body: JSON.stringify({ deckId }),
    });
    if (!res.ok) {
      console.error(`    API returned ${res.status}: ${await res.text()}`);
      return null;
    }
    return await res.json();
  } catch (e) {
    console.error(`    API error:`, e);
    return null;
  }
}

async function main() {
  // Verify the dev server is running
  try {
    const ping = await fetch(BASE_URL, { method: "HEAD" });
    if (!ping.ok && ping.status !== 307) {
      console.error(`Dev server at ${BASE_URL} returned ${ping.status}. Is it running?`);
      process.exit(1);
    }
  } catch {
    console.error(`Cannot reach ${BASE_URL}. Start the dev server first: npm run dev`);
    process.exit(1);
  }

  const PAGE = 100;
  let offset = 0;
  let totalChecked = 0;
  let totalLegal = 0;
  let totalIllegal = 0;
  let totalSkipped = 0;
  let totalError = 0;

  while (true) {
    let query = supabase
      .from("decks")
      .select("id, name, format, card_count")
      .range(offset, offset + PAGE - 1)
      .order("id");

    if (!checkAll) {
      query = query.is("is_legal", null);
    }

    const { data: decks, error } = await query;
    if (error) {
      console.error("Error fetching decks:", error.message);
      break;
    }
    if (!decks || decks.length === 0) break;

    console.log(`\nProcessing batch of ${decks.length} decks (offset ${offset})...`);

    for (const deck of decks) {
      if (!deck.card_count || deck.card_count === 0) {
        totalSkipped++;
        continue;
      }

      const result = await checkDeckViaAPI(deck.id);
      if (!result) {
        totalError++;
        continue;
      }

      const status = result.valid ? "LEGAL" : "ILLEGAL";
      const issueCount = result.issues.filter((i: any) => i.type === "error").length;

      if (result.valid) totalLegal++;
      else totalIllegal++;

      console.log(`  ${status}  ${deck.name} (${deck.format || "?"}, ${deck.card_count} cards${issueCount > 0 ? `, ${issueCount} issues` : ""})`);

      if (!dryRun) {
        await supabase
          .from("decks")
          .update({
            is_legal: result.valid,
            deckcheck_issues: result.issues,
          })
          .eq("id", deck.id);
      }

      totalChecked++;
    }

    if (decks.length < PAGE) break;
    offset += PAGE;
  }

  console.log(`\nDone. Checked ${totalChecked}, skipped ${totalSkipped} empty, ${totalError} errors.`);
  console.log(`  ${totalLegal} legal, ${totalIllegal} illegal.`);
  if (dryRun) console.log("  (dry run — no database updates)");
}

main().catch(console.error);
