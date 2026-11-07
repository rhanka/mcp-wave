import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  __clearRateLimitBucketsForTests,
  rateLimit,
} from "../../../../src/server/http/rate-limit.js";

function appWithRateLimit(rpm: number): Hono {
  const app = new Hono();
  app.use("*", rateLimit(rpm));
  app.get("/ok", (c) => c.json({ ok: true }));
  return app;
}

describe("rateLimit", () => {
  afterEach(() => {
    __clearRateLimitBucketsForTests();
    vi.useRealTimers();
  });

  it("rejects the N+1 request in a tight burst per client IP", async () => {
    vi.setSystemTime(new Date("2026-05-17T00:00:00Z"));
    const app = appWithRateLimit(2);
    const headers = { "x-forwarded-for": "203.0.113.10" };

    expect((await app.request("/ok", { headers })).status).toBe(200);
    expect((await app.request("/ok", { headers })).status).toBe(200);

    const rejected = await app.request("/ok", { headers });

    expect(rejected.status).toBe(429);
    expect(await rejected.json()).toEqual({
      error: "RATE_LIMITED",
      retry_after_ms: 30000,
    });
  });

  it("tracks different x-forwarded-for clients independently", async () => {
    vi.setSystemTime(new Date("2026-05-17T00:00:00Z"));
    const app = appWithRateLimit(1);

    expect(
      (await app.request("/ok", { headers: { "x-forwarded-for": "203.0.113.10" } })).status,
    ).toBe(200);
    expect(
      (await app.request("/ok", { headers: { "x-forwarded-for": "203.0.113.11" } })).status,
    ).toBe(200);
  });

  it("keys on the proxy-appended (right-most) x-forwarded-for hop, not a client-forged one", async () => {
    vi.setSystemTime(new Date("2026-05-17T00:00:00Z"));
    const app = appWithRateLimit(1);

    expect(
      (await app.request("/ok", { headers: { "x-forwarded-for": "203.0.113.10" } })).status,
    ).toBe(200);
    // Rotating a forged left-most hop must not buy a fresh bucket.
    for (const forged of ["198.51.100.1", "198.51.100.2", "anon"]) {
      expect(
        (
          await app.request("/ok", {
            headers: { "x-forwarded-for": `${forged}, 203.0.113.10` },
          })
        ).status,
      ).toBe(429);
    }
  });

  it("keeps separate buckets per limiter instance", async () => {
    vi.setSystemTime(new Date("2026-05-17T00:00:00Z"));
    const app = new Hono();
    app.use("*", rateLimit(100));
    app.post("/strict", rateLimit(1));
    app.all("*", (c) => c.json({ ok: true }));
    const headers = { "x-forwarded-for": "203.0.113.10" };

    expect((await app.request("/strict", { method: "POST", headers })).status).toBe(200);
    expect((await app.request("/strict", { method: "POST", headers })).status).toBe(429);
    // The global limiter still has budget for this client on other routes.
    expect((await app.request("/other", { headers })).status).toBe(200);
  });

  it("bounds tracked keys under key spraying", async () => {
    vi.setSystemTime(new Date("2026-05-17T00:00:00Z"));
    const app = new Hono();
    app.use("*", rateLimit(1, { maxKeys: 3 }));
    app.get("/ok", (c) => c.json({ ok: true }));

    for (let i = 0; i < 50; i += 1) {
      const res = await app.request("/ok", { headers: { "x-forwarded-for": `198.51.100.${i}` } });
      expect(res.status).toBe(200);
    }
    // The newest keys are retained (still throttled); the oldest were evicted.
    expect(
      (await app.request("/ok", { headers: { "x-forwarded-for": "198.51.100.49" } })).status,
    ).toBe(429);
  });

  it("refills tokens over time", async () => {
    vi.setSystemTime(new Date("2026-05-17T00:00:00Z"));
    const app = appWithRateLimit(60);
    const headers = { "x-forwarded-for": "203.0.113.10" };

    for (let i = 0; i < 60; i += 1) {
      expect((await app.request("/ok", { headers })).status).toBe(200);
    }
    expect((await app.request("/ok", { headers })).status).toBe(429);

    vi.setSystemTime(new Date("2026-05-17T00:00:01Z"));

    expect((await app.request("/ok", { headers })).status).toBe(200);
  });
});
