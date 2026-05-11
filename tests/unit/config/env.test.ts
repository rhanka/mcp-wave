import { describe, expect, it } from "vitest";
import { parseEnv } from "../../../src/config/env.js";

describe("parseEnv", () => {
  it("parses a valid env_token configuration", () => {
    const result = parseEnv({
      WAVE_AUTH_MODE: "env_token",
      WAVE_API_TOKEN: "abc123",
      WAVE_DEFAULT_BUSINESS_ID: "biz_xyz",
      WAVE_GRAPHQL_ENDPOINT: "https://gql.waveapps.com/graphql/public",
      LOG_LEVEL: "info",
      NODE_ENV: "test",
    });
    expect(result.WAVE_AUTH_MODE).toBe("env_token");
    expect(result.WAVE_API_TOKEN).toBe("abc123");
  });

  it("rejects env_token mode when WAVE_API_TOKEN is missing", () => {
    expect(() =>
      parseEnv({
        WAVE_AUTH_MODE: "env_token",
        WAVE_DEFAULT_BUSINESS_ID: "biz_xyz",
        WAVE_GRAPHQL_ENDPOINT: "https://x.invalid",
      }),
    ).toThrow(/WAVE_API_TOKEN/);
  });

  it("accepts bearer_passthrough without WAVE_API_TOKEN", () => {
    const r = parseEnv({
      WAVE_AUTH_MODE: "bearer_passthrough",
      WAVE_DEFAULT_BUSINESS_ID: "biz_xyz",
      WAVE_GRAPHQL_ENDPOINT: "https://x.invalid",
    });
    expect(r.WAVE_AUTH_MODE).toBe("bearer_passthrough");
  });

  it("defaults LOG_LEVEL to info, NODE_ENV to development", () => {
    const r = parseEnv({
      WAVE_AUTH_MODE: "mock",
      WAVE_API_TOKEN: "x",
      WAVE_DEFAULT_BUSINESS_ID: "biz_xyz",
      WAVE_GRAPHQL_ENDPOINT: "https://x.invalid",
    });
    expect(r.LOG_LEVEL).toBe("info");
    expect(r.NODE_ENV).toBe("development");
  });

  it("rejects unknown WAVE_AUTH_MODE values", () => {
    expect(() =>
      parseEnv({
        WAVE_AUTH_MODE: "weird",
        WAVE_DEFAULT_BUSINESS_ID: "biz_xyz",
        WAVE_GRAPHQL_ENDPOINT: "https://x.invalid",
      }),
    ).toThrow();
  });
});
