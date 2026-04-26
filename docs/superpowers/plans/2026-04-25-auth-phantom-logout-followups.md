# Auth phantom-logout followups

Created 2026-04-25 after partial fix shipped. This doc is the handoff for a later agent to pick up the remaining work.

## TL;DR

A specific admin user (`jayden.alstad@gmail.com`, mobile Chrome) was hitting "logged in but not really" — UI flips to Sign in / Sign up despite valid cookies, recurs after deck-builder activity, clearing site data temporarily fixes it. Root cause is a refresh-token rotation race amplified by the app's auth plumbing. Two fixes already shipped; four more are queued behind telemetry observation.

## Audit-log evidence (Supabase, last 30 days for this user)

- **35 `token_refreshed` events in 11.2 seconds** on 2026-04-13 06:18:11–06:18:22 UTC. Baseline is 1–2/min.
- Multiple bursts of 30+ refreshes/min on 2026-04-12, 04-13, and 04-01.
- **Five fresh password logins in 6 minutes** on 2026-04-01 20:52–20:58 UTC, immediately after a refresh burst — user re-signing in repeatedly.
- **`/auth/v1/user` hits from 7+ different remote_addrs in the same second** on 2026-04-26 01:59:07 — Vercel Edge regions running middleware concurrently for one navigation.
- 24 distinct sessions on his account; several created seconds apart.
- 0 explicit `refresh_token_already_used` events in the audit log — but Supabase's audit log only records *successful* refreshes; reuse-detected refreshes 4xx silently and don't get a discrete row.

## What already shipped (do NOT redo)

1. **Telemetry pipeline.**
   - Client: [utils/supabase/getUserSafe.ts](../../../utils/supabase/getUserSafe.ts) logs to `console.warn` and `navigator.sendBeacon`s to a new endpoint when forcing a local signOut.
   - Endpoint: [app/api/telemetry/auth-anomaly/route.ts](../../../app/api/telemetry/auth-anomaly/route.ts) — receives sendBeacon payloads, logs to Vercel.
   - Server: [utils/supabase/middleware.ts](../../../utils/supabase/middleware.ts) emits `[auth-anomaly]` events for both the cookie-cleanup path and the new "skipped" path.
   - All events use `kind:` discriminators: `getUserSafe.local-signOut`, `middleware.zombie-cookie-cleanup`, `middleware.zombie-cleanup-skipped`.
   - Search Vercel logs for `[auth-anomaly]`.

