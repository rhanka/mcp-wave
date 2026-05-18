import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { originAllowlist } from "../../../../src/server/http/origin-allowlist.js";

function appWithAllowlist(patterns: string[]): Hono {
  const app = new Hono();
  app.use("*", originAllowlist(patterns));
  app.get("/ok", (c) => c.json({ ok: true }));
  return app;
}

describe("originAllowlist", () => {
  it("allows requests without an Origin header", async () => {
    const app = appWithAllowlist(["https://claude.ai"]);

    const response = await app.request("/ok");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });

  it("allows an exact configured origin", async () => {
    const app = appWithAllowlist(["https://claude.ai"]);

    const response = await app.request("/ok", {
      headers: { Origin: "https://claude.ai" },
    });

    expect(response.status).toBe(200);
  });

  it("allows wildcard localhost ports", async () => {
    const app = appWithAllowlist(["http://localhost:*"]);

    const response = await app.request("/ok", {
      headers: { Origin: "http://localhost:5173" },
    });

    expect(response.status).toBe(200);
  });

  it("rejects origins outside the allowlist", async () => {
    const app = appWithAllowlist(["https://claude.ai", "http://localhost:*"]);

    const response = await app.request("/ok", {
      headers: { Origin: "https://evil.example" },
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: "ORIGIN_NOT_ALLOWED",
      origin: "https://evil.example",
      allowed: ["https://claude.ai", "http://localhost:*"],
    });
  });
});
