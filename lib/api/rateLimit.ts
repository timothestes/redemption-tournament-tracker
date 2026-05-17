import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

export type RateLimitResult = {
  success: boolean;
  limit: number;
  remaining: number;
  reset: number; // unix epoch seconds
};

let _redis: Redis | null = null;
function redis(): Redis {
  if (!_redis) {
    const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
    if (!url || !token) throw new Error("KV_REST_API_URL/TOKEN not set");
    _redis = new Redis({ url, token });
  }
  return _redis;
}

let _perKeyMinute: Ratelimit | null = null;
function perKeyMinute(): Ratelimit {
  if (!_perKeyMinute) {
    _perKeyMinute = new Ratelimit({
      redis: redis(),
      limiter: Ratelimit.slidingWindow(60, "1 m"),
      analytics: false,
      prefix: "rtt:api:key-min",
    });
  }
  return _perKeyMinute;
}

let _perKeyDay: Ratelimit | null = null;
function perKeyDay(): Ratelimit {
  if (!_perKeyDay) {
    _perKeyDay = new Ratelimit({
      redis: redis(),
      limiter: Ratelimit.slidingWindow(10_000, "1 d"),
      analytics: false,
      prefix: "rtt:api:key-day",
    });
  }
  return _perKeyDay;
}

let _perIpUnauthMinute: Ratelimit | null = null;
function perIpUnauthMinute(): Ratelimit {
  if (!_perIpUnauthMinute) {
    _perIpUnauthMinute = new Ratelimit({
      redis: redis(),
      limiter: Ratelimit.slidingWindow(30, "1 m"),
      analytics: false,
      prefix: "rtt:api:ip-unauth",
    });
  }
  return _perIpUnauthMinute;
}

/** Vercel-verified client IP; comma-separated lists return the first entry. */
export function extractClientIp(req: Request): string {
  const vercel = req.headers.get("x-vercel-forwarded-for");
  if (vercel) return vercel.split(",")[0].trim();
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return "unknown";
}

/** Check both per-minute and per-day caps for an API key. Stricter wins. */
export async function rateLimitForKey(keyPrefix: string): Promise<RateLimitResult> {
  const id = `key:${keyPrefix}`;
  const [m, d] = await Promise.all([perKeyMinute().limit(id), perKeyDay().limit(id)]);
  const stricter = m.remaining <= d.remaining ? m : d;
  return {
    success: m.success && d.success,
    limit: stricter === m ? 60 : 10_000,
    remaining: stricter.remaining,
    reset: Math.ceil(stricter.reset / 1000),
  };
}

/** Pre-401 IP throttle, to slow key-guessing. */
export async function rateLimitForUnauthIp(ip: string): Promise<RateLimitResult> {
  const r = await perIpUnauthMinute().limit(`ip:${ip}`);
  return {
    success: r.success,
    limit: 30,
    remaining: r.remaining,
    reset: Math.ceil(r.reset / 1000),
  };
}
