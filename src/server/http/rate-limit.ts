import type { Context, MiddlewareHandler } from "hono";

interface Bucket {
  tokens: number;
  updatedAt: number;
}

export interface RateLimitOptions {
  /**
   * Upper bound on tracked client keys. When reached, buckets that have fully
   * refilled are evicted first; if the map is still full, the oldest entries
   * are dropped. Bounds memory against key-spraying clients.
   */
  maxKeys?: number;
}

const DEFAULT_MAX_KEYS = 10_000;

// Every limiter keeps its own buckets (so a strict per-route limiter does not
// share state with the global one); the registry only exists for test resets.
const REGISTRY = new Set<Map<string, Bucket>>();

/**
 * Client key for rate limiting.
 *
 * The left-most X-Forwarded-For entry is whatever the client chose to send, so
 * keying on it lets a caller bypass the limit by rotating the header. The
 * right-most entry is the peer address appended (or set) by the nearest
 * reverse proxy (Traefik in front of this pod), which the client cannot forge.
 */
export function clientKey(c: Context): string {
  const xff = c.req.header("x-forwarded-for");
  if (xff) {
    const hops = xff
      .split(",")
      .map((h) => h.trim())
      .filter((h) => h.length > 0);
    const last = hops.at(-1);
    if (last) return last;
  }
  return c.req.header("x-real-ip")?.trim() || "anon";
}

export function rateLimit(rpm: number, options: RateLimitOptions = {}): MiddlewareHandler {
  const refillRate = rpm / 60_000;
  const maxKeys = options.maxKeys ?? DEFAULT_MAX_KEYS;
  const buckets = new Map<string, Bucket>();
  REGISTRY.add(buckets);

  const evict = (now: number): void => {
    for (const [key, b] of buckets) {
      if (b.tokens + (now - b.updatedAt) * refillRate >= rpm) buckets.delete(key);
    }
    // Map iteration order is insertion order: drop the oldest until under cap.
    for (const key of buckets.keys()) {
      if (buckets.size < maxKeys) break;
      buckets.delete(key);
    }
  };

  return async (c, next) => {
    const key = clientKey(c);
    const now = Date.now();
    let bucket = buckets.get(key);
    if (!bucket) {
      if (buckets.size >= maxKeys) evict(now);
      bucket = { tokens: rpm, updatedAt: now };
    }

    bucket.tokens = Math.min(rpm, bucket.tokens + (now - bucket.updatedAt) * refillRate);
    bucket.updatedAt = now;
    buckets.set(key, bucket);

    if (bucket.tokens < 1) {
      return c.json(
        {
          error: "RATE_LIMITED",
          retry_after_ms: Math.ceil((1 - bucket.tokens) / refillRate),
        },
        429,
      );
    }

    bucket.tokens -= 1;
    return next();
  };
}

export function __clearRateLimitBucketsForTests(): void {
  for (const buckets of REGISTRY) buckets.clear();
}
