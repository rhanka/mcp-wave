import { describe, expect, it } from "vitest";
import { createLogger, redact } from "../../../src/config/logger.js";

describe("redact", () => {
  it("redacts authorization headers", () => {
    const out = redact({ headers: { authorization: "Bearer abc123" } });
    expect(out).toEqual({ headers: { authorization: "[REDACTED]" } });
  });

  it("redacts token-like keys at any depth", () => {
    const out = redact({ a: { token: "x", b: { api_token: "y" } } });
    expect(out).toEqual({ a: { token: "[REDACTED]", b: { api_token: "[REDACTED]" } } });
  });

  it("redacts emails when LOG_PII is false", () => {
    const out = redact({ email: "a@b.c", recipient: "x@y.z" }) as Record<string, unknown>;
    expect(out.email).toBe("[REDACTED]");
    expect(out.recipient).toBe("[REDACTED]");
  });

  it("preserves non-sensitive keys", () => {
    const out = redact({ id: "inv_1", amount: 42, currency: "CAD" });
    expect(out).toEqual({ id: "inv_1", amount: 42, currency: "CAD" });
  });

  it("handles arrays", () => {
    const out = redact({ list: [{ token: "x" }, { id: 1 }] });
    expect(out).toEqual({ list: [{ token: "[REDACTED]" }, { id: 1 }] });
  });
});

describe("createLogger", () => {
  it("returns a pino logger with the requested level", () => {
    const log = createLogger({ level: "debug", logPII: false });
    expect(log.level).toBe("debug");
  });
});
