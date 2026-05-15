import { describe, expect, it } from "vitest";
import { EnvTokenProvider } from "../../../../src/wave/auth/env-token.js";
import { MockProvider } from "../../../../src/wave/auth/mock.js";

const REQ = { headers: null, request_id: "req_1" };

describe("EnvTokenProvider", () => {
  it("returns the constructor token", async () => {
    const p = new EnvTokenProvider("abc");
    expect(await p.getToken(REQ)).toBe("abc");
  });

  it("rejects empty token at construction", () => {
    expect(() => new EnvTokenProvider("")).toThrow();
  });

  it("getIdentity returns env-default", async () => {
    const p = new EnvTokenProvider("abc");
    expect(await p.getIdentity(REQ)).toBe("env-default");
  });
});

describe("MockProvider", () => {
  it("returns the fixture token", async () => {
    const p = new MockProvider("fake");
    expect(await p.getToken(REQ)).toBe("fake");
    expect(await p.getIdentity(REQ)).toBe("mock");
  });

  it("uses a default token when none is provided", async () => {
    const p = new MockProvider();
    expect(await p.getToken(REQ)).toBe("mock-token");
  });
});
