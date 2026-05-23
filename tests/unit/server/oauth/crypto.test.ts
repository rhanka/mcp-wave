import { describe, expect, it } from "vitest";
import {
  randomToken,
  sha256Hex,
  timingSafeEqualString,
} from "../../../../src/server/oauth/crypto.js";

describe("OAuth crypto helpers", () => {
  it("hashes token material as sha256 hex", () => {
    expect(sha256Hex("secret-token")).toMatch(/^[a-f0-9]{64}$/);
    expect(sha256Hex("secret-token")).toBe(sha256Hex("secret-token"));
    expect(sha256Hex("secret-token")).not.toBe("secret-token");
  });

  it("generates URL-safe random tokens", () => {
    const token = randomToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(token.length).toBeGreaterThanOrEqual(43);
    expect(randomToken()).not.toBe(token);
  });

  it("compares strings without leaking length through direct comparison", () => {
    expect(timingSafeEqualString("secret", "secret")).toBe(true);
    expect(timingSafeEqualString("secret", "wrong")).toBe(false);
    expect(timingSafeEqualString("secret", "secret-longer")).toBe(false);
  });
});
