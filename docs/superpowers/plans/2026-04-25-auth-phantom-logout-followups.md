# Auth phantom-logout followups

Created 2026-04-25, updated 2026-04-25 after middleware fan-out fix shipped.

## Status: phantom-logout symptom resolved, watching for regressions

A specific admin user (`jayden.alstad@gmail.com`, mobile Chrome) was hitting "logged in but not really" — UI flips to Sign in / Sign up despite valid cookies. Root cause was a refresh-token rotation race amplified by the app's auth plumbing (multi-region middleware fan-out + multiple client subscriptions + over-aggressive cookie cleanup on transient errors).

After three rounds of fixes, audit logs confirm the symptom is gone for this user (refresh-burst pattern dropped from 35+/min on 2026-04-13 to baseline ~1/hour) and no other users are showing the same pattern.

## Shipped (do NOT redo)

1. **Telemetry pipeline.**
   - Client: [utils/supabase/getUserSafe.ts](../../../utils/supabase/getUserSafe.ts) logs to `console.warn` and `navigator.sendBeacon`s to a server endpoint when forcing a local signOut.
   - Endpoint: [app/api/telemetry/auth-anomaly/route.ts](../../../app/api/telemetry/auth-anomaly/route.ts) receives sendBeacon payloads and logs to Vercel.
   - Server: [utils/supabase/middleware.ts](../../../utils/supabase/middleware.ts) emits `[auth-anomaly]` events with `kind:` discriminators (`getUserSafe.local-signOut`, `middleware.zombie-cookie-cleanup`).
   - Search Vercel logs for `[auth-anomaly]`.

2. **Tightened middleware cookie deletion.** Cookies are only wiped when the server has unambiguously rejected the session (`AuthApiError` with code `refresh_token_already_used` / `refresh_token_not_found` / `session_not_found` / `bad_jwt`). Transient `AuthRetryableFetchError` is ignored — that path was wiping good cookies on flaky-network mobile Chrome.

