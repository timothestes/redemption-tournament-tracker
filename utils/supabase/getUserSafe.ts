import type { SupabaseClient, User } from "@supabase/supabase-js";

// Client-side getUser with zombie-session detection. If a local session exists
// (cookie parses) but the server rejects it — refresh token rotation race,
// reuse detection, network-interrupted refresh — force a local sign-out so
// the UI reflects real auth state instead of showing "logged in" with every
// server write silently failing.
export async function getUserSafe(
  supabase: SupabaseClient,
): Promise<User | null> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (session && error) {
    reportAuthAnomaly({
      kind: "getUserSafe.local-signOut",
      errorName: (error as { name?: string })?.name ?? null,
      errorStatus: (error as { status?: number })?.status ?? null,
      errorCode: (error as { code?: string })?.code ?? null,
      errorMessage: error?.message ?? null,
      sessionExpiresAt: session?.expires_at ?? null,
      userIdPrefix: session?.user?.id ? session.user.id.slice(0, 8) : null,
    });
    await supabase.auth.signOut({ scope: "local" });
    return null;
  }

  return user;
}

// Diagnostic-only. Fire-and-forget: console for live debugging, sendBeacon to
// /api/telemetry/auth-anomaly so the event lands in server logs even when the
// user doesn't have devtools open. Remove once the phantom-logout root cause
// is confirmed.
function reportAuthAnomaly(payload: Record<string, unknown>): void {
  if (typeof window === "undefined") return;
  const enriched = {
    ...payload,
    path: window.location.pathname,
    online: navigator.onLine,
    ts: new Date().toISOString(),
  };
  try {
    console.warn("[auth-anomaly]", enriched);
  } catch {}
  try {
    const blob = new Blob([JSON.stringify(enriched)], {
      type: "application/json",
    });
    navigator.sendBeacon("/api/telemetry/auth-anomaly", blob);
  } catch {}
}