2. **Tightened middleware cookie deletion** ([utils/supabase/middleware.ts:62-110](../../../utils/supabase/middleware.ts#L62-L110)). Now only deletes `sb-*-auth-token` cookies when `error.name === "AuthApiError"` AND code is one of `refresh_token_already_used` / `refresh_token_not_found` / `session_not_found` / `bad_jwt`. Transient `AuthRetryableFetchError` (network blips) is ignored. The `zombie-cleanup-skipped` telemetry event tracks volume of errors correctly *not* acted on.

3. **Stabilized client supabase reference** in three files. `@supabase/ssr`'s `createBrowserClient` already returns a process-singleton in the browser, but the per-component `const supabase = createClient()` inside component bodies created a fresh JS *reference* each render, causing `[supabase]`-keyed effects to refire and call `getUserSafe` (= `getSession` + network `getUser`) every render. Moved to module scope:
   - [components/top-nav.tsx:26](../../../components/top-nav.tsx#L26) (also changed dep `[supabase]` → `[]`)
   - [app/tracker/profile/page.tsx:7](../../../app/tracker/profile/page.tsx#L7) (also changed dep)
   - [app/decklist/card-search/client.tsx:28](../../../app/decklist/card-search/client.tsx#L28) (dep was already `[]`; consistency)

## Remaining work, ranked

### 1. Skip `getUser()` in middleware on non-protected routes

[utils/supabase/middleware.ts:50-53](../../../utils/supabase/middleware.ts#L50-L53) calls `getUser()` unconditionally on every matched request. Single page load fans out across the HTML + RSC payloads + navigation prefetches → multiple Edge regions all calling `/auth/v1/user` in parallel for the same user (the 7-remote-addrs evidence). After a `revalidatePath`, this storm intensifies.

Fix: only call `getUser()` when `needsAuth(pathname)` is true. Otherwise pass through without touching auth.

```ts
// Pseudo:
const pathname = request.nextUrl.pathname;
const requiresAuth = needsAuth(pathname);
if (!requiresAuth && pathname !== "/") {
  return response; // skip getUser entirely
}
const { data: { user }, error } = await supabase.auth.getUser();
// ...rest of logic only runs for protected routes + root
```

Risks: anything that depends on the middleware's always-refresh side effect breaks. Should not be the case in this app — every server component / action calls `createClient()` itself which manages its own session. Verify by checking that no page relies on the middleware to *write* refreshed cookies for it.

### 2. Tighten `getUserSafe` signOut predicate

[utils/supabase/getUserSafe.ts:19](../../../utils/supabase/getUserSafe.ts#L19) currently signs out on *any* `error` from `getUser()` when a session exists. Same false-positive problem the middleware had. Apply the same predicate:

```ts
const errName = (error as any)?.name;
const errCode = (error as any)?.code;
const isSessionRejected =
  errName === "AuthApiError" &&
  (errCode === "refresh_token_already_used" ||
    errCode === "refresh_token_not_found" ||
    errCode === "session_not_found" ||
    errCode === "bad_jwt");
if (session && error && isSessionRejected) {
  // signOut local
}
```

Explicitly do NOT signOut on `AuthRetryableFetchError` — return the cached `session.user` or `null` and let the next call retry naturally.

### 3. Consolidate redundant auth subscriptions into one provider

Four files independently call `getUserSafe` AND subscribe to `onAuthStateChange`:
- [components/top-nav.tsx:90,101](../../../components/top-nav.tsx#L90)
- [components/providers/AdminProvider.tsx:26,55](../../../components/providers/AdminProvider.tsx#L26)
- [app/decklist/card-search/client.tsx:497,503](../../../app/decklist/card-search/client.tsx#L497)
- [app/tracker/profile/page.tsx:13,19](../../../app/tracker/profile/page.tsx#L13)

Each TOKEN_REFRESHED event triggers 4 setState cascades and AdminProvider's `onAuthStateChange` re-runs `getUserSafe` plus two RPC calls (`check_admin_role`, `get_my_admin_permissions`).

Fix: extend `AdminProvider` (or add a sibling `AuthProvider` in the same module) that owns the single `getUserSafe` + `onAuthStateChange` subscription and exposes `{ user, isAdmin, permissions, loading }` via context. All four call sites consume the context instead of subscribing themselves.

This is a moderate refactor (4 files) but eliminates the multi-subscription churn entirely.

### 4. Change `signOutAction` to `scope: 'local'`

[app/actions.ts:142-146](../../../app/actions.ts#L142-L146) calls `supabase.auth.signOut()` with default `scope: 'global'`, which revokes the user's refresh tokens on every device. This explains the 24 distinct sessions on Jaylden's account — every Sign out nukes other tabs/devices, and on next refresh those clients hit `refresh_token_not_found` and create fresh sessions on re-login.

```ts
await supabase.auth.signOut({ scope: 'local' });
```

Confirm with Tim before shipping — there might be an intentional reason for global signout (e.g., compliance, "log out everywhere" feature). If not, switch to local.

## What to look at when starting this work

1. **Read Vercel logs first.** Filter `[auth-anomaly]`. Look at:
   - Volume of `kind: "middleware.zombie-cookie-cleanup"` events (real session rejections after the fix).
   - Volume of `kind: "middleware.zombie-cleanup-skipped"` events (errors we correctly ignored).
   - Volume of `kind: "getUserSafe.local-signOut"` events with non-`AuthApiError` shapes — these are still false-positive client-side signouts and confirm item 2 is needed.
2. **Re-query Supabase audit logs** for Jaylden's user_id `5584f047-c319-4efb-9ee0-134e85fad7b6`. Compare refresh-burst frequency before and after the 2026-04-25 deploy. Should drop substantially if items 1+2 from "shipped" worked.
3. **Tackle the remaining items in order.** Item 1 is highest-leverage, lowest-risk. Item 4 should be a one-liner once Tim confirms.

## Reference

- Supabase project: `redemptionccgapp`, ref `dhxxsolhgvimxtusepht`, region us-east-1.
- Affected user: `jayden.alstad@gmail.com`, user_id `5584f047-c319-4efb-9ee0-134e85fad7b6`.
- `@supabase/ssr` and `@supabase/supabase-js` are pinned to `latest` in [package.json](../../../package.json).
- `createBrowserClient` singletons in browser at `node_modules/@supabase/ssr/dist/main/createBrowserClient.js:8-15`.
- Refresh-token reuse error shape (from `auth-js/lib/errors.js`): `AuthApiError` with `status: 400`, `code: "refresh_token_already_used"` or `"refresh_token_not_found"`. Network failures are `AuthRetryableFetchError` with `status: 0`.
