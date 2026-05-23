import type { RequestHandler } from "express";

export function expressOriginAllowlist(patterns: readonly string[]): RequestHandler {
  const matchers = patterns.map((pattern) => globToRegex(pattern));

  return (req, res, next) => {
    const origin = req.header("origin");
    if (!origin) {
      next();
      return;
    }
    if (!matchers.some((matcher) => matcher.test(origin))) {
      res.status(403).json({ error: "ORIGIN_NOT_ALLOWED", origin, allowed: patterns });
      return;
    }
    next();
  };
}

function globToRegex(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`);
}
