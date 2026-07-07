# Forge Image Normalization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Normalize every Forge card image at upload time (trim white print-bleed margins, cap at 1050px tall, re-encode JPEG) and backfill existing odd-sized blobs, so all cards render at the same visual size.

**Architecture:** A single server-only normalizer module (`sharp`) is called from the two blob-upload helpers in `app/forge/lib/art.ts` — the choke point every upload path (studio actions, Lackey import) already flows through. A one-off `scripts/` backfill runs the same normalizer over every blob referenced by `forge_cards`/`card_versions`.

**Tech Stack:** Next.js 15 server actions, `sharp`, Vercel Blob (private store via `@vercel/blob`), Supabase (`@supabase/supabase-js` service role in the script), Vitest.

**Spec:** `docs/superpowers/specs/2026-07-06-forge-image-normalization-design.md`

## Global Constraints

- Never import server-only modules (`app/forge/lib/art.ts`, `imageNormalize.ts`) into `"use client"` files.
- Never upscale images; never re-encode already-conforming JPEGs (byte-identical passthrough).
- Trim only fires when ALL four corner pixels are near-white (each RGB channel ≥ 240 after flattening alpha onto white); trim threshold 25; degenerate-trim guard at 60% of original per axis.
- Output is always JPEG quality 85 (mozjpeg) unless the passthrough applies.
- Height cap: 1050px.
- Tests: Vitest, run with `npx vitest run <path>`. Generate image fixtures in-test with sharp — no binary fixtures in the repo.
- Match existing code style; commits end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: Normalizer module + unit tests

**Files:**
- Create: `app/forge/lib/imageNormalize.ts`
- Test: `app/forge/lib/__tests__/imageNormalize.test.ts`
- Modify: `package.json` (add `sharp` dependency)

**Interfaces:**
- Consumes: nothing (leaf module; only `sharp`).
- Produces: `normalizeCardImage(input: Buffer): Promise<NormalizedImage>` and `type NormalizedImage = { data: Buffer; contentType: "image/jpeg" }` — Tasks 2 and 3 import exactly these from `@/app/forge/lib/imageNormalize` (Task 3 via relative path).

- [ ] **Step 1: Install sharp**

```bash
cd /Users/timestes/projects/redemption-tournament-tracker && npm install sharp
```

Expected: `sharp` appears under `dependencies` in package.json (version ^0.34.x).

- [ ] **Step 2: Write the failing test**

Create `app/forge/lib/__tests__/imageNormalize.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { normalizeCardImage } from "../imageNormalize";

const DARK = { r: 60, g: 20, b: 20 };

/** Solid dark block, encoded as requested. */
function solid(width: number, height: number, format: "png" | "jpeg"): Promise<Buffer> {
  const img = sharp({ create: { width, height, channels: 3, background: DARK } });
  return format === "png" ? img.png().toBuffer() : img.jpeg({ quality: 90 }).toBuffer();
}

/** Dark content block centered on a white canvas (print-bleed style). */
async function withWhiteMargins(canvasW: number, canvasH: number, contentW: number, contentH: number): Promise<Buffer> {
  const content = await sharp({ create: { width: contentW, height: contentH, channels: 3, background: DARK } }).png().toBuffer();
  return sharp({ create: { width: canvasW, height: canvasH, channels: 3, background: "#ffffff" } })
    .composite([{ input: content, top: Math.floor((canvasH - contentH) / 2), left: Math.floor((canvasW - contentW) / 2) }])
    .png()
    .toBuffer();
}

async function dims(buf: Buffer): Promise<{ width?: number; height?: number; format?: string }> {
  const m = await sharp(buf).metadata();
  return { width: m.width, height: m.height, format: m.format };
}

describe("normalizeCardImage", () => {
  it("trims white print-bleed margins and re-encodes as JPEG", async () => {
    const input = await withWhiteMargins(815, 1125, 750, 1046);
    const out = await normalizeCardImage(input);
    const d = await dims(out.data);
    expect(out.contentType).toBe("image/jpeg");
    expect(d.format).toBe("jpeg");
    expect(Math.abs((d.width ?? 0) - 750)).toBeLessThanOrEqual(4);
    expect(Math.abs((d.height ?? 0) - 1046)).toBeLessThanOrEqual(4);
  });

  it("does not trim full-bleed images with dark corners (corner gate)", async () => {
    const input = await solid(700, 980, "png");
    const out = await normalizeCardImage(input);
    const d = await dims(out.data);
    expect(d.width).toBe(700);
    expect(d.height).toBe(980);
    expect(d.format).toBe("jpeg"); // PNG input is still re-encoded
  });

  it("downscales oversized images to 1050px tall, preserving aspect", async () => {
    const input = await solid(750, 1500, "png");
    const out = await normalizeCardImage(input);
    const d = await dims(out.data);
    expect(d.height).toBe(1050);
    expect(d.width).toBe(525);
  });

  it("returns already-conforming JPEGs byte-identical (no generation loss)", async () => {
    const input = await solid(345, 495, "jpeg");
    const out = await normalizeCardImage(input);
    expect(out.data.equals(input)).toBe(true);
    expect(out.contentType).toBe("image/jpeg");
  });

  it("keeps original dimensions when trim would be degenerate (near-all-white input)", async () => {
    const input = await withWhiteMargins(600, 800, 50, 50); // tiny dot on white
    const out = await normalizeCardImage(input);
    const d = await dims(out.data);
    expect(d.width).toBe(600);
    expect(d.height).toBe(800);
  });

  it("throws on undecodable input", async () => {
    await expect(normalizeCardImage(Buffer.from("not an image"))).rejects.toThrow();
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run app/forge/lib/__tests__/imageNormalize.test.ts`
Expected: FAIL — cannot resolve `../imageNormalize`.

