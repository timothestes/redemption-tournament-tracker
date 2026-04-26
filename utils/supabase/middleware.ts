import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

// Routes that require server-side auth check + redirect in middleware.
// Admin routes handle their own auth client-side via useIsAdmin().
const PROTECTED_PREFIXES = ["/tracker"];

// Public pages nested under protected prefixes
const AUTH_EXEMPT = ["/tracker/reset-password", "/tracker/bug"];

function needsAuth(pathname: string): boolean {
  if (AUTH_EXEMPT.some((exempt) => pathname.startsWith(exempt))) return false;
  return PROTECTED_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

export const updateSession = async (request: NextRequest) => {
  try {
    let response = NextResponse.next({
      request: {
        headers: request.headers,
      },
    });

    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return request.cookies.getAll();
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value }) =>
              request.cookies.set(name, value),
            );
            response = NextResponse.next({
              request,
            });
            cookiesToSet.forEach(({ name, value, options }) =>
              response.cookies.set(name, value, options),
            );
          },
        },
      },
    );

    // Always refresh the session on every request to keep the server-side
    // cookie in sync with the browser client. This prevents client-server
    // cookie desync that causes random logouts.
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();

    const pathname = request.nextUrl.pathname;

    // Zombie-session cleanup: only delete cookies when the server has
    // unambiguously rejected the session (AuthApiError with a known
    // refresh/JWT failure code). NEVER delete on AuthRetryableFetchError —
    // that's a network blip, CORS issue, or temporary 5xx, and the cookies
    // would still be valid on retry. Mobile Chrome users on flaky networks
    // were getting their auth cookies wiped by transient fetch failures.
    if (error && !user) {
      const errName = (error as { name?: string })?.name;
      const errCode = (error as { code?: string })?.code;
      const isSessionRejected =
        errName === "AuthApiError" &&
        (errCode === "refresh_token_already_used" ||
          errCode === "refresh_token_not_found" ||
          errCode === "session_not_found" ||
          errCode === "bad_jwt");

      if (isSessionRejected) {
        const staleAuthCookies = request.cookies
          .getAll()
          .filter(
            (c) => c.name.startsWith("sb-") && c.name.includes("-auth-token"),
          );
        if (staleAuthCookies.length > 0) {
          console.warn(
            "[auth-anomaly]",
            JSON.stringify({
              kind: "middleware.zombie-cookie-cleanup",
              errorName: errName ?? null,
              errorStatus: (error as { status?: number })?.status ?? null,
              errorCode: errCode ?? null,
              errorMessage: error?.message ?? null,
              path: pathname,
              staleCookieCount: staleAuthCookies.length,
              ts: new Date().toISOString(),
            }),
          );
          staleAuthCookies.forEach((cookie) => {
            response.cookies.set(cookie.name, "", { maxAge: 0, path: "/" });
          });
        }
      } else {
        // Diagnostic-only: log when we WOULD have deleted cookies under the
        // old over-aggressive logic but didn't. Compare volume vs the
        // zombie-cookie-cleanup events to confirm we're catching the right
        // bucket of errors. Remove this branch once the bug is confirmed fixed.
        console.warn(
          "[auth-anomaly]",
          JSON.stringify({
            kind: "middleware.zombie-cleanup-skipped",
            errorName: errName ?? null,
            errorStatus: (error as { status?: number })?.status ?? null,
            errorCode: errCode ?? null,
            errorMessage: error?.message ?? null,
            path: pathname,
            ts: new Date().toISOString(),
          }),
        );
      }
    }

    // Protected routes: redirect to sign-in if no session
    if (needsAuth(pathname) && !user && error) {
      const fullPath = request.nextUrl.pathname + request.nextUrl.search;
      const signInUrl = new URL("/sign-in", request.url);
      signInUrl.searchParams.set("redirectTo", fullPath);
      const redirectResponse = NextResponse.redirect(signInUrl);
      // Copy refreshed auth cookies onto the redirect so they aren't lost
      response.cookies.getAll().forEach((cookie) => {
        redirectResponse.cookies.set(cookie.name, cookie.value);
      });
      return redirectResponse;
    }

    // Logged-in users hitting root get sent to the tracker
    if (pathname === "/" && user) {
      const redirectResponse = NextResponse.redirect(
        new URL("/tracker", request.url),
      );
      response.cookies.getAll().forEach((cookie) => {
        redirectResponse.cookies.set(cookie.name, cookie.value);
      });
      return redirectResponse;
    }

    return response;
  } catch (e) {
    return NextResponse.next({
      request: {
        headers: request.headers,
      },
    });
  }
};
