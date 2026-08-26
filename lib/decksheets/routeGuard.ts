import { NextResponse } from "next/server";
import { rateLimitForUnauthIp, extractClientIp } from "@/lib/api/rateLimit";

/**
 * Shared pre-handler for the /api/v1 decksheets routes: applies the unauth-IP
 * rate limit and returns the 429 envelope on trip. NOT in lib/api — the 429
 * body shape ({status:"error",message}) is decksheets-contract-specific, not
 * the generic API envelope.
 *
 * Fail-open on limiter errors (join/actions.ts pattern): a missing/broken
 * limiter (e.g. KV env unset) must never 500 the request.
 */
export async function guard(req: Request): Promise<NextResponse | null> {
  try {
    const rl = await rateLimitForUnauthIp(extractClientIp(req));
    if (rl.success === false)
      return NextResponse.json({ status: "error", message: "Too many requests. Please try again shortly." }, { status: 429 });
  } catch { /* fail open: limiter must never 500 (join/actions.ts pattern) */ }
  return null;
}
