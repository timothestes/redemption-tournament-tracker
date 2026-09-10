# Forge Art Client Upload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Forge elders upload card art up to 50MB (large TIFF scans especially) without the upload hanging forever.

**Architecture:** Move the big file transfer from a Next.js Server Action (which runs as a Vercel Function, hard-capped at 4.5MB inbound) to a direct browser→Vercel-Blob upload via `@vercel/blob/client`. A tiny new route mints upload tokens (auth-gated). Once the browser's `upload()` call resolves, the client makes a normal, tiny follow-up call to the existing Server Actions — now taking a blob pathname instead of a `File` — which read the raw bytes back server-side (an outbound read, not an inbound request body, so the 4.5MB cap doesn't apply), normalize, store, and clean up the raw upload. The three upload UI surfaces get real error handling in the same pass, fixing the confirmed "permanent spinner" bug.

**Tech Stack:** Next.js 15 App Router, TypeScript, `@vercel/blob` / `@vercel/blob/client` (already a dependency, `^2.4.1`), `sharp` (via existing `normalizeCardImage`), Vitest.

**Spec:** `docs/superpowers/specs/2026-09-09-forge-art-client-upload-design.md`

## Global Constraints

- `MAX_ART_BYTES` becomes 50MB (was 15MB) — the spec's approved ceiling.
- No new auth pattern — every server-side gate reuses `requireElder()` from `app/forge/lib/auth.ts`.
- `app/forge/api/import/route.ts` (bulk Lackey import) is explicitly **out of scope** — do not touch it.
- `next.config.js` is **not touched** by this plan — its `serverActions.bodySizeLimit: '16mb'` is irrelevant to the new path and out of scope to "fix" here.
- Worktree: `/Users/timestes/projects/rtt-tiff-client-upload` (branch `feat/forge-tiff-client-upload`), already has its own `node_modules` installed (real install, not symlinked — safe to `npm install` further in this worktree if a task needs it). All file paths below are relative to that worktree root; use absolute paths (`/Users/timestes/projects/rtt-tiff-client-upload/...`) when invoking tools.
- Test runner: `node_modules/.bin/vitest run <path>` from the worktree root (already verified working).

---

### Task 1: `art.ts` — raw-upload read-back, Buffer-based store functions, 50MB cap

**Files:**
- Modify: `app/forge/lib/art.ts`
- Test: `app/forge/lib/__tests__/art.test.ts`

**Interfaces:**
- Produces: `readForgeUpload(pathname: string): Promise<Buffer | null>` — new export.
- Produces: `uploadForgeArt(input: Buffer): Promise<string>` — **signature change**, was `(file: File)`.
- Produces: `uploadForgeFinished(input: Buffer): Promise<string>` — **signature change**, was `(file: File)`.
- Produces: `MAX_ART_BYTES` now `50 * 1024 * 1024`.
- Reuses (unchanged): `deleteForgeArt(key: string): Promise<void>` — already exported, already a best-effort/non-throwing delete of any private-store key. Tasks 3 and 4 will call this on `forge-art-raw/...` pathnames too; it isn't `forge-art/`-prefix-specific despite living next to those functions.

- [ ] **Step 1: Update the test file to reflect the new behavior**

Replace the full contents of `app/forge/lib/__tests__/art.test.ts` with:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@vercel/blob", () => ({ put: vi.fn(), get: vi.fn(), del: vi.fn() }));
vi.mock("@/app/forge/lib/imageNormalize", () => ({ normalizeCardImage: vi.fn() }));

import { put, get } from "@vercel/blob";
import { normalizeCardImage } from "@/app/forge/lib/imageNormalize";
import {
  validateArtFile, MAX_ART_BYTES, uploadForgeArt, uploadForgeFinished, uploadForgeArtRaw,
  readForgeUpload,
} from "../art";

describe("validateArtFile", () => {
  it("accepts a normal PNG", () => {
    expect(validateArtFile({ type: "image/png", size: 1024 })).toBeNull();
  });

  it("rejects a non-image type", () => {
    expect(validateArtFile({ type: "application/pdf", size: 1024 })).toMatch(/Invalid file type/);
  });

  it("rejects a file over the size cap", () => {
    expect(validateArtFile({ type: "image/png", size: MAX_ART_BYTES + 1 })).toMatch(/too large/i);
  });

  it("accepts a .tif with a proper image/tiff MIME type", () => {
    expect(validateArtFile({ type: "image/tiff", size: 1024, name: "scan.tif" })).toBeNull();
  });

  it("accepts a .tiff with an empty MIME type (common browser behavior)", () => {
    expect(validateArtFile({ type: "", size: 1024, name: "scan.tiff" })).toBeNull();
  });

  it("accepts a .tif with a generic application/octet-stream MIME type", () => {
    expect(validateArtFile({ type: "application/octet-stream", size: 1024, name: "scan.tif" })).toBeNull();
  });

  it("still rejects a .png with an empty MIME type (extension fallback is TIFF-only)", () => {
    expect(validateArtFile({ type: "", size: 1024, name: "scan.png" })).toMatch(/Invalid file type/);
  });

  it("still rejects a non-image file with a .tif-like name but no name field at all", () => {
    expect(validateArtFile({ type: "application/octet-stream", size: 1024 })).toMatch(/Invalid file type/);
  });

  it("rejects a JPEG unchanged", () => {
    expect(validateArtFile({ type: "image/jpeg", size: 1024 })).toBeNull();
  });

  it("enforces the same 50MB cap for TIFF, with a TIFF-specific message", () => {
    const msg = validateArtFile({ type: "image/tiff", size: MAX_ART_BYTES + 1, name: "scan.tif" });
    expect(msg).toMatch(/tiff/i);
    expect(msg).toMatch(/50\s*MB/i);
  });

  it("names the cap 50MB, not a stale hardcoded number", () => {
    expect(MAX_ART_BYTES).toBe(50 * 1024 * 1024);
  });
});

const inputBuf = Buffer.from([1, 2, 3]);

beforeEach(() => {
  vi.clearAllMocks();
  (put as any).mockResolvedValue({ pathname: "forge-art/some-key" });
  (normalizeCardImage as any).mockResolvedValue({
    data: Buffer.from("normalized"),
    contentType: "image/jpeg",
  });
});

