import { describe, expect, it } from "vitest";
import type { AppEnv } from "../../../../src/config/env.js";
import { BearerHeaderProvider } from "../../../../src/wave/auth/bearer-passthrough.js";
import { EnvTokenProvider } from "../../../../src/wave/auth/env-token.js";
import { MockProvider } from "../../../../src/wave/auth/mock.js";
import { selectProvider } from "../../../../src/wave/auth/select.js";

const baseEnv = {
  WAVE_DEFAULT_BUSINESS_ID: "biz_x",
  WAVE_GRAPHQL_ENDPOINT: "https://x",
  LOG_LEVEL: "info",
  LOG_PII: false,
  NODE_ENV: "test",
  ALLOWED_ORIGINS: "*",
  RATE_LIMIT_RPM: 60,
  PUBLIC_BASE_URL: "http://localhost:8080",
  OAUTH_ISSUER_URL: "http://localhost:8080",
  OAUTH_STORE_PATH: ".data/oauth-store.json",
  OAUTH_ACCESS_TOKEN_TTL_SECONDS: 3600,
  OAUTH_REFRESH_TOKEN_TTL_SECONDS: 2592000,
  OAUTH_AUTH_CODE_TTL_SECONDS: 300,
  OAUTH_ALLOWED_REDIRECT_URIS:
    "https://claude.ai/api/mcp/auth_callback,https://claude.com/api/mcp/auth_callback",
} as const satisfies Omit<AppEnv, "WAVE_AUTH_MODE" | "WAVE_API_TOKEN">;

describe("selectProvider", () => {
  it("returns EnvTokenProvider for env_token mode", () => {
    const p = selectProvider({ ...baseEnv, WAVE_AUTH_MODE: "env_token", WAVE_API_TOKEN: "x" });
    expect(p).toBeInstanceOf(EnvTokenProvider);
  });

  it("throws when env_token mode is missing WAVE_API_TOKEN (defensive)", () => {
    expect(() => selectProvider({ ...baseEnv, WAVE_AUTH_MODE: "env_token" })).toThrow();
  });

  it("returns BearerHeaderProvider for bearer_passthrough mode", () => {
    const p = selectProvider({ ...baseEnv, WAVE_AUTH_MODE: "bearer_passthrough" });
    expect(p).toBeInstanceOf(BearerHeaderProvider);
  });

  it("returns MockProvider for mock mode with given token", () => {
    const p = selectProvider({ ...baseEnv, WAVE_AUTH_MODE: "mock", WAVE_API_TOKEN: "fake" });
    expect(p).toBeInstanceOf(MockProvider);
  });

  it("returns MockProvider with default token when none provided", () => {
    const p = selectProvider({ ...baseEnv, WAVE_AUTH_MODE: "mock" });
    expect(p).toBeInstanceOf(MockProvider);
  });
});
