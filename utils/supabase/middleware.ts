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
