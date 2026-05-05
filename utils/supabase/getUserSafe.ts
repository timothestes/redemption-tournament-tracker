import type { SupabaseClient, User } from "@supabase/supabase-js";

// Client-side getUser with zombie-session detection. If a local session exists
// (cookie parses) but the server *rejects* it — refresh token rotation race,
// reuse detection, network-interrupted refresh — force a local sign-out so
// the UI reflects real auth state instead of showing "logged in" with every
// server write silently failing.
//
// Distinguishes "server rejected" (zombie session, sign out) from "request
// never reached server" (network blip, keep session) by checking for
// AuthRetryableFetchError / status:0. The latter previously caused phantom
// logouts on transient mobile network failures — production telemetry showed
// 3+ concurrent callers all signing out on the same blip.
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
    const errorName = (error as { name?: string })?.name ?? null;
    const errorStatus = (error as { status?: number })?.status ?? null;
    const isTransient =
      errorName === "AuthRetryableFetchError" || errorStatus === 0;

    reportAuthAnomaly({
      kind: isTransient
        ? "getUserSafe.transient-skip"
        : "getUserSafe.local-signOut",
      errorName,
      errorStatus,
      errorCode: (error as { code?: string })?.code ?? null,
      errorMessage: error?.message ?? null,
      sessionExpiresAt: session?.expires_at ?? null,
      userIdPrefix: session?.user?.id ? session.user.id.slice(0, 8) : null,
    });

    if (isTransient) {
      return session.user ?? null;
    }

    await supabase.auth.signOut({ scope: "local" });
    return null;
  }

  return user;
}

// Diagnostic-only. Fire-and-forget: console for live debugging, sendBeacon to
// /api/telemetry/auth-anomaly so the event lands in server logs even when the
// user doesn't have devtools open.
const BEACON_DEDUP_WINDOW_MS = 1000;
let lastBeaconKey = "";
let lastBeaconAt = 0;

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
  // Concurrent callers (top nav + admin provider + page-specific check)
  // routinely fire identical beacons in the same tick on a single blip.
  // Dedup by kind+errorName within a short window — console.warn still fires
  // every time so per-call debugging isn't affected.
  const key = `${payload.kind}:${payload.errorName}`;
  const now = Date.now();
  if (key === lastBeaconKey && now - lastBeaconAt < BEACON_DEDUP_WINDOW_MS) {
    return;
  }
  lastBeaconKey = key;
  lastBeaconAt = now;
  try {
    const blob = new Blob([JSON.stringify(enriched)], {
      type: "application/json",
    });
    navigator.sendBeacon("/api/telemetry/auth-anomaly", blob);
  } catch {}
}
