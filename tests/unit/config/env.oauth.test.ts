import { describe, expect, it } from "vitest";
import { parseEnv } from "../../../src/config/env.js";

const base = {
  WAVE_AUTH_MODE: "env_token",
  WAVE_API_TOKEN: "wave-token",
  WAVE_DEFAULT_BUSINESS_ID: "biz_123",
  WAVE_GRAPHQL_ENDPOINT: "https://gql.waveapps.com/graphql/public",
  LOG_LEVEL: "fatal",
  LOG_PII: "false",
  ALLOWED_ORIGINS: "https://claude.ai,https://claude.com",
  RATE_LIMIT_RPM: "60",
};

describe("OAuth environment parsing", () => {
  it("fills safe local OAuth defaults", () => {
    const env = parseEnv({
      ...base,
      NODE_ENV: "development",
    });

    expect(env.PUBLIC_BASE_URL).toBe("http://localhost:8080");
    expect(env.OAUTH_ISSUER_URL).toBe("http://localhost:8080");
    expect(env.OAUTH_STORE_PATH).toBe(".data/oauth-store.json");
    expect(env.OAUTH_ACCESS_TOKEN_TTL_SECONDS).toBe(3600);
    expect(env.OAUTH_REFRESH_TOKEN_TTL_SECONDS).toBe(2592000);
    expect(env.OAUTH_AUTH_CODE_TTL_SECONDS).toBe(300);
    expect(env.OAUTH_ALLOWED_REDIRECT_URIS).toContain("https://claude.ai/api/mcp/auth_callback");
  });

  it("requires an OAuth consent secret for production OAuth HTTP", () => {
    expect(() =>
      parseEnv({
        ...base,
        NODE_ENV: "production",
        PUBLIC_BASE_URL: "https://mcp-wave.example.invalid",
        OAUTH_ISSUER_URL: "https://mcp-wave.example.invalid",
      }),
    ).toThrow("OAUTH_CONSENT_SECRET is required in production");
  });

  it("rejects production HTTP public URLs", () => {
    expect(() =>
      parseEnv({
        ...base,
        NODE_ENV: "production",
        PUBLIC_BASE_URL: "http://mcp-wave.example.invalid",
        OAUTH_ISSUER_URL: "https://mcp-wave.example.invalid",
        OAUTH_CONSENT_SECRET: "secret",
      }),
    ).toThrow("PUBLIC_BASE_URL must use https in production");
  });

  it("rejects production HTTP issuer URLs", () => {
    expect(() =>
      parseEnv({
        ...base,
        NODE_ENV: "production",
        PUBLIC_BASE_URL: "https://mcp-wave.example.invalid",
        OAUTH_ISSUER_URL: "http://mcp-wave.example.invalid",
        OAUTH_CONSENT_SECRET: "secret",
      }),
    ).toThrow("OAUTH_ISSUER_URL must use https in production");
  });
});
