import { NextResponse } from "next/server";
import { extractBearerToken, verifyApiKey, touchLastUsedAt } from "@/lib/api/auth";
import {
  extractClientIp,
  rateLimitForKey,
  rateLimitForUnauthIp,
  type RateLimitResult,
} from "@/lib/api/rateLimit";
import { loadPublicDeckDetail, isUuid } from "@/lib/api/cache";
import { errorResponse } from "@/lib/api/errors";
import { preflightResponse, withCors } from "@/lib/api/cors";

export const runtime = "nodejs";

function rateLimitHeaders(rl: RateLimitResult): Record<string, string> {
  return {
    "X-RateLimit-Limit": String(rl.limit),
    "X-RateLimit-Remaining": String(Math.max(0, rl.remaining)),
    "X-RateLimit-Reset": String(rl.reset),
  };
}

function applyHeaders(res: NextResponse, headers: Record<string, string>): NextResponse {
  for (const [k, v] of Object.entries(headers)) res.headers.set(k, v);
  return res;
}

export async function OPTIONS() {
  return preflightResponse();
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const token = extractBearerToken(req.headers.get("authorization"));
  if (!token) {
    const ip = extractClientIp(req);
    await rateLimitForUnauthIp(ip);
    return withCors(errorResponse("unauthorized", "Missing or invalid Authorization header."));
  }

  const verified = await verifyApiKey(token);
  if (!verified) {
    const ip = extractClientIp(req);
    await rateLimitForUnauthIp(ip);
    return withCors(errorResponse("unauthorized", "Missing or invalid Authorization header."));
  }

  const keyRl = await rateLimitForKey(verified.key_prefix);
  if (!keyRl.success) {
    const retry = Math.max(1, keyRl.reset - Math.floor(Date.now() / 1000));
    return withCors(
      applyHeaders(
        errorResponse("rate_limit_exceeded", `Rate limit exceeded. Retry after ${retry}s.`, {
          retry_after_seconds: retry,
        }),
        { ...rateLimitHeaders(keyRl), "Retry-After": String(retry) },
      ),
    );
  }

  const { id } = await ctx.params;
  if (!isUuid(id)) {
    return withCors(applyHeaders(errorResponse("invalid_request", "id must be a UUID."), rateLimitHeaders(keyRl)));
  }

  let body;
  try {
    body = await loadPublicDeckDetail(id);
  } catch (e) {
    console.error("loadPublicDeckDetail failed", e);
    return withCors(applyHeaders(errorResponse("internal_error", "Unexpected server error."), rateLimitHeaders(keyRl)));
  }

  if (!body) {
    return withCors(applyHeaders(errorResponse("deck_not_found", `No public deck with id '${id}' exists.`), rateLimitHeaders(keyRl)));
  }

  touchLastUsedAt(verified.id);

  const res = NextResponse.json(body, { status: 200 });
  applyHeaders(res, {
    ...rateLimitHeaders(keyRl),
    "Cache-Control": "public, s-maxage=300, stale-while-revalidate=3600",
  });
  return withCors(res);
}