- [ ] **Step 4: Write the implementation**

Create `app/forge/lib/imageNormalize.ts`:

```ts
// Server-only: normalizes Forge card images at upload time so every stored
// image is flush (no baked-in print-bleed margins), at most 1050px tall, and
// JPEG-encoded. Design: docs/superpowers/specs/2026-07-06-forge-image-normalization-design.md
import sharp from "sharp";

export type NormalizedImage = { data: Buffer; contentType: "image/jpeg" };

const MAX_HEIGHT = 1050;
const CORNER_WHITE_MIN = 240; // per-channel floor for a corner to count as "white margin"
const TRIM_THRESHOLD = 25;
const MIN_TRIM_RATIO = 0.6; // trim keeping less than this per axis is degenerate
const JPEG_QUALITY = 85;

/** True when all four corners are near-white after flattening alpha onto white. */
async function cornersNearWhite(img: sharp.Sharp): Promise<boolean> {
  const { data, info } = await img
    .clone()
    .flatten({ background: "#ffffff" })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const px = (x: number, y: number): number[] => {
    const i = (y * info.width + x) * info.channels;
    return [data[i], data[i + 1], data[i + 2]];
  };
  return [
    px(0, 0),
    px(info.width - 1, 0),
    px(0, info.height - 1),
    px(info.width - 1, info.height - 1),
  ].every((corner) => corner.every((channel) => channel >= CORNER_WHITE_MIN));
}

export async function normalizeCardImage(input: Buffer): Promise<NormalizedImage> {
  const meta = await sharp(input).metadata(); // throws on undecodable input
  if (!meta.width || !meta.height) throw new Error("Could not read image");
  const base = sharp(input).rotate(); // apply EXIF orientation

  // Corner-gated margin trim: white print-bleed margins only. Full-bleed card
  // images have dark frame corners, so the gate skips them and the border
  // ring survives; trimming against an explicit white background can never
  // eat a dark frame either way.
  let working: sharp.Sharp | null = null;
  let trimmed = false;
  if (await cornersNearWhite(base)) {
    try {
      const { data, info } = await base
        .clone()
        .flatten({ background: "#ffffff" })
        .trim({ background: "#ffffff", threshold: TRIM_THRESHOLD })
        .toBuffer({ resolveWithObject: true });
      const shrank = info.width < meta.width || info.height < meta.height;
      const degenerate =
        info.width < meta.width * MIN_TRIM_RATIO || info.height < meta.height * MIN_TRIM_RATIO;
      if (shrank && !degenerate) {
        working = sharp(data);
        trimmed = true;
      }
    } catch {
      // trim of an (almost) uniform image can fail — treat as nothing to trim
    }
  }

  // Passthrough: already JPEG, small enough, upright, nothing trimmed — return
  // the original bytes so re-runs and the backfill cause no generation loss.
  const upright = meta.orientation === undefined || meta.orientation === 1;
  if (!trimmed && meta.format === "jpeg" && meta.height <= MAX_HEIGHT && upright) {
    return { data: input, contentType: "image/jpeg" };
  }

  const data = await (working ?? base)
    .resize({ height: MAX_HEIGHT, withoutEnlargement: true })
    .flatten({ background: "#ffffff" })
    .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
    .toBuffer();
  return { data, contentType: "image/jpeg" };
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run app/forge/lib/__tests__/imageNormalize.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json app/forge/lib/imageNormalize.ts app/forge/lib/__tests__/imageNormalize.test.ts
git commit -m "feat(forge): image normalizer — trim white margins, cap 1050px, JPEG

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Wire the normalizer into the upload helpers

**Files:**
- Modify: `app/forge/lib/art.ts` (uploadForgeArt lines 42-51, uploadForgeFinished lines 54-63)
- Modify: `app/forge/lib/cards.ts` (uploadArt line 48, uploadFinished line 72, stale comment line 49)
- Test: create `app/forge/lib/__tests__/art.test.ts`; extend `app/forge/lib/__tests__/cards.test.ts`

**Interfaces:**
- Consumes: `normalizeCardImage(input: Buffer): Promise<{ data: Buffer; contentType: "image/jpeg" }>` from `@/app/forge/lib/imageNormalize` (Task 1).
- Produces: `uploadForgeArt(file: File): Promise<string>` / `uploadForgeFinished(file: File): Promise<string>` — signatures unchanged, but they now store normalized JPEG bytes and REJECT (throw) on undecodable input. The studio actions return `{ ok: false, error: "Could not read image file." }` in that case.

- [ ] **Step 1: Write the failing tests**

Create `app/forge/lib/__tests__/art.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@vercel/blob", () => ({ put: vi.fn(), get: vi.fn(), del: vi.fn() }));
vi.mock("@/app/forge/lib/imageNormalize", () => ({ normalizeCardImage: vi.fn() }));

