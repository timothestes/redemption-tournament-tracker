# Vercel Blob Migration — Card Images

## STATUS: COMPLETE ✓ (completed 2026-02-18)

All steps finished. App is live on blob strategy. See summary below.

---

## What Was Done

### Blob Store
- Store: `redemption-tournament-track-blob`, region `IAD1`
- Base URL: `https://qrpnuz0u6exnvyt8.public.blob.vercel-storage.com`
- **5,175 card images uploaded** to `card-images/{name}.jpg` paths — 0 errors, 0 missing

### Code Changes Made
| File | Change |
|---|---|
| `app/decklist/card-search/hooks/useCardImageUrl.ts` | Added `'blob'` strategy, `STRATEGY` set to `'blob'` |
| `next.config.js` | Added `*.public.blob.vercel-storage.com` to `remotePatterns` |
| `app/decklist/card-search/components/CardImage.tsx` | `unoptimized` check kept for `/api/` URLs (legacy) |
| `scripts/upload-images-to-blob.js` | New script — re-runnable sync for future card set updates |
| `package.json` | Added `@vercel/blob` dependency |
| `.env.local` | Has `BLOB_READ_WRITE_TOKEN` and `NEXT_PUBLIC_BLOB_BASE_URL` |

### Env Vars
| Variable | Value | Status |
|---|---|---|
| `NEXT_PUBLIC_BLOB_BASE_URL` | `https://qrpnuz0u6exnvyt8.public.blob.vercel-storage.com` | Set in Vercel (prod + preview) + `.env.local` |
| `BLOB_READ_WRITE_TOKEN` | `vercel_blob_rw_QRPnUz0U6eXnvyT8_...` | Set in Vercel + `.env.local` |

### Remaining Cleanup (optional)
- `app/api/card-image/[...path]/route.ts` — old GitHub proxy route, safe to **delete** once blob is verified in prod
- `scripts/download-images.js` — only needed for `'local'` strategy, can be kept or removed

---

## Rollback
Change `STRATEGY = 'proxy'` in `useCardImageUrl.ts` and redeploy. All old proxy infrastructure still intact.

---

## Future: Syncing New Card Sets
Re-run the upload script — skip logic means only new images are uploaded:
```powershell
$env:NODE_TLS_REJECT_UNAUTHORIZED='0'; node scripts/upload-images-to-blob.js
```

---

## Original Goal
Move card image serving from the current GitHub proxy (`/api/card-image/`) to Vercel Blob storage, eliminating the dependency on the external GitHub repo and giving us a fast, CDN-served, independently-updateable asset store.

## Current Architecture

- **Source data:** `carddata.txt` fetched from `raw.githubusercontent.com/jalstad/RedemptionLackeyCCG` at runtime in `client.tsx`
- **Image strategy:** `'proxy'` — Next.js API route at `app/api/card-image/[...path]/route.ts` fetches images from the same GitHub repo and re-serves them with 1-year cache headers
- **Strategy hook:** `app/decklist/card-search/hooks/useCardImageUrl.ts` — supports `'local'`, `'proxy'`, `'direct'` strategies via a single `STRATEGY` constant
- **Bulk download script:** `scripts/download-images.js` — downloads all card images locally (used for the `'local'` strategy)
- **Card count:** ~5,331 cards (lines in carddata.txt), all images are small JPEGs — total size estimated well under 5 GB Pro included allowance

## Vercel Blob Facts (Pro Plan)

- **5 GB included/month** — card images will fit easily at no extra cost
- **$0.023/GB/month** beyond included
- **$0.05/GB data transfer** (3x cheaper than Fast Data Transfer)
- **CDN-served globally** — same edge network as the rest of the app
- **No deployment dependency** — images can be updated without redeploying the app
- **Max blob size:** 5 TB (512 MB cache limit per blob — irrelevant for card images)

---

## Blob Store — Already Created

- **Name:** `redemption-tournament-track-blob`
- **Region:** `IAD1` (US East — matches typical Vercel Pro default)
- **Status:** Created, connected to project, currently empty
- `BLOB_READ_WRITE_TOKEN` is already populated in Vercel environment variables
- Run `vercel env pull` locally to get the token into `.env.local`

The `@vercel/blob` SDK `put()` API used for uploads:
```ts
import { put } from "@vercel/blob";
const { url } = await put('card-images/CardName.jpg', fileBuffer, { access: 'public', addRandomSuffix: false });
```

> ⚠️ Server-side uploads via API routes are capped at **4.5 MB per request**. The upload script runs locally and calls the SDK directly, so this limit does not apply.

---

## Migration Steps

### Step 1 — Pull env vars and install SDK

