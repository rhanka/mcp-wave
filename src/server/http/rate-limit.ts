import type { MiddlewareHandler } from "hono";

interface Bucket {
  tokens: number;
  updatedAt: number;
}

const BUCKETS = new Map<string, Bucket>();

export function rateLimit(rpm: number): MiddlewareHandler {
  const refillRate = rpm / 60_000;

  return async (c, next) => {
    const key = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || "anon";
    const now = Date.now();
    const bucket = BUCKETS.get(key) ?? { tokens: rpm, updatedAt: now };

    bucket.tokens = Math.min(rpm, bucket.tokens + (now - bucket.updatedAt) * refillRate);
    bucket.updatedAt = now;

    if (bucket.tokens < 1) {
      BUCKETS.set(key, bucket);
      return c.json(
        {
          error: "RATE_LIMITED",
          retry_after_ms: Math.ceil((1 - bucket.tokens) / refillRate),
        },
        429,
      );
    }

    bucket.tokens -= 1;
    BUCKETS.set(key, bucket);

    return next();
  };
}

export function __clearRateLimitBucketsForTests(): void {
  BUCKETS.clear();
}
