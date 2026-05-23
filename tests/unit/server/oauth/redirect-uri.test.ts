import { describe, expect, it } from "vitest";
import { redirectUriAllowed } from "../../../../src/server/oauth/redirect-uri.js";

const allowed = [
  "https://claude.ai/api/mcp/auth_callback",
  "https://claude.com/api/mcp/auth_callback",
];

describe("OAuth redirect URI allowlist", () => {
  it("accepts Claude production callbacks", () => {
    expect(
      redirectUriAllowed("https://claude.ai/api/mcp/auth_callback", allowed, "production"),
    ).toBe(true);
    expect(
      redirectUriAllowed("https://claude.com/api/mcp/auth_callback", allowed, "production"),
    ).toBe(true);
  });

  it("rejects unlisted production callbacks", () => {
    expect(redirectUriAllowed("https://evil.example/callback", allowed, "production")).toBe(false);
    expect(redirectUriAllowed("http://localhost:3000/callback", allowed, "production")).toBe(false);
  });

  it("accepts localhost callbacks outside production", () => {
    expect(redirectUriAllowed("http://localhost:5173/callback", allowed, "development")).toBe(true);
    expect(redirectUriAllowed("http://127.0.0.1:5173/callback", allowed, "test")).toBe(true);
  });

  it("rejects malformed URIs", () => {
    expect(redirectUriAllowed("not-a-url", allowed, "test")).toBe(false);
  });
});