import { put } from "@vercel/blob";
import { normalizeCardImage } from "@/app/forge/lib/imageNormalize";
import { uploadForgeArt, uploadForgeFinished } from "../art";

const file = new File([new Uint8Array([1, 2, 3])], "art.png", { type: "image/png" });

beforeEach(() => {
  vi.clearAllMocks();
  (put as any).mockResolvedValue({ pathname: "forge-art/some-key" });
  (normalizeCardImage as any).mockResolvedValue({
    data: Buffer.from("normalized"),
    contentType: "image/jpeg",
  });
});

describe("uploadForgeArt / uploadForgeFinished", () => {
  it("uploads the NORMALIZED bytes as image/jpeg, not the original file", async () => {
    await uploadForgeArt(file);
    const [key, body, opts] = (put as any).mock.calls[0];
    expect(String(key)).toMatch(/^forge-art\//);
    expect(Buffer.from(body).toString()).toBe("normalized");
    expect(opts.contentType).toBe("image/jpeg");
  });

  it("uploadForgeFinished stores under forge-finished/ with normalized bytes", async () => {
    (put as any).mockResolvedValue({ pathname: "forge-finished/some-key" });
    await uploadForgeFinished(file);
    const [key, body, opts] = (put as any).mock.calls[0];
    expect(String(key)).toMatch(/^forge-finished\//);
    expect(Buffer.from(body).toString()).toBe("normalized");
    expect(opts.contentType).toBe("image/jpeg");
  });

  it("propagates decode failures without uploading anything", async () => {
    (normalizeCardImage as any).mockRejectedValue(new Error("unsupported image format"));
    await expect(uploadForgeArt(file)).rejects.toThrow();
    expect(put).not.toHaveBeenCalled();
  });
});
```

Extend `app/forge/lib/__tests__/cards.test.ts` — add `uploadForgeArt` and `uploadArt` to the existing imports on lines 8-9 (`validateArtFile, uploadForgeArt, uploadForgeFinished` from `@/app/forge/lib/art`; `uploadArt, uploadFinished` from `../cards` — the `lib/art` mock on line 5 already stubs all three), then append this describe block:

```ts
describe("upload decode failures", () => {
  it("uploadArt returns a clear error when the image cannot be decoded", async () => {
    const c = ctx();
    (requireElder as any).mockResolvedValue(c);
    (validateArtFile as any).mockReturnValue(null);
    (uploadForgeArt as any).mockRejectedValue(new Error("unsupported image format"));
    const fd = new FormData();
    fd.set("file", new File([new Uint8Array([1, 2, 3])], "a.png", { type: "image/png" }));
    expect(await uploadArt("c1", fd)).toEqual({ ok: false, error: "Could not read image file." });
  });

  it("uploadFinished returns a clear error when the image cannot be decoded", async () => {
    const c = ctx();
    (requireElder as any).mockResolvedValue(c);
    (validateArtFile as any).mockReturnValue(null);
    (uploadForgeFinished as any).mockRejectedValue(new Error("unsupported image format"));
    const fd = new FormData();
    fd.set("file", new File([new Uint8Array([1, 2, 3])], "c.png", { type: "image/png" }));
    expect(await uploadFinished("c1", fd)).toEqual({ ok: false, error: "Could not read image file." });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run app/forge/lib/__tests__/art.test.ts app/forge/lib/__tests__/cards.test.ts`
Expected: art.test.ts FAILS (put still receives the original file / decode-failure test rejects nothing); the two new cards tests FAIL (currently the rejection propagates as an unhandled throw instead of `{ ok: false, ... }`).

- [ ] **Step 3: Implement**

In `app/forge/lib/art.ts`, add the import and rewrite the two upload helpers (leave `validateArtFile`, `readForgeArt`, `deleteForgeArt` untouched):

```ts
import { normalizeCardImage } from "@/app/forge/lib/imageNormalize";
```

```ts
/**
 * Normalize (trim white print-bleed margins, cap 1050px tall, re-encode JPEG)
 * and upload to the PRIVATE blob store under an unguessable UUID key.
 * Throws if the file cannot be decoded as an image. Returns the stored pathname.
 */
export async function uploadForgeArt(file: File): Promise<string> {
  const normalized = await normalizeCardImage(Buffer.from(await file.arrayBuffer()));
  const key = `${ART_PREFIX}${randomUUID()}`;
  const blob = await put(key, normalized.data, {
    access: "private",
    addRandomSuffix: false,
    ...forgeAuth,
    contentType: normalized.contentType,
  });
  return blob.pathname;
}

/** Same normalization + upload for finished-card images under forge-finished/. */
export async function uploadForgeFinished(file: File): Promise<string> {
  const normalized = await normalizeCardImage(Buffer.from(await file.arrayBuffer()));
  const key = `${FINISHED_PREFIX}${randomUUID()}`;
  const blob = await put(key, normalized.data, {
    access: "private",
    addRandomSuffix: false,
    ...forgeAuth,
    contentType: normalized.contentType,
  });
  return blob.pathname;
}
```

In `app/forge/lib/cards.ts` — `uploadArt` (line 48): replace

```ts
  const key = await uploadForgeArt(file);
  // No image processing in 1a.3: the uploaded file IS the original.
```

with

```ts
  let key: string;
  try {
    key = await uploadForgeArt(file);
  } catch {
    return { ok: false, error: "Could not read image file." };
  }
  // Art is normalized at upload (trim/resize/JPEG); original_key mirrors the stored key.
```

and `uploadFinished` (line 72): replace `const key = await uploadForgeFinished(file);` with

```ts
  let key: string;
  try {
    key = await uploadForgeFinished(file);
  } catch {
    return { ok: false, error: "Could not read image file." };
  }
```

- [ ] **Step 4: Run the forge test suite**

Run: `npx vitest run app/forge/lib/__tests__/`
Expected: art.test.ts, cards.test.ts, imageNormalize.test.ts all PASS. Note: `members.test.ts` and `sets.test.ts` have 2 pre-existing failures on main — ignore those two, they are not yours to fix.

- [ ] **Step 5: Verify the production build (sharp/RSC bundling)**

Run: `npm run build`
Expected: build succeeds. If it fails with a sharp module-load/bundling error, add `"sharp"` to the `serverExternalPackages` array in `next.config.js` (same treatment as `@vercel/blob`) and re-run.

- [ ] **Step 6: Commit**

```bash
git add app/forge/lib/art.ts app/forge/lib/cards.ts app/forge/lib/__tests__/art.test.ts app/forge/lib/__tests__/cards.test.ts
git commit -m "feat(forge): normalize card images at upload via the art helpers

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

(Include `next.config.js` in the add if Step 5 modified it.)

---

### Task 3: Backfill script (dry-run verified)

**Files:**
- Create: `scripts/forge-normalize-images.ts`

**Interfaces:**
- Consumes: `normalizeCardImage` from `../app/forge/lib/imageNormalize` (relative import — tsx does not resolve the `@/` alias).
- Produces: a manually-run CLI. `npx tsx scripts/forge-normalize-images.ts` = dry-run (default, prints plan, writes nothing); `--apply` executes. NOT imported by app code.

- [ ] **Step 1: Write the script**

Create `scripts/forge-normalize-images.ts`:

```ts
/**
 * One-off backfill: run every blob referenced by forge_cards/card_versions
 * through the Forge image normalizer (trim white print-bleed margins, cap
 * 1050px tall, re-encode JPEG). Conforming blobs are skipped byte-identically.
 * Rewritten images get a NEW key; referencing rows are re-pointed and the
 * card's updated_at is touched (busts the working-view `t` cache param).
 * Also sweeps 44 known-orphaned 1x1 blobs (2026-07-06 survey), re-verified
 * unreferenced at run time.
 *
 * Design: docs/superpowers/specs/2026-07-06-forge-image-normalization-design.md
 *
 * Usage: npx tsx scripts/forge-normalize-images.ts [--apply]
 * Default is dry-run: prints the plan, writes nothing.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { randomUUID } from "crypto";
import { createClient } from "@supabase/supabase-js";
import { put, get, del } from "@vercel/blob";
import { normalizeCardImage } from "../app/forge/lib/imageNormalize";

const APPLY = process.argv.includes("--apply");

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);
const auth = process.env.FORGE_BLOB_READ_WRITE_TOKEN
  ? { token: process.env.FORGE_BLOB_READ_WRITE_TOKEN }
  : { storeId: process.env.FORGE_BLOB_STORE_ID! };

type Ref = { table: "forge_cards" | "card_versions"; id: string; column: string; cardId: string };

// Orphaned 1x1 JPEG blobs found in the 2026-07-06 store survey. None are
// referenced by forge_cards or card_versions (verified then and re-verified
// against live refs below before deletion).
const ORPHANED_1X1: string[] = [
  "forge-finished/022d0513-7a80-4f88-8726-f9768fb58837",
  "forge-finished/035b56cd-469a-410d-9487-ef0afa3cf8b0",
  "forge-finished/04c17b40-b699-4189-b9c9-2a148d003d98",
  "forge-finished/087c415c-fe60-415b-b4cf-0d6a7ebf1deb",
  "forge-finished/098fea86-a8d6-4468-a0c2-9d8f00adb4ca",
  "forge-finished/1918ce3f-41d1-4f47-b49d-c76e922591ca",
  "forge-finished/1c72f871-5eaa-4ad6-9bf6-890f6ace9ef1",
  "forge-finished/1d84410e-14cd-42ef-af63-b69412946d00",
  "forge-finished/2c2c78cd-cc64-4b1b-a384-ea1f2e52c07b",
  "forge-finished/31431ea6-1536-41ca-bdc6-d6afd2fca203",
  "forge-finished/40d26f6a-95d6-45cc-96e4-b87c8d0afd8e",
  "forge-finished/4cbd58ad-b590-455b-8f85-e863a5febea1",
  "forge-finished/4fc72d08-d338-4e31-a6b6-7ca0e678edb7",
  "forge-finished/6b214645-356d-450e-bc48-177ecce1bd2e",
  "forge-finished/700a0e8d-117e-4fca-87cb-bceb952eca69",
  "forge-finished/75e1a10a-ae52-4463-bef4-1b9ddeda2925",
  "forge-finished/77ceee10-a2dc-4594-96b2-46649ae4d3cc",
  "forge-finished/7b47fb10-c478-49ed-bc60-137769887ced",
  "forge-finished/805141d5-c4ed-4d04-a50b-e130f13a9ab9",
  "forge-finished/8d238df4-7629-4aa7-a8cd-614f55b7dcc4",
  "forge-finished/9542375d-9279-4839-973b-7587079d7905",
  "forge-finished/99a2cf80-c2a8-430e-ace9-8c01ccec704c",
  "forge-finished/9a313283-e34a-423e-9383-9aa9c68c238e",
  "forge-finished/9eaba425-d56e-4dab-8719-032d1a9c351f",
  "forge-finished/9f141a4a-03a3-4118-b691-5cbf7289ea60",
  "forge-finished/a797a8ff-778b-42fc-b689-5cfca6b5a9c1",
  "forge-finished/b427c7a8-55cb-40e6-ba62-f8f40d5406f4",
  "forge-finished/b64a6b56-d3b5-4f81-bef0-547efebcaceb",
  "forge-finished/c19f047f-b9ae-4899-bb13-16d64137846d",
  "forge-finished/c6121e2e-6573-4411-83d7-3b76b19abb8a",
  "forge-finished/cbd4bf29-38c5-49bd-bad8-41a87f9a7f5d",
  "forge-finished/d382c831-6855-4dc4-bd1c-49bd9dfd3226",
  "forge-finished/d451d556-d37e-42de-932f-885618bb8d69",
  "forge-finished/d576be34-4700-4980-aafb-946feedeb69a",
  "forge-finished/dedc057b-00ee-45aa-b59b-f6c54177bf25",
  "forge-finished/dfff9e02-6ea8-49fc-8631-83422e3d8ee5",
  "forge-finished/ea44811a-9596-4392-adbb-dc837ab1cacf",
  "forge-finished/e996aa36-e969-44b7-9d45-da8b846efc89",
  "forge-finished/ea461c64-0168-4eac-bb76-61bddb6c6785",
  "forge-finished/ec18221d-a1ef-4c3e-8688-a443f851c40c",
  "forge-finished/ed31e18f-2304-4a8f-be2b-4aad31607eec",
  "forge-finished/efb442d5-7e90-454d-b95c-4278cb2bba77",
  "forge-finished/f1408b2c-97b9-46d3-ac19-c7e619f59298",
  "forge-finished/fca38891-2d65-4b19-9aba-614d1aabd8da",
];

async function collectRefs(): Promise<Map<string, Ref[]>> {
  const refs = new Map<string, Ref[]>();
  const add = (key: string | null, ref: Ref) => {
    if (!key) return;
    refs.set(key, [...(refs.get(key) ?? []), ref]);
  };
  const { data: cards, error: cardsErr } = await supabase
    .from("forge_cards")
    .select("id, working_art_key, working_art_original_key, working_finished_key");
  if (cardsErr) throw cardsErr;
  for (const c of cards ?? []) {
    for (const col of ["working_art_key", "working_art_original_key", "working_finished_key"] as const) {
      add(c[col], { table: "forge_cards", id: c.id, column: col, cardId: c.id });
    }
  }
  const { data: versions, error: versionsErr } = await supabase
    .from("card_versions")
    .select("id, card_id, art_key, art_original_key, finished_key");
  if (versionsErr) throw versionsErr;
  for (const v of versions ?? []) {
    for (const col of ["art_key", "art_original_key", "finished_key"] as const) {
      add(v[col], { table: "card_versions", id: v.id, column: col, cardId: v.card_id });
    }
  }
  return refs;
}

async function download(key: string): Promise<Buffer> {
  const res = await get(key, { access: "private", ...auth });
  if (!res || res.statusCode !== 200) throw new Error(`GET ${key} -> ${res?.statusCode}`);
  const chunks: Buffer[] = [];
  for await (const chunk of res.stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

async function main() {
  const refs = await collectRefs();
  console.log(`${refs.size} referenced blob keys; mode=${APPLY ? "APPLY" : "dry-run"}`);
  let rewritten = 0, skipped = 0, failed = 0;
  const touchedCards = new Set<string>();

  for (const [key, refList] of refs) {
    let input: Buffer;
    try {
      input = await download(key);
    } catch (e) {
      console.error(`FAIL download ${key}: ${e}`);
      failed++;
      continue;
    }
    let out: Awaited<ReturnType<typeof normalizeCardImage>>;
    try {
      out = await normalizeCardImage(input);
    } catch (e) {
      console.error(`FAIL normalize ${key} (${input.length}B): ${e}`);
      failed++;
      continue;
    }
    if (out.data.equals(input)) {
      skipped++;
      continue;
    }

    console.log(
      `rewrite ${key} (${input.length}B -> ${out.data.length}B) refs=${refList
        .map((r) => `${r.table}.${r.column}`)
        .join(",")}`
    );
    rewritten++;
    if (!APPLY) continue;

    const newKey = `${key.split("/")[0]}/${randomUUID()}`;
    await put(newKey, out.data, {
      access: "private",
      addRandomSuffix: false,
      contentType: out.contentType,
      ...auth,
    });
    for (const ref of refList) {
      const { error } = await supabase
        .from(ref.table)
        .update({ [ref.column]: newKey })
        .eq("id", ref.id);
      if (error) throw new Error(`UPDATE ${ref.table}.${ref.column} for ${ref.id}: ${error.message}`);
      touchedCards.add(ref.cardId);
    }
    try {
      await del(key, { ...auth });
    } catch {
      // a dangling private+UUID blob is invisible and harmless
    }
  }

  if (APPLY) {
    for (const cardId of touchedCards) {
      const { error } = await supabase
        .from("forge_cards")
        .update({ updated_at: new Date().toISOString() })
        .eq("id", cardId);
      if (error) console.error(`FAIL touch updated_at for ${cardId}: ${error.message}`);
    }
  }

  let swept = 0;
  for (const key of ORPHANED_1X1) {
    if (refs.has(key)) {
      console.error(`SKIP orphan ${key}: now referenced!`);
      continue;
    }
    console.log(`delete orphan ${key}`);
    if (APPLY) {
      try {
        await del(key, { ...auth });
        swept++;
      } catch (e) {
        console.error(`FAIL delete orphan ${key}: ${e}`);
      }
    }
  }

  console.log(
    `done: ${rewritten} rewritten, ${skipped} conforming (skipped), ${failed} failed, ` +
      `${APPLY ? swept : ORPHANED_1X1.length} orphans ${APPLY ? "deleted" : "to delete"}`
  );
  if (failed > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 2: Dry-run against the live store (read-only)**

Run: `npx tsx scripts/forge-normalize-images.ts`
Expected output shape (counts are approximate — verify plausibility, exact numbers depend on live data):
- `~200 referenced blob keys; mode=dry-run` (176 cards + 180 versions share many keys)
- ~45 `rewrite ...` lines — the 815–825×1125 PNGs, 1047×1503 PNGs, and WebPs from the survey; each shows a large byte reduction (e.g. `940655B -> ~150000B`)
- The vast majority skipped as conforming (the 345×495 JPEGs)
- `0` failed; 44 orphan `delete orphan ...` lines
- **Sanity check:** the key `forge-finished/101dc581-ff7e-471e-8a4d-bea060df03aa` (Heavenly Temple) MUST appear as a rewrite. If more than ~60 keys rewrite, STOP and report — the conforming passthrough is not engaging.

Do NOT run `--apply` in this task — that is a deliberate post-review operational step.

- [ ] **Step 3: Commit**

```bash
git add scripts/forge-normalize-images.ts
git commit -m "feat(forge): backfill script normalizing existing card image blobs

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```
