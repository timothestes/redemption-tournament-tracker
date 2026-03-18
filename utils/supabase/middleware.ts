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

    const pathname = request.nextUrl.pathname;

    // Only call getUser() for protected routes and root redirect.
    // Public pages skip the Supabase network call entirely.
    if (needsAuth(pathname) || pathname === "/") {
      const {
        data: { user },
        error,
      } = await supabase.auth.getUser();

      // Protected routes: redirect to sign-in if no session
      if (needsAuth(pathname) && !user && error) {
        return NextResponse.redirect(new URL("/sign-in", request.url));
      }

      // Logged-in users hitting root get sent to the tracker
      if (pathname === "/" && user) {
        return NextResponse.redirect(new URL("/tracker", request.url));
      }
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
