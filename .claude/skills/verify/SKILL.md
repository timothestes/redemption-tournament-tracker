---
name: verify
description: How to drive this app end-to-end for verification — mint real Supabase sessions as cookies, run standalone Playwright against the dev server, which accounts to use for Forge flows.
---

# Verifying changes end-to-end

## Launch

```bash
npm run dev   # localhost:3000; falls back to 3001 if 3000 is taken — check the log line
```

`curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/` → `307` means up
(root redirects). `000` → check the port in the dev log.

## Auth: mint sessions as cookies (no UI login needed)

Mint a session for any existing user via the Supabase admin API and encode it
as `@supabase/ssr` cookies. Recipe (keys from `.env.local`):

1. `POST {SUPABASE_URL}/auth/v1/admin/generate_link` (service key, type
   `magiclink`, the email) → take `hashed_token` — **this project's gotrue
   returns it at the TOP LEVEL**, not under `properties`.
2. `POST {SUPABASE_URL}/auth/v1/verify` (anon key,
   `{type:"magiclink", token_hash}`) → full session JSON.
3. Cookie value = `"base64-" + base64url(JSON.stringify(session))`, chunked at
   3180 chars into `sb-<project-ref>-auth-token.0`, `.1`, …
   (single chunk → no suffix). Set via Playwright `context.addCookies` with
   `url: "http://localhost:3000"`.

## Drive with standalone Playwright

The Playwright **MCP** browser profile is often locked by another session
("Browser is already in use"). Don't fight it — write a standalone `.mjs`
script in the scratchpad importing
`node_modules/playwright/index.mjs` (already installed), one
`browser.newContext()` per user, and run it with `node`. Screenshot to the
scratchpad and Read the images.

## Forge flows: which accounts

- `baboonytim@gmail.com` — superadmin + set elder; sees all sets, owns decks.
- `landofredemption@gmail.com` — playtester member but **no set grants**:
  perfect for exercising "forge card not shared with you" paths.
- Membership = `playtest_members` row; set visibility = `forge_set_grants`.
  Non-members get 404 everywhere under `/forge` (secrecy), so a 404 probe
  without cookies is the standard anon check.

## Clean up

Anything created through the UI lands in the live Supabase project — delete
test rows (e.g. `forge_decks` copies) and restore flags via SQL when done,
and `pkill -f "next dev"` if you started the server.
