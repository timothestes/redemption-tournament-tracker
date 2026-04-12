# Auth Session Persistence Fixes

**Date:** 2026-04-05
**Problem:** Users are frequently getting logged out, causing frustration on a casual site.

## Root Cause Analysis

Supabase logs confirmed **refresh token race conditions** as the primary issue:
- 36 users experienced concurrent token refresh bursts in the last 7 days
- Up to 10 parallel refresh requests per second per user
- Several users show 3-30 second sessions (login immediately followed by logout)
- Supabase's 10-second reuse interval silently absorbs most races, but when exceeded, sessions die

### Contributing Factors

1. **Middleware redirects lose cookies** — When middleware creates `NextResponse.redirect()`, Supabase response cookies (containing refreshed tokens) are not copied to the redirect response. Documented pitfall in Supabase SSR docs.

2. **Middleware only refreshes on protected routes** — While the browser client handles its own refresh independently, the server-side cookie state gets stale for Server Components on unprotected routes. Refreshing on all routes reduces the window for client-server cookie desync.

3. **Top-nav auth effect has wrong dependencies** — `[theme, resolvedTheme]` causes unnecessary `getUser()` calls and subscription re-creation on theme changes.

4. **Auth callback has no error handling** — `exchangeCodeForSession` failures silently redirect, making failed logins look like logouts.

5. **Profile page has no auth state listener** — Stale auth state if session changes while on the page.

## Changes

### 1. Middleware (`utils/supabase/middleware.ts`)

- Always call `supabase.auth.getUser()` on every request (not just protected routes). This ensures the server-side cookie is refreshed regardless of which page the user is on.
- When creating redirect responses, copy all cookies from the Supabase response onto the redirect. This prevents losing refreshed tokens during redirects.

### 2. Top-nav (`components/top-nav.tsx`)

- Split the single `useEffect` into two: one for theme/logo (runs on `[theme, resolvedTheme]`), one for auth (runs once on `[]`).
- This eliminates unnecessary `getUser()` network calls and subscription churn on theme changes.

### 3. Auth Callback (`app/auth/callback/route.ts`)

- Check error responses from `exchangeCodeForSession` and `verifyOtp`.
- Redirect to sign-in with an error message on failure instead of silently dropping the user on a page without a session.

### 4. Profile Page (`app/tracker/profile/page.tsx`)

- Add `onAuthStateChange` listener so the UI reacts to session changes.
- Move Supabase client creation inside the component (currently at module level — fine since it's a singleton, but better practice inside).

## Non-Changes (Investigated but Not Needed)

- **`getClaims()` migration** — While recommended by Supabase for performance, `getClaims()` doesn't verify server-side session validity. Keeping `getUser()` for now; can migrate later.
- **Package version pinning** — `"latest"` in package.json is protected by lockfile in normal usage. Not changing to avoid unrelated diff noise.
- **Session handler** — `getSession()` call in reset-password handler is intentional (reads recovery token from URL hash).
