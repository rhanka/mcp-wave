import { resolve } from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppEnv } from "../../../src/config/env.js";
import type { createLogger } from "../../../src/config/logger.js";
import { AccountMappingLoader } from "../../../src/domain/tax/account-mapping-loader.js";
import { TaxRatesLoader } from "../../../src/domain/tax/rates-loader.js";
import { __clearRateLimitBucketsForTests } from "../../../src/server/http/rate-limit.js";
import { selectProvider } from "../../../src/wave/auth/select.js";
import { WaveClient } from "../../../src/wave/client.js";

let buildHttpApp: Awaited<typeof import("../../../src/entrypoints/http.js")>["buildHttpApp"];

function appEnv(mode: AppEnv["WAVE_AUTH_MODE"], apiToken?: string): AppEnv {
  const env: AppEnv = {
    WAVE_AUTH_MODE: mode,
    WAVE_DEFAULT_BUSINESS_ID: "biz_x",
    WAVE_GRAPHQL_ENDPOINT: "https://example.invalid/graphql",
    LOG_LEVEL: "fatal",
    LOG_PII: false,
    NODE_ENV: "test",
    ALLOWED_ORIGINS: "https://claude.ai,http://localhost:*",
    RATE_LIMIT_RPM: 120,
    PUBLIC_BASE_URL: "http://localhost:8080",
    OAUTH_ISSUER_URL: "http://localhost:8080",
    OAUTH_STORE_PATH: ".data/oauth-store.json",
    OAUTH_ACCESS_TOKEN_TTL_SECONDS: 3600,
    OAUTH_REFRESH_TOKEN_TTL_SECONDS: 2592000,
    OAUTH_AUTH_CODE_TTL_SECONDS: 300,
    OAUTH_ALLOWED_REDIRECT_URIS:
      "https://claude.ai/api/mcp/auth_callback,https://claude.com/api/mcp/auth_callback",
  };
  if (apiToken !== undefined) {
    env.WAVE_API_TOKEN = apiToken;
  }
  return env;
}

function mcpHeaders(extra?: Record<string, string>): Record<string, string> {
  return {
    accept: "application/json, text/event-stream",
    "content-type": "application/json",
    origin: "https://claude.ai",
    "x-forwarded-for": "203.0.113.10",
    ...extra,
  };
}

function appFor(env: AppEnv): {
  app: ReturnType<typeof buildHttpApp>;
  logInfo: ReturnType<typeof vi.fn>;
} {
  const provider = selectProvider(env);
  const logInfo = vi.fn();
  const logger = {
    info: logInfo,
    child() {
      return logger;
    },
  };

  return {
    app: buildHttpApp({
      env,
      logger: logger as unknown as ReturnType<typeof createLogger>,
      provider,
      wave: new WaveClient({ endpoint: env.WAVE_GRAPHQL_ENDPOINT, provider }),
      taxRates: new TaxRatesLoader(resolve("data/tax-rates")),
      accountMapping: new AccountMappingLoader(resolve("data/account-mapping")),
    }),
    logInfo,
  };
}

async function initialize(
  app: ReturnType<typeof buildHttpApp>,
  extraHeaders?: Record<string, string>,
): Promise<Response> {
  return app.request("/mcp", {
    method: "POST",
    headers: mcpHeaders(extraHeaders),
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "http-auth-test", version: "0" },
      },
    }),
  });
}

function expectIdentityLog(logInfo: ReturnType<typeof vi.fn>, identity: string | RegExp): void {
  const matcher =
    typeof identity === "string"
      ? expect.objectContaining({ identity })
      : expect.objectContaining({ identity: expect.stringMatching(identity) });
  expect(logInfo).toHaveBeenCalledWith(matcher, "mcp http request");
}

describe("http /mcp auth modes", () => {
  beforeAll(async () => {
    process.env.WAVE_AUTH_MODE = "mock";
    process.env.WAVE_API_TOKEN = "fake";
    process.env.WAVE_DEFAULT_BUSINESS_ID = "biz_x";
    process.env.WAVE_GRAPHQL_ENDPOINT = "https://example.invalid/graphql";
    process.env.LOG_LEVEL = "fatal";
    process.env.NODE_ENV = "test";
    process.env.ALLOWED_ORIGINS = "https://claude.ai,http://localhost:*";
    process.env.RATE_LIMIT_RPM = "120";
    ({ buildHttpApp } = await import("../../../src/entrypoints/http.js"));
  });

  beforeEach(() => {
    __clearRateLimitBucketsForTests();
  });

  it("env_token initializes without an Authorization bearer header", async () => {
    const { app, logInfo } = appFor(appEnv("env_token", "server-token"));

    const response = await initialize(app);

    expect(response.status).toBe(200);
    expect(response.headers.get("mcp-session-id")).toBeTruthy();
    const body = (await response.json()) as { result: { serverInfo: { name: string } } };
    expect(body.result.serverInfo.name).toBe("mcp-wave");
    expectIdentityLog(logInfo, "env-default");
  });

  it("bearer_passthrough rejects initialization without an Authorization bearer header", async () => {
    const { app, logInfo } = appFor(appEnv("bearer_passthrough"));

    const response = await initialize(app);

    expect(response.status).toBe(401);
    expect(response.headers.get("mcp-session-id")).toBeNull();
    const body = (await response.json()) as {
      error: { message: string; data: { code: string; hint?: string } };
    };
    expect(body.error.message).toBe("AUTH_BEARER_MISSING");
    expect(body.error.data.code).toBe("AUTH_BEARER_MISSING");
    expect(body.error.data.hint).toContain("Authorization: Bearer <token>");
    expect(logInfo).not.toHaveBeenCalled();
  });

  it("bearer_passthrough initializes with an Authorization bearer header", async () => {
    const { app, logInfo } = appFor(appEnv("bearer_passthrough"));

    const response = await initialize(app, {
      authorization: "Bearer user-wave-token",
      "x-forwarded-for": "203.0.113.11",
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("mcp-session-id")).toBeTruthy();
    const body = (await response.json()) as { result: { serverInfo: { name: string } } };
    expect(body.result.serverInfo.name).toBe("mcp-wave");
    expectIdentityLog(logInfo, /^bearer:[a-f0-9]{12}$/);
    expect(JSON.stringify(logInfo.mock.calls)).not.toContain("user-wave-token");
  });
});
