# Forge art client uploads — design

**Date:** 2026-09-09
**Status:** approved, implementation starting on `feat/forge-tiff-client-upload`

## Goal

Let Forge elders upload card art up to 50MB (large TIFF scans especially),
without the upload silently hanging forever.

## Root cause (already diagnosed, not re-litigated here)

Forge art upload (`uploadArt`, `uploadFinished` in `app/forge/lib/cards.ts`;
`addArtCandidate` in `app/forge/lib/artCandidates.ts`) runs as a Next.js
Server Action, which executes as a Vercel Function. Vercel Functions hard-cap
inbound request bodies at **4.5MB**, platform-enforced, independent of
`next.config.js`'s `serverActions.bodySizeLimit` (currently `16mb`, which only
raises Next's own parser ceiling — it does nothing about the platform limit in
front of it). A file over 4.5MB gets a `413 FUNCTION_PAYLOAD_TOO_LARGE` before
the Function is even invoked.

That 413 becomes a **hang**, not a visible error, because of a second, separate
bug: Next's Server Action client code throws on any non-RSC response, and none
of the three upload call sites (`ArtCandidatesPanel.tsx`, `StudioEditor.tsx`,
`FullModeForm.tsx`) handle that throw — busy/progress state is set before the
call and only cleared on the line after it, which a throw skips. Confirmed
empirically: a live 5MB POST against production returns the 413 in ~1.3s; the
UI still spins forever.

