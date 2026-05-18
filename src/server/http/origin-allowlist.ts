import type { MiddlewareHandler } from "hono";

export function originAllowlist(patterns: string[]): MiddlewareHandler {
  const matchers = patterns.map((pattern) => globToRegex(pattern));

  return async (c, next) => {
    const origin = c.req.header("origin");
    if (origin === undefined) {
      return next();
    }

    if (!matchers.some((matcher) => matcher.test(origin))) {
      return c.json({ error: "ORIGIN_NOT_ALLOWED", origin, allowed: patterns }, 403);
    }

    return next();
  };
}

function globToRegex(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`);
}