3. **Stabilized client supabase reference** in three files. `createBrowserClient` is a process-singleton in browser, but `const supabase = createClient()` inside component bodies created a fresh JS reference per render, causing `[supabase]`-keyed effects to refire and call `getUserSafe` (= `getSession` + network `getUser`) every render. Moved to module scope:
   - [components/top-nav.tsx:26](../../../components/top-nav.tsx#L26)
   - [app/tracker/profile/page.tsx:7](../../../app/tracker/profile/page.tsx#L7)
   - [app/decklist/card-search/client.tsx:28](../../../app/decklist/card-search/client.tsx#L28)

4. **Skip `getUser()` in middleware on non-protected routes.** Middleware now only calls `getUser()` when `needsAuth(pathname)` is true OR `pathname === "/"` AND auth cookies are present. Anonymous hits to `/decklist/*`, `/sign-in`, `/spoilers`, `/sitemap.xml`, `/auth/callback`, etc. pass through without touching `/auth/v1/user`. Removed the dead `zombie-cleanup-skipped` diagnostic branch (it was firing on every anonymous request as `AuthSessionMissingError`, generating pure noise). See [utils/supabase/middleware.ts:55-73](../../../utils/supabase/middleware.ts#L55-L73).

5. **Added `/admin` to PROTECTED_PREFIXES.** Eliminates flash-of-unauthorized-content on `/admin/*` for non-signed-in users (they were previously caught only by client-side `useIsAdmin()` in `useEffect`). Admin role check stays client-side; middleware just ensures sign-in.

## Remaining work

Ranked by current evidence. None are urgent — defer until logs justify the work.

### Item A — Tighten `getUserSafe` signOut predicate (low priority)

[utils/supabase/getUserSafe.ts:19](../../../utils/supabase/getUserSafe.ts#L19) currently signs out on *any* `error` from `getUser()` when a session exists. Same false-positive shape the middleware had pre-fix. Apply the matching predicate:

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
  await supabase.auth.signOut({ scope: "local" });
  return null;
}
return session?.user ?? null;
```

**Current signal: none.** Vercel logs over 6h post-fix show zero `getUserSafe.local-signOut` events. The browser-side `sendBeacon` would surface them if they were happening. Re-evaluate after a week of post-fix data.

### Item B — Consolidate redundant auth subscriptions into one provider (defer)

Four files independently call `getUserSafe` AND subscribe to `onAuthStateChange`:
- [components/top-nav.tsx](../../../components/top-nav.tsx)
- [components/providers/AdminProvider.tsx](../../../components/providers/AdminProvider.tsx)
- [app/decklist/card-search/client.tsx](../../../app/decklist/card-search/client.tsx)
- [app/tracker/profile/page.tsx](../../../app/tracker/profile/page.tsx)

Each TOKEN_REFRESHED event triggers 4 setState cascades and AdminProvider's handler re-runs `getUserSafe` plus two RPC calls (`check_admin_role`, `get_my_admin_permissions`).

**Current signal: none.** With the stable supabase reference fix and middleware fan-out gone, the churn is no longer noticeable. Refresh cadence in audit logs is back to ~1/hour per user. Skip until something demands it.

### Item C — Change `signOutAction` to `scope: 'local'` (one-liner, blocked on product call)

[app/actions.ts:142-146](../../../app/actions.ts#L142-L146) calls `supabase.auth.signOut()` with default `scope: 'global'`, which revokes the user's refresh tokens on every device. This may have contributed to the historical pattern of 24+ distinct sessions on Jaylden's account — every Sign out nuked other tabs/devices, those clients then hit `refresh_token_not_found` on next refresh, and created fresh sessions on re-login.

```ts
await supabase.auth.signOut({ scope: "local" });
```

**Blocked on:** Tim to confirm whether "log out everywhere" is intentional (compliance / security feature) or accidental default. If accidental, switch to local.

## Monitoring after deploys

When picking this back up:

1. **Vercel logs filtered to `[auth-anomaly]`.** With the noise branch removed, any event here is real:
   - `kind: "middleware.zombie-cookie-cleanup"` = a session was correctly rejected and cookies wiped. Volume should be very low (one per actual stale-session rotation).
   - `kind: "getUserSafe.local-signOut"` = the client forced a signOut because the server rejected a session. If this appears in volume, Item A becomes urgent.

2. **Supabase audit log refresh-burst query** (run periodically):
   ```sql
   SELECT date_trunc('minute', created_at) AS minute,
          payload->>'actor_id' AS user_id,
          COUNT(*) AS refreshes
   FROM auth.audit_log_entries
   WHERE created_at >= now() - interval '7 days'
     AND payload->>'action' = 'token_refreshed'
   GROUP BY 1, 2
   HAVING COUNT(*) >= 5
   ORDER BY minute DESC;
   ```
   Pre-fix baseline was multiple bursts of 30+/min. Post-fix baseline (verified 2026-04-25) is 0–3 instances per week with max 6/min. Anything over ~10/min is a regression.

3. **Affected user check** (`5584f047-c319-4efb-9ee0-134e85fad7b6`): same query filtered to that actor_id. Should stay at the new baseline.

## Reference

- Supabase project: `redemptionccgapp`, ref `dhxxsolhgvimxtusepht`, region us-east-1.
- Originally affected user: `jayden.alstad@gmail.com`, user_id `5584f047-c319-4efb-9ee0-134e85fad7b6`.
- `@supabase/ssr` and `@supabase/supabase-js` pinned to `latest` in [package.json](../../../package.json).
- `createBrowserClient` singletons in browser at `node_modules/@supabase/ssr/dist/main/createBrowserClient.js:8-15`.
- Refresh-token reuse error shape (from `auth-js/lib/errors.js`): `AuthApiError` with `status: 400`, `code: "refresh_token_already_used"` or `"refresh_token_not_found"`. Network failures are `AuthRetryableFetchError` with `status: 0`. Anonymous requests with no session yield `AuthSessionMissingError`.
