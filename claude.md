# Project Memory — Redemption Tournament Tracker

## Environment
- Windows 11 Enterprise with corporate TLS inspection proxy
- Running npm/node requires: `$env:NODE_TLS_REJECT_UNAUTHORIZED='0'; $env:Path += ';C:\Program Files\nodejs\';`
- This applies to ANY script that makes outbound HTTPS calls (dev server, upload scripts, etc.)

## Key Architecture
- Next.js App Router, deployed on Vercel Pro
- Supabase for DB
- Card data sourced from GitHub: `raw.githubusercontent.com/jalstad/RedemptionLackeyCCG/master/RedemptionQuick/sets/`
  - `carddata.txt` — tab-separated, ~5,331 cards, fetched at runtime in `app/decklist/card-search/client.tsx`
  - Card images at `.../setimages/general/{name}.jpg`

## Card Image System
- Strategy pattern in `app/decklist/card-search/hooks/useCardImageUrl.ts`
- `STRATEGY` constant controls: `'local'` | `'proxy'` | `'direct'` | `'blob'`
- Currently on `'blob'` — Vercel Blob CDN at `https://qrpnuz0u6exnvyt8.public.blob.vercel-storage.com`
- All 5,175 card images uploaded to blob store `redemption-tournament-track-blob` (region `IAD1`)
- `NEXT_PUBLIC_BLOB_BASE_URL` set in `.env.local` and Vercel (production + preview)
- `app/decklist/card-search/components/CardImage.tsx` — `unoptimized` only for `/api/` URLs (legacy)
- `scripts/download-images.js` — bulk downloads locally (for `'local'` strategy)
- `scripts/upload-images-to-blob.js` — re-runnable sync script for future card set updates
- Old proxy route `app/api/card-image/[...path]/route.ts` still exists — safe to delete after verifying blob works in prod

## prompt_context/ folder
Contains design docs, plans, and context files used to brief Claude sessions. Check here first for prior decisions.