```bash
vercel env pull   # gets BLOB_READ_WRITE_TOKEN into .env.local
npm install @vercel/blob
```

### Step 2 — ~~Create Blob Store~~ (already done)

Store `redemption-tournament-track-blob` is created and connected. Skip this step.

### Step 3 — Write Upload Script

Create `scripts/upload-images-to-blob.js` that:
1. Reads `carddata.txt` from GitHub (same as existing download script)
2. For each card image:
   - Downloads from GitHub raw content URL
   - Uploads to Vercel Blob via `put(pathname, buffer, { access: 'public', addRandomSuffix: false })`
   - Uses a consistent path like `card-images/{filename}.jpg`
   - Skips if blob already exists (check via `head()`)
3. Runs with concurrency control (same pattern as existing download script — 10 at a time)

This is essentially a modified version of the existing `scripts/download-images.js` that uploads to Blob instead of writing to disk.

**Requires:** `BLOB_READ_WRITE_TOKEN` env var set locally (copy from Vercel dashboard).

### Step 4 — Run the Upload Script

Due to the corporate TLS inspection in this environment, run with TLS verification disabled (same workaround required for `npm run dev`):

```powershell
$env:NODE_TLS_REJECT_UNAUTHORIZED='0'; node scripts/upload-images-to-blob.js
```

One-time operation. ~5,331 images. Re-runnable safely due to skip logic.

### Step 5 — Add `'blob'` Strategy to `useCardImageUrl.ts`

In `app/decklist/card-search/hooks/useCardImageUrl.ts`, add a fourth strategy:

```typescript
const STRATEGY = 'blob' as 'local' | 'proxy' | 'direct' | 'blob';

// In getImageUrl():
case 'blob':
  const baseUrl = process.env.NEXT_PUBLIC_BLOB_BASE_URL;
  return `${baseUrl}/card-images/${sanitizedImgFile}.jpg`;
```

Add `NEXT_PUBLIC_BLOB_BASE_URL` env var pointing to the Blob store's public base URL (e.g. `https://xxxx.public.blob.vercel-storage.com`). This is a public read URL, safe to expose client-side.

### Step 6 — Remove or Simplify the API Proxy Route

Once `'blob'` strategy is active, `app/api/card-image/[...path]/route.ts` is no longer needed. Delete it (or keep for fallback during transition).

Also update `CardImage.tsx` — the `unoptimized` check (`src.startsWith('/api/')`) can be removed or updated since blob URLs are external and Next.js Image optimization should work with them (add the blob hostname to `next.config.js` image domains).

### Step 7 — Update `next.config.js`

Add the Vercel Blob hostname to allowed image domains:

```js
images: {
  remotePatterns: [
    {
      protocol: 'https',
      hostname: '*.public.blob.vercel-storage.com',
    },
  ],
},
```

This lets Next.js Image optimize blob-served images (optional but beneficial).

### Step 8 — Set Environment Variables

| Variable | Value | Where |
|---|---|---|
| `NEXT_PUBLIC_BLOB_BASE_URL` | Blob store public URL | Vercel + `.env.local` |
| `BLOB_READ_WRITE_TOKEN` | From Vercel dashboard | Vercel + `.env.local` (upload script only) |

### Step 9 — Deploy and Verify

1. Deploy with `STRATEGY = 'blob'`
2. Verify images load on card search page
3. Check Vercel Blob dashboard for request metrics
4. Monitor Fast Origin Transfer costs (should be near zero)

---

## Future: Keeping Images in Sync

When new card sets are released in the source GitHub repo:
- Re-run `scripts/upload-images-to-blob.js` — skip logic means only new images are uploaded
- No redeployment needed; new images are immediately available

Optionally wire this into a cron job or GitHub Action that monitors the source repo for changes.

---

## Rollback Plan

The `STRATEGY` constant in `useCardImageUrl.ts` makes rollback trivial — switch back to `'proxy'` and redeploy. The proxy route and all existing logic remain intact until explicitly deleted.

---

## Files Touched

| File | Change |
|---|---|
| `app/decklist/card-search/hooks/useCardImageUrl.ts` | Add `'blob'` strategy, update `STRATEGY` constant |
| `app/decklist/card-search/components/CardImage.tsx` | Update `unoptimized` logic for blob URLs |
| `app/api/card-image/[...path]/route.ts` | Delete once verified |
| `next.config.js` | Add blob hostname to image remotePatterns |
| `scripts/upload-images-to-blob.js` | New script (one-time upload) |
| `.env.local` / Vercel env vars | Add `NEXT_PUBLIC_BLOB_BASE_URL`, `BLOB_READ_WRITE_TOKEN` |
| `package.json` | Optionally add `"upload-images": "node scripts/upload-images-to-blob.js"` |
