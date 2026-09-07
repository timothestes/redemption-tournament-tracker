/**
 * Replays the captured WordPress URL inventory against a tracker host and asserts
 * each URL's final status (following ≤5 redirect hops) matches the expectation.
 * Usage: npx tsx scripts/verify-lor-redirects.ts --base http://localhost:3103
 *        npx tsx scripts/verify-lor-redirects.ts --base https://landofredemption.com
 */
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";

type Entry = { url: string; expect: 200 | 404 };
const { values } = parseArgs({ options: { base: { type: "string" }, concurrency: { type: "string", default: "10" } } });
if (!values.base) throw new Error("--base <url> is required");
const base = values.base.replace(/\/$/, "");

async function finalStatus(url: string): Promise<number> {
  let current = url;
  for (let hop = 0; hop < 6; hop++) {
    const res = await fetch(current, { redirect: "manual" });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) return res.status;
      current = new URL(loc, current).toString();
      continue;
    }
    return res.status;
  }
  return 599; // redirect loop / too many hops
}

async function main() {
  const entries: Entry[] = JSON.parse(readFileSync("scripts/data/lor-url-inventory.json", "utf8"));
  const failures: { url: string; expect: number; got: number }[] = [];
  let done = 0;
  const queue = [...entries];
  const workers = Array.from({ length: Number(values.concurrency) }, async () => {
    for (let e = queue.shift(); e; e = queue.shift()) {
      const mapped = e.url.replace(/^https?:\/\/landofredemption\.com/, base);
      const got = await finalStatus(mapped);
      if (got !== e.expect) failures.push({ url: mapped, expect: e.expect, got });
      if (++done % 250 === 0) console.log(`${done}/${entries.length}...`);
    }
  });
  await Promise.all(workers);
  if (failures.length) {
    console.error(`\n${failures.length} FAILURES:`);
    for (const f of failures.slice(0, 60)) console.error(` expect ${f.expect} got ${f.got}  ${f.url}`);
    if (failures.length > 60) console.error(` ...and ${failures.length - 60} more`);
    process.exit(1);
  }
  console.log(`all ${entries.length} URLs behave as expected against ${base}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