`MAX_ART_BYTES = 15 * 1024 * 1024` (`app/forge/lib/art.ts`) was never
reachable above ~4.5MB in practice — compressed JPEG/PNG/WebP card art rarely
crossed that anyway. TIFF (added in PR #392) is the first format that
routinely does, which is why this surfaced now.

## Approach: client-direct-to-Blob, with a client-driven finalize step

Vercel's own guidance lists exactly one workaround for the 4.5MB cap:
upload straight from the browser to storage, bypassing the Function for the
transfer (`@vercel/blob/client`'s `upload()` + `handleUpload()`).

Today, `uploadForgeArt(file)` normalizes the image (trim print-bleed margins,
cap height at 1050px, re-encode JPEG — `app/forge/lib/imageNormalize.ts`)
*inline*, synchronously, as part of the request that receives the file bytes.
Once the big transfer moves to the browser↔Blob leg, that work has to happen
after the fact. Two ways to trigger it:

- Vercel's documented webhook (`onUploadCompleted`, called server-to-server
  by Vercel Blob) — reliable, retried automatically, but needs a publicly
  reachable URL, so exercising it in local dev requires an ngrok tunnel.
- **Chosen:** a client-driven follow-up call. After `upload()` resolves in
  the browser, the client immediately calls a normal Server Action passing
  only the resulting blob's pathname (a string, nowhere near 4.5MB). That
  action reads the raw bytes back itself — an *outbound* read from the
  Function, not an inbound client request body, so the 4.5MB cap does not
  apply — then runs the same normalize → store → DB-write sequence that
  exists today.

Trade-off accepted: if the browser tab dies between `upload()` resolving and
the follow-up call landing, the raw blob is orphaned (no DB row references
it). Low-stakes for a private, elder-only store; not handled by this design
(no cleanup job). Chosen over the webhook for a much simpler local dev loop
and because Forge is a low-volume internal tool, not a high-traffic public
path.

## Design

### 1. New route: `app/forge/api/art/upload-token/route.ts`

A `POST` handler wrapping `@vercel/blob/client`'s `handleUpload()`.

```ts
export async function POST(request: Request) {
  const body = (await request.json()) as HandleUploadBody;
  const json = await handleUpload({
    body,
    request,
    token: process.env.FORGE_BLOB_READ_WRITE_TOKEN, // targets the FORGE store, not the app's default/public one
    onBeforeGenerateToken: async () => {
      const ctx = await requireElder();
      if (!ctx) throw new Error("Not authorized");
      return {
        allowedContentTypes: ["image/jpeg", "image/png", "image/webp", "image/tiff", "image/tif", "application/octet-stream"],
        addRandomSuffix: true,
      };
    },
    // No onUploadCompleted — the client-driven finalize step (below) does the work.
  });
  return NextResponse.json(json);
}
```

`application/octet-stream` stays in the allowlist because browsers routinely
report an empty or generic MIME type for `.tif`/`.tiff` — the same reason
`art.ts` already has `isTiffByExtension()`. The real content gate stays where
it is today: `sharp()` throwing on undecodable input inside normalization,
not a MIME check at token-issue time.

Auth reuses the existing `requireElder()` (`app/forge/lib/auth.ts`) — no
new auth pattern. A non-elder never gets a token, so never gets a Blob URL.

`handleUpload()` needs a static token to mint client tokens (OIDC alone
isn't enough for this call, unlike `put`/`get` elsewhere in `art.ts`) —
confirmed `FORGE_BLOB_READ_WRITE_TOKEN` is already set in Vercel
Production, Preview, and Development, so no new env var work is needed here.

### 2. Reading the raw upload back — private store, not a bare `fetch`

The Forge art store is `access: 'private'`, so — same as `readForgeArt()`
already does for existing keys — the raw client-uploaded blob has to be
read server-side via the SDK's authenticated `get()`, not a plain `fetch(url)`
(a private blob's bare URL isn't publicly readable). Add one small helper to
`art.ts`, mirroring `readForgeArt` and the read pattern `applyCrop` already
uses:

```ts
export async function readForgeUpload(pathname: string): Promise<Buffer | null> {
  const blob = await get(pathname, { access: "private", ...forgeAuth });
  if (!blob || blob.statusCode !== 200) return null;
  return Buffer.from(await new Response(blob.stream).arrayBuffer());
}
```

`uploadForgeArt`/`uploadForgeFinished` change from taking a `File` to taking
a `Buffer` directly (they already immediately do
`Buffer.from(await file.arrayBuffer())` today, so this is a narrowing, not a
behavior change) — letting both the old form-data path and the new
fetch-back path feed them the same way.

### 3. The three existing actions change their second parameter

`uploadArt` / `uploadFinished` / `addArtCandidate` (`cards.ts`,
`artCandidates.ts`) change from `(cardId, formData: FormData)` to
`(cardId, pathname: string)` — the client-uploaded blob's pathname, not a
URL. Their RPC-write logic (the actual "save this as the card's art" step)
is unchanged; only the "receive bytes" half changes:

```ts
export async function addArtCandidate(cardId: string, pathname: string) {
  const ctx = await requireElder();
  if (!ctx) return { ok: false, error: "Not authorized" };

  const raw = await readForgeUpload(pathname);
  if (!raw) return { ok: false, error: "Could not read uploaded image" };
  const invalid = validateArtFile({ type: "", size: raw.length, name: pathname });
  if (invalid) { await del(pathname, { ...forgeAuth }); return { ok: false, error: invalid }; }

  let key: string;
  try {
    key = await uploadForgeArt(raw); // normalize + store under the existing forge-art/ scheme
  } catch {
    await del(pathname, { ...forgeAuth });
    return { ok: false, error: "Could not read image file." };
  }
  await del(pathname, { ...forgeAuth }); // raw upload's job is done; keep only the normalized copy
  // ...unchanged RPC write below
}
```

### 4. Size cap

`MAX_ART_BYTES` raised from 15MB to **50MB**. Validation logic in
`validateArtFile` (type allowlist, TIFF-by-extension fallback, size check)
is unchanged — it just now runs after the read-back instead of on the
original request. (Client-side, the same check runs before `upload()` starts
too, for instant feedback — same function, called from a client-safe spot.)

### 5. The three upload surfaces

`ArtCandidatesPanel.tsx`, `StudioEditor.tsx`, `FullModeForm.tsx` swap:

```ts
// before
const fd = new FormData(); fd.set("file", file);
const r = await addArtCandidate(cardId, fd);
```
```ts
// after
try {
  // "forge-art-raw/" keeps raw uploads out of the normalized forge-art/ keyspace.
  // addRandomSuffix (set server-side) inserts an unguessable suffix before the
  // extension, so isTiffByExtension's .tif/.tiff check still works on read-back —
  // dropping the original filename/extension here would break that fallback.
  const blob = await upload(`forge-art-raw/${file.name}`, file, {
    access: "private",
    handleUploadUrl: "/forge/api/art/upload-token",
  });
  const r = await addArtCandidate(cardId, blob.pathname);
  if (r.ok === false) setErr(r.error);
} catch (e) {
  setErr(e instanceof Error ? e.message : "Upload failed");
} finally {
  setProgress(null); // or equivalent busy-state clear, per component
}
```

This is also where the confirmed hang bug gets fixed, since these call sites
are being rewritten regardless of the size-limit fix:

- `ArtCandidatesPanel.tsx`: wrap the `await addArtCandidate(...)` (now
  `await upload()` + `addArtCandidate(cardId, pathname)`) in
  try/catch/finally so `setProgress(null)` always runs, and a caught error
  joins `errors` like a normal per-file failure already does.
- `StudioEditor.tsx`: already has try/finally (spinner clears); add the
  missing `setErr(...)` in the catch so a failure is visible instead of a
  silent no-op.
- `FullModeForm.tsx`: currently has no busy state or catch at all; add both,
  matching the pattern used in the other two.

### 6. Out of scope

`app/forge/api/import/route.ts` (bulk Lackey import, up to 12 files in one
POST) hits the same 4.5MB ceiling but fixing it means restructuring the
batch contract (client uploads each file to Blob first, the batch POST
carries only URLs/keys). Deferred — separate project.

### Testing

- Primary repro: `tmp/file_example_TIFF_5MB.tiff` (currently hangs) — confirm
  it succeeds end-to-end (uploads, normalizes, appears as a candidate) after
  the fix.
- `tmp/file_example_TIFF_1MB.tiff` as a control that already worked, to
  confirm no regression.
- A same-size JPEG/PNG as a control that the fix isn't TIFF-specific.
- A file over 50MB: confirm a clean, visible error (not a hang).
- A malformed/non-image file: confirm `sharp`'s decode-time rejection still
  surfaces a clean error through the new path.
