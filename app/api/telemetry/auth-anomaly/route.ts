import { NextResponse } from "next/server";

// Diagnostic-only sink for client-side auth anomalies (forced local signOut,
// zombie session detection). Lands in Vercel function logs so we can correlate
// with Supabase auth logs without asking the user to open devtools.
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const ua = request.headers.get("user-agent") ?? null;
    const ip =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
    console.warn(
      "[auth-anomaly]",
      JSON.stringify({ ...body, ua, ip }),
    );
  } catch {
    // Swallow — telemetry must never throw.
  }
  return NextResponse.json({ ok: true });
}
