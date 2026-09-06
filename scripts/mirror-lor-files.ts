// Mirror files from the landofredemption.com backup to Vercel Blob under the same pathname
// scheme the WordPress import used (`wp/wp-content/uploads/...`), so a file linked from an
// article and the same file linked from the tracker share one URL.
//
//   npx tsx scripts/mirror-lor-files.ts --backup /abs/path/to/public_html \
//     https://landofredemption.com/wp-content/uploads/2026/03/REG_PDF_11.0.0.pdf [...more]
//
// Accepts full landofredemption.com URLs or bare site paths (/wp-content/uploads/...).
// Idempotent: a file already in the store is reported as "exists" and not re-uploaded.
// Needs NEXT_PUBLIC_BLOB_BASE_URL and BLOB_READ_WRITE_TOKEN (read from .env.local).
import { config } from "dotenv";
config({ path: ".env.local" });
import { parseArgs } from "node:util";
import { mirrorMedia, planMedia } from "./lib/wxr/media";
import { siteFilePath } from "./lib/wxr/urls";

async function main() {
  const { values, positionals } = parseArgs({
    options: { backup: { type: "string" } },
    allowPositionals: true,
  });

  const blobBase = process.env.NEXT_PUBLIC_BLOB_BASE_URL;
  if (!blobBase) throw new Error("Missing NEXT_PUBLIC_BLOB_BASE_URL");
  if (!process.env.BLOB_READ_WRITE_TOKEN) throw new Error("Missing BLOB_READ_WRITE_TOKEN");
  if (!values.backup) throw new Error("Missing --backup <dir> (the public_html backup)");
  if (positionals.length === 0) throw new Error("Give at least one file URL or site path");

  const sitePaths = positionals.map((arg) => {
    const p = arg.startsWith("/") ? arg : siteFilePath(arg);
    if (!p) throw new Error(`Not a landofredemption.com file URL: ${arg}`);
    return p;
  });

  const manifest = planMedia(sitePaths, values.backup, blobBase);
  await mirrorMedia(manifest, { backupDir: values.backup, concurrency: 4, log: (s) => console.error(s) });

  let failed = 0;
  for (const [sitePath, e] of Object.entries(manifest)) {
    if (e.status !== "exists" && e.status !== "uploaded") failed++;
    console.log(`${e.status.padEnd(8)} ${sitePath}\n         ${e.url}`);
  }
  if (failed) {
    console.error(`${failed} file(s) not mirrored`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