describe("uploadForgeArt / uploadForgeFinished", () => {
  it("uploads the NORMALIZED bytes as image/jpeg, not the original buffer", async () => {
    await uploadForgeArt(inputBuf);
    expect(normalizeCardImage).toHaveBeenCalledWith(inputBuf);
    const [key, body, opts] = (put as any).mock.calls[0];
    expect(String(key)).toMatch(/^forge-art\//);
    expect(Buffer.from(body).toString()).toBe("normalized");
    expect(opts.contentType).toBe("image/jpeg");
  });

  it("uploadForgeFinished stores under forge-finished/ with normalized bytes", async () => {
    (put as any).mockResolvedValue({ pathname: "forge-finished/some-key" });
    await uploadForgeFinished(inputBuf);
    const [key, body, opts] = (put as any).mock.calls[0];
    expect(String(key)).toMatch(/^forge-finished\//);
    expect(Buffer.from(body).toString()).toBe("normalized");
    expect(opts.contentType).toBe("image/jpeg");
  });

  it("propagates decode failures without uploading anything", async () => {
    (normalizeCardImage as any).mockRejectedValue(new Error("unsupported image format"));
    await expect(uploadForgeArt(inputBuf)).rejects.toThrow();
    expect(put).not.toHaveBeenCalled();
  });
});

describe("uploadForgeArtRaw", () => {
  beforeEach(() => vi.clearAllMocks());
  it("puts the buffer as-is under forge-art/ without normalizing", async () => {
    (put as ReturnType<typeof vi.fn>).mockResolvedValue({ pathname: "forge-art/raw-key" });
    const buf = Buffer.from([9, 9, 9]);
    const key = await uploadForgeArtRaw(buf, "image/jpeg");
    expect(key).toBe("forge-art/raw-key");
    expect(normalizeCardImage).not.toHaveBeenCalled();
    const [putKey, putData, putOpts] = (put as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(putKey).toMatch(/^forge-art\//);
    expect(putData).toBe(buf);
    expect(putOpts.contentType).toBe("image/jpeg");
    expect(putOpts.access).toBe("private");
  });
});

describe("readForgeUpload", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns the raw bytes when the blob is found", async () => {
    (get as ReturnType<typeof vi.fn>).mockResolvedValue({
      statusCode: 200,
      stream: new Blob([new Uint8Array([7, 8, 9])]).stream(),
    });
    const buf = await readForgeUpload("forge-art-raw/x.tif");
    expect(get).toHaveBeenCalledWith("forge-art-raw/x.tif", expect.objectContaining({ access: "private" }));
    expect(Array.from(buf!)).toEqual([7, 8, 9]);
  });

  it("returns null when the blob is missing", async () => {
    (get as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    expect(await readForgeUpload("forge-art-raw/missing")).toBeNull();
  });

  it("returns null on a non-200 status", async () => {
    (get as ReturnType<typeof vi.fn>).mockResolvedValue({ statusCode: 404 });
    expect(await readForgeUpload("forge-art-raw/gone")).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to confirm they fail against the current implementation**

Run: `cd /Users/timestes/projects/rtt-tiff-client-upload && node_modules/.bin/vitest run app/forge/lib/__tests__/art.test.ts`

Expected: several FAILs — `readForgeUpload` is not exported yet; `uploadForgeArt(inputBuf)` fails because the current implementation calls `file.arrayBuffer()` on a plain `Buffer` (no such method); the "50MB" message assertions fail against the current "15MB" text.

- [ ] **Step 3: Implement the changes in `art.ts`**

In `app/forge/lib/art.ts`, replace:

```ts
export const MAX_ART_BYTES = 15 * 1024 * 1024; // 15MB
```

with:

```ts
export const MAX_ART_BYTES = 50 * 1024 * 1024; // 50MB — was 15MB; raised because uploads now go
// straight to Blob from the browser, bypassing Vercel's 4.5MB Function body cap that made the
// old 15MB figure unreachable in practice for anything routed through a Server Action.
const MAX_ART_MB = MAX_ART_BYTES / (1024 * 1024);
```

Replace:

```ts
  if (file.size > MAX_ART_BYTES) {
    return isTiff ? "TIFF file too large. Export at 15MB or smaller." : "File too large. Maximum 15MB.";
  }
```

with:

```ts
  if (file.size > MAX_ART_BYTES) {
    return isTiff
      ? `TIFF file too large. Export at ${MAX_ART_MB}MB or smaller.`
      : `File too large. Maximum ${MAX_ART_MB}MB.`;
  }
```

Replace:

```ts
export async function uploadForgeArt(file: File): Promise<string> {
  const normalized = await normalizeCardImage(Buffer.from(await file.arrayBuffer()));
```

with:

```ts
export async function uploadForgeArt(input: Buffer): Promise<string> {
  const normalized = await normalizeCardImage(input);
```

Replace:

```ts
export async function uploadForgeFinished(file: File): Promise<string> {
  const normalized = await normalizeCardImage(Buffer.from(await file.arrayBuffer()));
```

with:

```ts
export async function uploadForgeFinished(input: Buffer): Promise<string> {
  const normalized = await normalizeCardImage(input);
```

Add a new export right after `readForgeArt`'s definition (after the closing brace of `readForgeArt`, before `deleteForgeArt`):

```ts
/** Reads a raw client-uploaded blob back for the finalize step (private store — the
 * client-upload flow puts the file straight into Blob, bypassing the 4.5MB Vercel
 * Function body cap; this reads it back server-side so it can be normalized and
 * moved into its permanent forge-art/ or forge-finished/ key). Returns null on a
 * miss instead of throwing — callers treat that as "could not read uploaded image". */
export async function readForgeUpload(pathname: string): Promise<Buffer | null> {
  const blob = await get(pathname, { access: "private", ...forgeAuth });
  if (!blob || blob.statusCode !== 200) return null;
  return Buffer.from(await new Response(blob.stream).arrayBuffer());
}
```

- [ ] **Step 4: Run the tests to confirm they pass**

Run: `cd /Users/timestes/projects/rtt-tiff-client-upload && node_modules/.bin/vitest run app/forge/lib/__tests__/art.test.ts`

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/timestes/projects/rtt-tiff-client-upload
git add app/forge/lib/art.ts app/forge/lib/__tests__/art.test.ts
git commit -m "feat(forge): raise art upload cap to 50MB, add raw-upload read-back

MAX_ART_BYTES 15MB -> 50MB (the old figure was unreachable in
practice — anything routed through a Server Action hit Vercel's
4.5MB Function body cap first). uploadForgeArt/uploadForgeFinished
now take a Buffer directly instead of a File, and a new
readForgeUpload() reads a client-direct-to-Blob upload back
server-side so it can still be normalized before storage.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: New route — client-upload token endpoint

**Files:**
- Create: `app/forge/api/art/upload-token/route.ts`
- Test: `app/forge/api/art/upload-token/__tests__/route.test.ts`

**Interfaces:**
- Consumes: `requireElder()` from `app/forge/lib/auth.ts` (existing, no changes).
- Produces: `POST` handler at `/forge/api/art/upload-token`, called by the browser's `@vercel/blob/client` `upload()` (wired up in Task 5).

- [ ] **Step 1: Write the failing test**

Create `app/forge/api/art/upload-token/__tests__/route.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/app/forge/lib/auth", () => ({ requireElder: vi.fn() }));
vi.mock("@vercel/blob/client", () => ({ handleUpload: vi.fn() }));

import { requireElder } from "@/app/forge/lib/auth";
import { handleUpload } from "@vercel/blob/client";
import { POST } from "../route";

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

function reqWith(body: unknown) {
  return new Request("http://localhost/forge/api/art/upload-token", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

describe("POST /forge/api/art/upload-token", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.FORGE_BLOB_READ_WRITE_TOKEN = "test-token";
  });

  it("targets the FORGE store's token and offers a permissive content-type allowlist", async () => {
    asMock(handleUpload).mockResolvedValue({ ok: true });
    await POST(reqWith({ type: "blob.generate-client-token", payload: {} }));
    const opts = asMock(handleUpload).mock.calls[0][0];
    expect(opts.token).toBe("test-token");
    asMock(requireElder).mockResolvedValue({ role: "elder" });
    const result = await opts.onBeforeGenerateToken("forge-art-raw/x.tiff");
    expect(result.allowedContentTypes).toEqual(
      expect.arrayContaining(["image/tiff", "image/tif", "application/octet-stream"]),
    );
  });

  it("refuses to generate a token for a non-elder", async () => {
    asMock(requireElder).mockResolvedValue(null);
    asMock(handleUpload).mockImplementation(async ({ onBeforeGenerateToken }: any) => {
      await onBeforeGenerateToken("forge-art-raw/x.tiff");
    });
    const res = await POST(reqWith({ type: "blob.generate-client-token", payload: {} }));
    expect(res.status).toBe(400);
  });

  it("lets an elder through", async () => {
    asMock(requireElder).mockResolvedValue({ role: "elder" });
    asMock(handleUpload).mockImplementation(async ({ onBeforeGenerateToken }: any) =>
      onBeforeGenerateToken("forge-art-raw/x.tiff"),
    );
    const res = await POST(reqWith({ type: "blob.generate-client-token", payload: {} }));
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/timestes/projects/rtt-tiff-client-upload && node_modules/.bin/vitest run app/forge/api/art/upload-token/__tests__/route.test.ts`

Expected: FAIL — `Cannot find module '../route'` (the route doesn't exist yet).

- [ ] **Step 3: Write the route**

Create `app/forge/api/art/upload-token/route.ts`:

```ts
// Mints Vercel Blob client-upload tokens for Forge art. The browser uploads
// straight to Blob (bypassing Vercel's 4.5MB Function body cap) via
// @vercel/blob/client's upload(), which calls this route first for a token.
// Auth happens here, in onBeforeGenerateToken — no token, no upload.
import { NextResponse } from "next/server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { requireElder } from "@/app/forge/lib/auth";

export async function POST(request: Request): Promise<NextResponse> {
  const body = (await request.json()) as HandleUploadBody;
  try {
    const json = await handleUpload({
      body,
      request,
      token: process.env.FORGE_BLOB_READ_WRITE_TOKEN, // the FORGE store's token, not the app's default one
      onBeforeGenerateToken: async () => {
        const ctx = await requireElder();
        if (!ctx) throw new Error("Not authorized");
        return {
          // application/octet-stream stays allowed because browsers routinely misreport
          // .tif/.tiff with a generic or empty MIME type — the real content gate is
          // sharp() throwing on undecodable input during normalization, not this check.
          allowedContentTypes: [
            "image/jpeg", "image/png", "image/webp",
            "image/tiff", "image/tif", "application/octet-stream",
          ],
          addRandomSuffix: true,
        };
      },
      // No onUploadCompleted — the client makes its own small follow-up call
      // (Tasks 3-5) to finalize the upload, instead of relying on Vercel's webhook.
    });
    return NextResponse.json(json);
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/timestes/projects/rtt-tiff-client-upload && node_modules/.bin/vitest run app/forge/api/art/upload-token/__tests__/route.test.ts`

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/timestes/projects/rtt-tiff-client-upload
git add app/forge/api/art/upload-token/route.ts app/forge/api/art/upload-token/__tests__/route.test.ts
git commit -m "feat(forge): add client-upload token route for Forge art

New /forge/api/art/upload-token route mints @vercel/blob/client
upload tokens, gated by requireElder() in onBeforeGenerateToken.
This is the first half of moving art uploads off Server Actions
(which run as Vercel Functions capped at 4.5MB inbound) onto a
direct browser-to-Blob path.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: `cards.ts` — `uploadArt` / `uploadFinished` take a blob pathname

**Files:**
- Modify: `app/forge/lib/cards.ts`
- Test: `app/forge/lib/__tests__/cards.test.ts`

**Interfaces:**
- Consumes: `readForgeUpload`, `deleteForgeArt` from `app/forge/lib/art.ts` (Task 1).
- Produces: `uploadArt(cardId: string, pathname: string): Promise<{ ok: boolean; error?: string }>` — **signature change**, was `(cardId, formData: FormData)`.
- Produces: `uploadFinished(cardId: string, pathname: string): Promise<{ ok: boolean; error?: string }>` — **signature change**, was `(cardId, formData: FormData)`.

- [ ] **Step 1: Update the test file**

In `app/forge/lib/__tests__/cards.test.ts`, replace the mock:

```ts
vi.mock("@/app/forge/lib/art", () => ({ validateArtFile: vi.fn(), uploadForgeArt: vi.fn(), uploadForgeFinished: vi.fn() }));
```

with:

```ts
vi.mock("@/app/forge/lib/art", () => ({
  validateArtFile: vi.fn(),
  uploadForgeArt: vi.fn(),
  uploadForgeFinished: vi.fn(),
  readForgeUpload: vi.fn(),
  deleteForgeArt: vi.fn(),
}));
```

Replace the import:

```ts
import { validateArtFile, uploadForgeArt, uploadForgeFinished } from "@/app/forge/lib/art";
```

with:

```ts
import { validateArtFile, uploadForgeArt, uploadForgeFinished, readForgeUpload, deleteForgeArt } from "@/app/forge/lib/art";
```

Replace the `describe("uploadFinished", ...)` block with:

```ts
describe("uploadArt", () => {
  it("rejects when caller is not an elder", async () => {
    (requireElder as any).mockResolvedValue(null);
    const r = await uploadArt("c1", "forge-art-raw/x.png");
    expect(r.ok).toBe(false);
  });
  it("uploads and calls forge_set_working_art with the returned key", async () => {
    const c = ctx();
    (requireElder as any).mockResolvedValue(c);
    (readForgeUpload as any).mockResolvedValue(Buffer.from([1, 2, 3]));
    (validateArtFile as any).mockReturnValue(null);
    (uploadForgeArt as any).mockResolvedValue("forge-art/abc");
    const r = await uploadArt("c1", "forge-art-raw/x.png");
    expect(r.ok).toBe(true);
    expect((c.supabase.rpc as any).mock.calls[0]).toEqual([
      "forge_set_working_art", { p_card_id: "c1", p_key: "forge-art/abc", p_original_key: "forge-art/abc" },
    ]);
    expect(deleteForgeArt).toHaveBeenCalledWith("forge-art-raw/x.png");
  });
});

describe("uploadFinished", () => {
  it("rejects when caller is not an elder", async () => {
    (requireElder as any).mockResolvedValue(null);
    const r = await uploadFinished("c1", "forge-art-raw/x.png");
    expect(r.ok).toBe(false);
  });
  it("uploads and calls forge_set_working_finished with the returned key", async () => {
    const c = ctx();
    (requireElder as any).mockResolvedValue(c);
    (readForgeUpload as any).mockResolvedValue(Buffer.from([1, 2, 3]));
    (validateArtFile as any).mockReturnValue(null);
    (uploadForgeFinished as any).mockResolvedValue("forge-finished/abc");
    const r = await uploadFinished("c1", "forge-art-raw/x.png");
    expect(r.ok).toBe(true);
    expect((c.supabase.rpc as any).mock.calls[0]).toEqual([
      "forge_set_working_finished", { p_card_id: "c1", p_key: "forge-finished/abc" },
    ]);
    expect(deleteForgeArt).toHaveBeenCalledWith("forge-art-raw/x.png");
  });
  it("returns an error when the raw upload can't be read back", async () => {
    const c = ctx();
    (requireElder as any).mockResolvedValue(c);
    (readForgeUpload as any).mockResolvedValue(null);
    const r = await uploadFinished("c1", "forge-art-raw/gone.png");
    expect(r).toEqual({ ok: false, error: "Could not read uploaded image" });
    expect(uploadForgeFinished).not.toHaveBeenCalled();
  });
});
```

Replace the `describe("upload decode failures", ...)` block with:

```ts
describe("upload decode failures", () => {
  it("uploadArt returns a clear error when the image cannot be decoded", async () => {
    const c = ctx();
    (requireElder as any).mockResolvedValue(c);
    (readForgeUpload as any).mockResolvedValue(Buffer.from([1, 2, 3]));
    (validateArtFile as any).mockReturnValue(null);
    (uploadForgeArt as any).mockRejectedValue(new Error("unsupported image format"));
    const r = await uploadArt("c1", "forge-art-raw/a.png");
    expect(r).toEqual({ ok: false, error: "Could not read image file." });
    expect(deleteForgeArt).toHaveBeenCalledWith("forge-art-raw/a.png");
  });

  it("uploadFinished returns a clear error when the image cannot be decoded", async () => {
    const c = ctx();
    (requireElder as any).mockResolvedValue(c);
    (readForgeUpload as any).mockResolvedValue(Buffer.from([1, 2, 3]));
    (validateArtFile as any).mockReturnValue(null);
    (uploadForgeFinished as any).mockRejectedValue(new Error("unsupported image format"));
    const r = await uploadFinished("c1", "forge-art-raw/c.png");
    expect(r).toEqual({ ok: false, error: "Could not read image file." });
    expect(deleteForgeArt).toHaveBeenCalledWith("forge-art-raw/c.png");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/timestes/projects/rtt-tiff-client-upload && node_modules/.bin/vitest run app/forge/lib/__tests__/cards.test.ts`

Expected: FAILs in the new/changed tests — `uploadArt`/`uploadFinished` still expect a `FormData` and call `formData.get("file")`, which throws or misbehaves against a plain string argument.

- [ ] **Step 3: Update `cards.ts`**

In `app/forge/lib/cards.ts`, replace the import:

```ts
import { validateArtFile, uploadForgeArt, uploadForgeFinished } from "@/app/forge/lib/art";
```

with:

```ts
import { validateArtFile, uploadForgeArt, uploadForgeFinished, readForgeUpload, deleteForgeArt } from "@/app/forge/lib/art";
```

Replace the entire `uploadArt` function:

```ts
export async function uploadArt(
  cardId: string,
  formData: FormData
): Promise<{ ok: boolean; error?: string }> {
  const ctx = await requireElder();
  if (!ctx) return { ok: false, error: "Not authorized" };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "No file provided" };
  const invalid = validateArtFile(file);
  if (invalid) return { ok: false, error: invalid };

  let key: string;
  try {
    key = await uploadForgeArt(file);
  } catch {
    return { ok: false, error: "Could not read image file." };
  }
  // Art is normalized at upload (trim/resize/JPEG); original_key mirrors the stored key.
  const { error } = await ctx.supabase.rpc("forge_set_working_art", {
    p_card_id: cardId,
    p_key: key,
    p_original_key: key,
  });
  if (error) return { ok: false, error: "Could not save art" };
  revalidatePath("/forge/ideas");
  return { ok: true };
}
```

with:

```ts
export async function uploadArt(
  cardId: string,
  pathname: string
): Promise<{ ok: boolean; error?: string }> {
  const ctx = await requireElder();
  if (!ctx) return { ok: false, error: "Not authorized" };

  const raw = await readForgeUpload(pathname);
  if (!raw) return { ok: false, error: "Could not read uploaded image" };
  const invalid = validateArtFile({ type: "", size: raw.length, name: pathname });
  if (invalid) {
    await deleteForgeArt(pathname);
    return { ok: false, error: invalid };
  }

  let key: string;
  try {
    key = await uploadForgeArt(raw);
  } catch {
    await deleteForgeArt(pathname);
    return { ok: false, error: "Could not read image file." };
  }
  await deleteForgeArt(pathname);
  // Art is normalized at upload (trim/resize/JPEG); original_key mirrors the stored key.
  const { error } = await ctx.supabase.rpc("forge_set_working_art", {
    p_card_id: cardId,
    p_key: key,
    p_original_key: key,
  });
  if (error) return { ok: false, error: "Could not save art" };
  revalidatePath("/forge/ideas");
  return { ok: true };
}
```

Replace the entire `uploadFinished` function:

```ts
export async function uploadFinished(
  cardId: string,
  formData: FormData
): Promise<{ ok: boolean; error?: string }> {
  const ctx = await requireElder();
  if (!ctx) return { ok: false, error: "Not authorized" };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "No file provided" };
  const invalid = validateArtFile(file);
  if (invalid) return { ok: false, error: invalid };

  let key: string;
  try {
    key = await uploadForgeFinished(file);
  } catch {
    return { ok: false, error: "Could not read image file." };
  }
  const { error } = await ctx.supabase.rpc("forge_set_working_finished", {
    p_card_id: cardId,
    p_key: key,
  });
  if (error) return { ok: false, error: "Could not save finished card" };
  revalidatePath("/forge/ideas");
  return { ok: true };
}
```

with:

```ts
export async function uploadFinished(
  cardId: string,
  pathname: string
): Promise<{ ok: boolean; error?: string }> {
  const ctx = await requireElder();
  if (!ctx) return { ok: false, error: "Not authorized" };

  const raw = await readForgeUpload(pathname);
  if (!raw) return { ok: false, error: "Could not read uploaded image" };
  const invalid = validateArtFile({ type: "", size: raw.length, name: pathname });
  if (invalid) {
    await deleteForgeArt(pathname);
    return { ok: false, error: invalid };
  }

  let key: string;
  try {
    key = await uploadForgeFinished(raw);
  } catch {
    await deleteForgeArt(pathname);
    return { ok: false, error: "Could not read image file." };
  }
  await deleteForgeArt(pathname);
  const { error } = await ctx.supabase.rpc("forge_set_working_finished", {
    p_card_id: cardId,
    p_key: key,
  });
  if (error) return { ok: false, error: "Could not save finished card" };
  revalidatePath("/forge/ideas");
  return { ok: true };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/timestes/projects/rtt-tiff-client-upload && node_modules/.bin/vitest run app/forge/lib/__tests__/cards.test.ts`

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/timestes/projects/rtt-tiff-client-upload
git add app/forge/lib/cards.ts app/forge/lib/__tests__/cards.test.ts
git commit -m "feat(forge): uploadArt/uploadFinished take a blob pathname

Second half of moving off the Server Action body-size cap: these
now receive the pathname of a file already uploaded directly to
Blob (Task 2's route), read the raw bytes back server-side via
readForgeUpload, normalize/store/RPC-write exactly as before, and
clean up the raw upload with deleteForgeArt.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: `artCandidates.ts` — `addArtCandidate` takes a blob pathname

**Files:**
- Modify: `app/forge/lib/artCandidates.ts`
- Test: `app/forge/lib/__tests__/artCandidates.test.ts`

**Interfaces:**
- Consumes: `readForgeUpload`, `deleteForgeArt` from `app/forge/lib/art.ts` (Task 1).
- Produces: `addArtCandidate(cardId: string, pathname: string): Promise<{ ok: boolean; error?: string }>` — **signature change**, was `(cardId, formData: FormData)`. `deleteArtCandidate` and `applyCrop` are unchanged.

- [ ] **Step 1: Update the test file**

In `app/forge/lib/__tests__/artCandidates.test.ts`, replace the mock:

```ts
vi.mock("@/app/forge/lib/art", () => ({
  validateArtFile: vi.fn(() => null),
  uploadForgeArt: vi.fn(),
  uploadForgeArtRaw: vi.fn(),
  readForgeArt: vi.fn(),
}));
```

with:

```ts
vi.mock("@/app/forge/lib/art", () => ({
  validateArtFile: vi.fn(() => null),
  uploadForgeArt: vi.fn(),
  uploadForgeArtRaw: vi.fn(),
  readForgeArt: vi.fn(),
  readForgeUpload: vi.fn(),
  deleteForgeArt: vi.fn(),
}));
```

Replace the import:

```ts
import { uploadForgeArt, uploadForgeArtRaw, readForgeArt } from "@/app/forge/lib/art";
```

with:

```ts
import { uploadForgeArt, uploadForgeArtRaw, readForgeArt, readForgeUpload, deleteForgeArt } from "@/app/forge/lib/art";
```

Replace the `fd` helper:

```ts
const fd = () => {
  const f = new FormData();
  f.set("file", new File([new Uint8Array([1])], "a.png", { type: "image/png" }));
  return f;
};
```

with:

```ts
const pathname = "forge-art-raw/a.png";
```

Replace the entire `describe("addArtCandidate", ...)` block:

```ts
describe("addArtCandidate", () => {
  beforeEach(() => vi.clearAllMocks());

  it("uploads, registers the candidate, and auto-activates on an art-less card", async () => {
    const { rpc } = mockCtx({ rows: { forge_cards: { working_art_key: null } } });
    (uploadForgeArt as ReturnType<typeof vi.fn>).mockResolvedValue("forge-art/k1");
    const r = await addArtCandidate("card1", fd());
    expect(r.ok).toBe(true);
    expect(rpc).toHaveBeenCalledWith("forge_add_art_candidate", { p_card_id: "card1", p_key: "forge-art/k1" });
    expect(rpc).toHaveBeenCalledWith("forge_set_working_art", { p_card_id: "card1", p_key: "forge-art/k1", p_original_key: "forge-art/k1" });
  });

  it("surfaces an auto-activate failure even though the candidate row was saved", async () => {
    mockCtx({
      rows: { forge_cards: { working_art_key: null } },
      rpcResults: { forge_set_working_art: { error: { message: "boom" } } },
    });
    (uploadForgeArt as ReturnType<typeof vi.fn>).mockResolvedValue("forge-art/k1");
    const r = await addArtCandidate("card1", fd());
    expect(r.ok).toBe(false);
    expect(r.error).toBe("Image saved but could not be set as artwork");
  });

  it("does not auto-activate when the card already has art", async () => {
    const { rpc } = mockCtx({ rows: { forge_cards: { working_art_key: "forge-art/existing" } } });
    (uploadForgeArt as ReturnType<typeof vi.fn>).mockResolvedValue("forge-art/k2");
    await addArtCandidate("card1", fd());
    expect(rpc).not.toHaveBeenCalledWith("forge_set_working_art", expect.anything());
  });

  it("maps the cap error to friendly copy", async () => {
    mockCtx({ rpcResults: { forge_add_art_candidate: { error: { message: "candidate limit reached (12)" } } } });
    (uploadForgeArt as ReturnType<typeof vi.fn>).mockResolvedValue("forge-art/k3");
    const r = await addArtCandidate("card1", fd());
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/12 images/);
  });

  it("refuses when not an elder", async () => {
    (requireElder as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const r = await addArtCandidate("card1", fd());
    expect(r.ok).toBe(false);
    expect(uploadForgeArt).not.toHaveBeenCalled();
  });
});
```

with:

```ts
describe("addArtCandidate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (readForgeUpload as ReturnType<typeof vi.fn>).mockResolvedValue(Buffer.from([1]));
  });

  it("uploads, registers the candidate, and auto-activates on an art-less card", async () => {
    const { rpc } = mockCtx({ rows: { forge_cards: { working_art_key: null } } });
    (uploadForgeArt as ReturnType<typeof vi.fn>).mockResolvedValue("forge-art/k1");
    const r = await addArtCandidate("card1", pathname);
    expect(r.ok).toBe(true);
    expect(rpc).toHaveBeenCalledWith("forge_add_art_candidate", { p_card_id: "card1", p_key: "forge-art/k1" });
    expect(rpc).toHaveBeenCalledWith("forge_set_working_art", { p_card_id: "card1", p_key: "forge-art/k1", p_original_key: "forge-art/k1" });
    expect(deleteForgeArt).toHaveBeenCalledWith(pathname);
  });

  it("surfaces an auto-activate failure even though the candidate row was saved", async () => {
    mockCtx({
      rows: { forge_cards: { working_art_key: null } },
      rpcResults: { forge_set_working_art: { error: { message: "boom" } } },
    });
    (uploadForgeArt as ReturnType<typeof vi.fn>).mockResolvedValue("forge-art/k1");
    const r = await addArtCandidate("card1", pathname);
    expect(r.ok).toBe(false);
    expect(r.error).toBe("Image saved but could not be set as artwork");
  });

  it("does not auto-activate when the card already has art", async () => {
    const { rpc } = mockCtx({ rows: { forge_cards: { working_art_key: "forge-art/existing" } } });
    (uploadForgeArt as ReturnType<typeof vi.fn>).mockResolvedValue("forge-art/k2");
    await addArtCandidate("card1", pathname);
    expect(rpc).not.toHaveBeenCalledWith("forge_set_working_art", expect.anything());
  });

  it("maps the cap error to friendly copy", async () => {
    mockCtx({ rpcResults: { forge_add_art_candidate: { error: { message: "candidate limit reached (12)" } } } });
    (uploadForgeArt as ReturnType<typeof vi.fn>).mockResolvedValue("forge-art/k3");
    const r = await addArtCandidate("card1", pathname);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/12 images/);
  });

  it("refuses when not an elder", async () => {
    (requireElder as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const r = await addArtCandidate("card1", pathname);
    expect(r.ok).toBe(false);
    expect(uploadForgeArt).not.toHaveBeenCalled();
  });

  it("returns an error when the raw upload can't be read back", async () => {
    mockCtx({});
    (readForgeUpload as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const r = await addArtCandidate("card1", pathname);
    expect(r).toEqual({ ok: false, error: "Could not read uploaded image" });
    expect(uploadForgeArt).not.toHaveBeenCalled();
  });
});
```

(`deleteArtCandidate` and `applyCrop` describe blocks below this are untouched.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/timestes/projects/rtt-tiff-client-upload && node_modules/.bin/vitest run app/forge/lib/__tests__/artCandidates.test.ts`

Expected: FAILs in the `addArtCandidate` describe block — the implementation still expects a `FormData`.

- [ ] **Step 3: Update `artCandidates.ts`**

In `app/forge/lib/artCandidates.ts`, replace the import:

```ts
import { validateArtFile, uploadForgeArt, uploadForgeArtRaw, readForgeArt } from "@/app/forge/lib/art";
```

with:

```ts
import { validateArtFile, uploadForgeArt, uploadForgeArtRaw, readForgeArt, readForgeUpload, deleteForgeArt } from "@/app/forge/lib/art";
```

Replace:

```ts
export async function addArtCandidate(
  cardId: string,
  formData: FormData
): Promise<{ ok: boolean; error?: string }> {
  const ctx = await requireElder();
  if (!ctx) return { ok: false, error: "Not authorized" };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "No file provided" };
  const invalid = validateArtFile(file);
  if (invalid) return { ok: false, error: invalid };

  let key: string;
  try {
    key = await uploadForgeArt(file);
  } catch {
    return { ok: false, error: "Could not read image file." };
  }
```

with:

```ts
export async function addArtCandidate(
  cardId: string,
  pathname: string
): Promise<{ ok: boolean; error?: string }> {
  const ctx = await requireElder();
  if (!ctx) return { ok: false, error: "Not authorized" };

  const raw = await readForgeUpload(pathname);
  if (!raw) return { ok: false, error: "Could not read uploaded image" };
  const invalid = validateArtFile({ type: "", size: raw.length, name: pathname });
  if (invalid) {
    await deleteForgeArt(pathname);
    return { ok: false, error: invalid };
  }

  let key: string;
  try {
    key = await uploadForgeArt(raw);
  } catch {
    await deleteForgeArt(pathname);
    return { ok: false, error: "Could not read image file." };
  }
  await deleteForgeArt(pathname);
```

Everything from `const { error } = await ctx.supabase.rpc("forge_add_art_candidate", ...` through the end of the function is unchanged.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/timestes/projects/rtt-tiff-client-upload && node_modules/.bin/vitest run app/forge/lib/__tests__/artCandidates.test.ts`

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/timestes/projects/rtt-tiff-client-upload
git add app/forge/lib/artCandidates.ts app/forge/lib/__tests__/artCandidates.test.ts
git commit -m "feat(forge): addArtCandidate takes a blob pathname

Same finalize pattern as uploadArt/uploadFinished: reads the raw
client-uploaded bytes back via readForgeUpload, normalizes/stores/
RPC-writes exactly as before, cleans up the raw upload with
deleteForgeArt.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 5: Rewire the three upload UI surfaces (fixes the hang bug too)

**Files:**
- Modify: `app/forge/components/ArtCandidatesPanel.tsx`
- Modify: `app/forge/cards/[cardId]/StudioEditor.tsx`
- Modify: `app/forge/cards/[cardId]/FullModeForm.tsx`

**Interfaces:**
- Consumes: `upload` from `@vercel/blob/client`; `addArtCandidate(cardId, pathname)` (Task 4); `uploadFinished(cardId, pathname)`, `uploadArt(cardId, pathname)` (Task 3).

No automated tests for these — this repo has no `.test.tsx` component tests (vitest's `include` only matches `*.test.ts`); verification is manual, in Task 6.

- [ ] **Step 1: Rewire `ArtCandidatesPanel.tsx`**

Add the import (near the top, alongside the other `@/app/forge/lib/artCandidates` import):

```ts
import { upload } from "@vercel/blob/client";
```

Replace:

```ts
  async function onFiles(files: File[]) {
    setErr(null);
    const errors: string[] = [];
    for (let i = 0; i < files.length; i++) {
      setProgress({ done: i, total: files.length, name: files[i].name });
      const fd = new FormData();
      fd.set("file", files[i]);
      const r = await addArtCandidate(cardId, fd);
      if (r.ok === false) errors.push(`${files[i].name}: ${r.error ?? "failed"}`);
      // Refresh per file, not once per batch — each finished upload swaps its
      // skeleton tile for the real thumbnail, so a slow batch never looks hung.
      else router.refresh();
    }
    setProgress(null);
    if (errors.length > 0) setErr(errors.join(" · "));
    router.refresh();
  }
```

with:

```ts
  async function onFiles(files: File[]) {
    setErr(null);
    const errors: string[] = [];
    for (let i = 0; i < files.length; i++) {
      setProgress({ done: i, total: files.length, name: files[i].name });
      try {
        const blob = await upload(`forge-art-raw/${files[i].name}`, files[i], {
          access: "private",
          handleUploadUrl: "/forge/api/art/upload-token",
        });
        const r = await addArtCandidate(cardId, blob.pathname);
        if (r.ok === false) errors.push(`${files[i].name}: ${r.error ?? "failed"}`);
        // Refresh per file, not once per batch — each finished upload swaps its
        // skeleton tile for the real thumbnail, so a slow batch never looks hung.
        else router.refresh();
      } catch (e) {
        // Previously an uncaught throw here (e.g. a 413 from an oversized file) left
        // `progress` set forever — a permanent spinner. Catching it keeps the batch
        // going and reports the failure like any other per-file error.
        errors.push(`${files[i].name}: ${e instanceof Error ? e.message : "Upload failed"}`);
      }
    }
    setProgress(null);
    if (errors.length > 0) setErr(errors.join(" · "));
    router.refresh();
  }
```

- [ ] **Step 2: Rewire `StudioEditor.tsx`**

Add the import (near the top, alongside the other lib imports):

```ts
import { upload } from "@vercel/blob/client";
```

Replace:

```ts
  async function onUpload(file: File, kind: "finished") {
    setErr(null);
    setUploading(kind);
    try {
      const fd = new FormData();
      fd.set("file", file);
      const r = await uploadFinished(card.id, fd);
      if (r.ok === false) setErr(r.error ?? "Upload failed");
      else router.refresh();
    } finally {
      setUploading(null);
    }
  }
```

with:

```ts
  async function onUpload(file: File, kind: "finished") {
    setErr(null);
    setUploading(kind);
    try {
      const blob = await upload(`forge-art-raw/${file.name}`, file, {
        access: "private",
        handleUploadUrl: "/forge/api/art/upload-token",
      });
      const r = await uploadFinished(card.id, blob.pathname);
      if (r.ok === false) setErr(r.error ?? "Upload failed");
      else router.refresh();
    } catch (e) {
      // Previously uncaught: the spinner cleared (finally still ran) but nothing told
      // the user it failed — a silent no-op. Now it does.
      setErr(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(null);
    }
  }
```

- [ ] **Step 3: Rewire `FullModeForm.tsx`**

Add the import:

```ts
import { upload } from "@vercel/blob/client";
```

Add a busy-state hook alongside the existing one:

```ts
  const [err, setErr] = useState<string | null>(null);
```

becomes:

```ts
  const [err, setErr] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
```

Replace:

```ts
  async function onUpload(file: File) {
    setErr(null);
    const fd = new FormData();
    fd.set("file", file);
    const r = await uploadArt(card.id, fd);
    if (!r.ok) setErr(r.error ?? "Upload failed");
    else router.refresh();
  }
```

with:

```ts
  async function onUpload(file: File) {
    setErr(null);
    setUploading(true);
    try {
      const blob = await upload(`forge-art-raw/${file.name}`, file, {
        access: "private",
        handleUploadUrl: "/forge/api/art/upload-token",
      });
      const r = await uploadArt(card.id, blob.pathname);
      if (!r.ok) setErr(r.error ?? "Upload failed");
      else router.refresh();
    } catch (e) {
      // Previously: no busy state and no catch at all — a failed upload just
      // did nothing visible, no different from a hang from the user's side.
      setErr(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }
```

Replace the file input:

```tsx
        <input type="file" accept="image/jpeg,image/png,image/webp,.tif,.tiff,image/tiff"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) onUpload(f); e.target.value = ""; }}
          className="block w-full text-xs" />
```

with:

```tsx
        <input type="file" accept="image/jpeg,image/png,image/webp,.tif,.tiff,image/tiff"
          disabled={uploading}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) onUpload(f); e.target.value = ""; }}
          className="block w-full text-xs" />
        {uploading && <p className="mt-1 text-xs text-muted-foreground">Uploading…</p>}
```

- [ ] **Step 4: Type-check the three files**

Run: `cd /Users/timestes/projects/rtt-tiff-client-upload && node_modules/.bin/tsc --noEmit`

Expected: no new errors introduced by these three files (pre-existing unrelated errors elsewhere in the repo, if any, are not this task's concern — only check that these three files don't introduce new ones).

- [ ] **Step 5: Commit**

```bash
cd /Users/timestes/projects/rtt-tiff-client-upload
git add app/forge/components/ArtCandidatesPanel.tsx \
        "app/forge/cards/[cardId]/StudioEditor.tsx" \
        "app/forge/cards/[cardId]/FullModeForm.tsx"
git commit -m "fix(forge): upload straight to Blob from the browser; surface upload errors

Wires all three art-upload surfaces to the new client-upload route
(Task 2) instead of posting the raw file through a Server Action,
removing the 4.5MB Vercel Function body cap for these uploads.

Also fixes the confirmed hang bug while these call sites were being
rewritten anyway: ArtCandidatesPanel had no catch around the upload
call, so a thrown error (e.g. a platform 413) left its progress
spinner set forever; StudioEditor cleared its spinner on error but
never surfaced one; FullModeForm had no busy state or error handling
at all. All three now show a real error on failure instead of
hanging or silently doing nothing.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 6: Manual end-to-end verification

**Files:** none (verification only — no code changes in this task).

**Interfaces:** none produced; consumes the working app from Tasks 1-5.

- [ ] **Step 1: Bring the worktree's local environment up to date**

The worktree has no `.env.local` (gitignored, not copied by `git worktree add`). Copy it from the main checkout and confirm the key sets match before trusting it:

```bash
cp /Users/timestes/projects/redemption-tournament-tracker/.env.local /Users/timestes/projects/rtt-tiff-client-upload/.env.local
diff <(grep -o '^[A-Z_]*=' /Users/timestes/projects/redemption-tournament-tracker/.env.local | sort) \
     <(grep -o '^[A-Z_]*=' /Users/timestes/projects/rtt-tiff-client-upload/.env.local | sort)
```

Expected: no diff output (identical key sets). If there is a diff, stop and report it rather than guessing which side is stale.

- [ ] **Step 2: Start the dev server on a non-default port**

The main checkout may already have its own dev server on :3000 — don't collide with it.

```bash
cd /Users/timestes/projects/rtt-tiff-client-upload && PORT=3001 npm run dev
```

Wait for "Ready" in the output before proceeding.

- [ ] **Step 3: Load the `verify` skill for how to reach an authenticated Forge elder session**

Invoke the `verify` skill (`Skill({skill: "verify"})`) for this repo's pattern to mint a real Supabase session cookie / reach an elder-permissioned account against `http://localhost:3001`, rather than guessing credentials here. Use Playwright MCP tools against that authenticated session for the steps below.

- [ ] **Step 4: Reproduce the original bug is fixed — 5MB TIFF**

Navigate to a Forge card's art-candidates UI (`http://localhost:3001/forge/cards/<some-card-id>`) and upload `tmp/file_example_TIFF_5MB.tiff` (already present in the repo per the user).

Expected: upload completes (progress indicator clears, no indefinite spinner), the new candidate thumbnail appears. This previously hung indefinitely before this plan's changes.

- [ ] **Step 5: Control — 1MB TIFF (already worked before)**

Upload `tmp/file_example_TIFF_1MB.tiff`.

Expected: succeeds, confirming no regression on the smaller file that already worked pre-fix.

- [ ] **Step 6: Control — same-size JPEG/PNG**

Export or reuse any JPEG/PNG around 5MB and upload it.

Expected: succeeds — confirms the fix isn't accidentally TIFF-specific.

- [ ] **Step 7: Oversized file — over 50MB**

Create and upload a file over 50MB:

```bash
dd if=/dev/urandom of=/tmp/oversized.tiff bs=1m count=51
```

Expected: a clean, visible error (e.g. "File too large. Maximum 50MB." or "TIFF file too large. Export at 50MB or smaller.") — not a hang, not a silent failure.

- [ ] **Step 8: Malformed file**

Upload a non-image file renamed to `.tiff` (e.g. a text file):

```bash
echo "not an image" > /tmp/fake.tiff
```

Expected: a clean error ("Could not read image file." or similar) surfaced in the UI — confirms `sharp`'s decode-time rejection still propagates correctly through the new read-back path.

- [ ] **Step 9: Stop the dev server**

Stop whatever ran it in Step 2 — if it was launched as a background task, stop that task; if it's running in an interactive terminal, Ctrl-C.

No commit for this task — it's verification only. If any step fails, return to the relevant task above, fix, and re-verify — don't patch around a failure here without updating the corresponding task's code and tests.

---

## After all tasks

Push the branch and open a PR against `origin/main`:

```bash
cd /Users/timestes/projects/rtt-tiff-client-upload
git push -u origin feat/forge-tiff-client-upload
gh pr create --base main --title "feat(forge): allow larger TIFF/art uploads via client-direct-to-Blob" --body "$(cat <<'EOF'
## Summary
- Forge art uploads (working art, finished art, art candidates) now upload
  straight from the browser to Vercel Blob instead of through a Server
  Action, removing the platform's 4.5MB Function body cap that made large
  TIFF uploads hang indefinitely.
- Raises `MAX_ART_BYTES` from 15MB to 50MB (the old figure was unreachable
  in practice — anything over ~4.5MB already hit the platform cap first).
- Fixes the confirmed hang bug in the same pass: none of the three upload
  UI surfaces handled a thrown/rejected upload — one left its spinner set
  forever, the other two failed silently. All three now show a real error.

## Root cause
See `docs/superpowers/specs/2026-09-09-forge-art-client-upload-design.md`
for the full diagnosis and design.

## Out of scope
`app/forge/api/import/route.ts` (bulk Lackey import) hits the same 4.5MB
ceiling but needs its own batch-contract redesign — deferred, tracked
separately.

## Test plan
- `art.test.ts`, `cards.test.ts`, `artCandidates.test.ts`,
  `upload-token/route.test.ts` — all passing.
- Manual verification with real TIFF fixtures (1MB control, 5MB repro,
  oversized, malformed) against a local dev server — see Task 6 of the
  implementation plan.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```
