import { describe, expect, it } from "vitest";
import { WaveApiError } from "../../../src/lib/errors.js";
import { isRetryable } from "../../../src/lib/retry.js";

describe("isRetryable", () => {
  it("returns true for 429", () => {
    expect(isRetryable(new WaveApiError("RATE_LIMITED", 429, null))).toBe(true);
  });
  it("returns true for 5xx", () => {
    expect(isRetryable(new WaveApiError("INTERNAL_SERVER_ERROR", 503, null))).toBe(true);
  });
  it("returns false for 4xx (non-429)", () => {
    expect(isRetryable(new WaveApiError("VALIDATION_ERROR", 400, null))).toBe(false);
    expect(isRetryable(new WaveApiError("AUTHENTICATION_ERROR", 401, null))).toBe(false);
    expect(isRetryable(new WaveApiError("NOT_FOUND", 404, null))).toBe(false);
  });
  it("returns true for network-like errors", () => {
    const e = new Error("ECONNRESET") as Error & { code?: string };
    e.code = "ECONNRESET";
    expect(isRetryable(e)).toBe(true);
  });
  it("returns false for unknown errors", () => {
    expect(isRetryable(new Error("oops"))).toBe(false);
  });
  it("returns false for non-error values", () => {
    expect(isRetryable("string")).toBe(false);
    expect(isRetryable(null)).toBe(false);
  });
});
