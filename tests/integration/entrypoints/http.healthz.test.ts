import { beforeAll, describe, expect, it } from "vitest";

beforeAll(() => {
  process.env.WAVE_AUTH_MODE = "mock";
  process.env.WAVE_API_TOKEN = "fake";
  process.env.WAVE_DEFAULT_BUSINESS_ID = "biz_x";
  process.env.WAVE_GRAPHQL_ENDPOINT = "https://example.invalid/graphql";
  process.env.LOG_LEVEL = "fatal";
  process.env.NODE_ENV = "test";
});

describe("http /healthz", () => {
  it("returns 200 ok", async () => {
    const { app } = await import("../../../src/entrypoints/http.js");
    const res = await app.request("/healthz");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("/readyz reports issues from unreachable Wave and missing tax tables", async () => {
    const { app } = await import("../../../src/entrypoints/http.js");
    const res = await app.request("/readyz");
    expect(res.status).toBe(503);
    const body = (await res.json()) as { ok: boolean; issues: string[] };
    expect(body.ok).toBe(false);
    expect(body.issues.length).toBeGreaterThan(0);
  });
});
