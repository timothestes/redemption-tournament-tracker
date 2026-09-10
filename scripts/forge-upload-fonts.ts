// Upload the printed card faces to the PRIVATE forge Blob store so the member-only
// /forge/api/fonts/[face] route can stream them to the card preview. The fonts are
// licensed and never committed: they live in gitignored tmp/ — SYMPHOBL.TTF is Symphony
// Black (titles) and grail.ttf is Grail Light (stats). Keys match forgeFontKey() in
// app/forge/lib/art.ts. After re-uploading, bump ?v= in app/forge/forge-fonts.css so
// members' browsers drop their cached copy.
//
//   make forge-fonts   (= npx tsx scripts/forge-upload-fonts.ts [dir], dir defaults to tmp/)
import { config } from "dotenv";
config({ path: ".env.local" });

import { readFileSync } from "fs";
import { put } from "@vercel/blob";

// Same hybrid as forgeAuth in app/forge/lib/art.ts (not imported: that module reads env at load).
const auth = process.env.FORGE_BLOB_READ_WRITE_TOKEN
  ? { token: process.env.FORGE_BLOB_READ_WRITE_TOKEN }
  : { storeId: process.env.FORGE_BLOB_STORE_ID! };

const DIR = process.argv[2] ?? "tmp";
const FONTS = { title: `${DIR}/SYMPHOBL.TTF`, stat: `${DIR}/grail.ttf` } as const;

async function main() {
  for (const [face, file] of Object.entries(FONTS)) {
    const data = readFileSync(file);
    const blob = await put(`forge-fonts/${face}.ttf`, data, {
      access: "private",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: "font/ttf",
      ...auth,
    });
    console.log(`${face}: ${file} (${data.length} bytes) -> ${blob.pathname}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
