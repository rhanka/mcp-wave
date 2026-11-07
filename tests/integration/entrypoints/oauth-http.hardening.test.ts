import { createHash } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import type { AppEnv } from "../../../src/config/env.js";
import type { createLogger } from "../../../src/config/logger.js";
import { AccountMappingLoader } from "../../../src/domain/tax/account-mapping-loader.js";
import { TaxRatesLoader } from "../../../src/domain/tax/rates-loader.js";
import {
  AUTHORIZE_POST_RPM,
  buildOAuthHonoApp,
  DEFAULT_BODY_LIMIT_BYTES,
  MCP_BODY_LIMIT_BYTES,
} from "../../../src/entrypoints/oauth-http.js";
import { FileOAuthStore } from "../../../src/server/oauth/file-store.js";
import { selectProvider } from "../../../src/wave/auth/select.js";
import { WaveClient } from "../../../src/wave/client.js";

const REDIRECT = "https://claude.ai/api/mcp/auth_callback";
const RESOURCE = "http://localhost:8080/mcp";
const VERIFIER = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~";

async function appFor(): Promise<Hono> {
  const dir = await mkdtemp(join(tmpdir(), "mcp-wave-oauth-hardening-"));
  const env: AppEnv = {
    WAVE_AUTH_MODE: "env_token",
    WAVE_API_TOKEN: "wave-token",
    WAVE_DEFAULT_BUSINESS_ID: "biz_x",
    WAVE_GRAPHQL_ENDPOINT: "https://example.invalid/graphql",
    LOG_LEVEL: "fatal",
    LOG_PII: false,
    NODE_ENV: "test",
    ALLOWED_ORIGINS: "https://claude.ai,http://localhost:*",
    RATE_LIMIT_RPM: 1000,
    PUBLIC_BASE_URL: "http://localhost:8080",
    OAUTH_ISSUER_URL: "http://localhost:8080",
    OAUTH_CONSENT_SECRET: "consent",
    OAUTH_STORE_PATH: join(dir, "oauth-store.json"),
    OAUTH_ACCESS_TOKEN_TTL_SECONDS: 3600,
    OAUTH_REFRESH_TOKEN_TTL_SECONDS: 2592000,
    OAUTH_AUTH_CODE_TTL_SECONDS: 300,
    OAUTH_ALLOWED_REDIRECT_URIS: REDIRECT,
  };
  const provider = selectProvider(env);
  const store = new FileOAuthStore(env.OAUTH_STORE_PATH);
  await store.load();
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child() {
      return logger;
    },
  };
  return buildOAuthHonoApp({
    env,
    logger: logger as unknown as ReturnType<typeof createLogger>,
    provider,
    oauthStore: store,
    wave: new WaveClient({ endpoint: env.WAVE_GRAPHQL_ENDPOINT, provider }),
    taxRates: new TaxRatesLoader(resolve("data/tax-rates")),
    accountMapping: new AccountMappingLoader(resolve("data/account-mapping")),
  });
}

const form = { "content-type": "application/x-www-form-urlencoded", origin: "https://claude.ai" };

async function registerClient(app: Hono): Promise<string> {
  const res = await app.request("/register", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://claude.ai" },
    body: JSON.stringify({
      redirect_uris: [REDIRECT],
      token_endpoint_auth_method: "none",
      client_name: "hardening test",
    }),
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { client_id: string }).client_id;
}

function authorizeBody(clientId: string, consentSecret: string): string {
  return new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: REDIRECT,
    code_challenge: createHash("sha256").update(VERIFIER).digest("base64url"),
    code_challenge_method: "S256",
    scope: "mcp:tools",
    resource: RESOURCE,
    consent_secret: consentSecret,
  }).toString();
}

async function accessTokenFor(app: Hono, xff: string): Promise<string> {
  const clientId = await registerClient(app);
  const authorizeRes = await app.request("/authorize", {
    method: "POST",
    headers: { ...form, "x-forwarded-for": xff },
    body: authorizeBody(clientId, "consent"),
  });
  expect(authorizeRes.status).toBe(302);
  const code = new URL(authorizeRes.headers.get("location") ?? "").searchParams.get("code") ?? "";
  const tokenRes = await app.request("/token", {
    method: "POST",
    headers: form,
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: clientId,
      code,
      code_verifier: VERIFIER,
      redirect_uri: REDIRECT,
      resource: RESOURCE,
    }).toString(),
  });
  expect(tokenRes.status).toBe(200);
  return ((await tokenRes.json()) as { access_token: string }).access_token;
}

function mcpHeaders(token: string, sessionId?: string): Record<string, string> {
  return {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    authorization: `Bearer ${token}`,
    origin: "https://claude.ai",
    ...(sessionId !== undefined && { "mcp-session-id": sessionId }),
  };
}

const initialize = JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "test", version: "0" },
  },
});

describe("OAuth Hono MCP entrypoint hardening", () => {
  it("throttles consent-secret guessing on POST /authorize per client address", async () => {
    const app = await appFor();
    const clientId = await registerClient(app);
    const attempt = (xff: string) =>
      app.request("/authorize", {
        method: "POST",
        headers: { ...form, "x-forwarded-for": xff },
        body: authorizeBody(clientId, "wrong-guess"),
      });

    for (let i = 0; i < AUTHORIZE_POST_RPM; i += 1) {
      expect((await attempt("203.0.113.50")).status).toBe(401);
    }
    expect((await attempt("203.0.113.50")).status).toBe(429);
    // Prepending a forged hop does not yield a fresh budget: the proxy-appended
    // (right-most) address is the key.
    expect((await attempt("198.51.100.7, 203.0.113.50")).status).toBe(429);
    // GET (render the consent form) is not throttled by the strict limiter.
    const get = await app.request(`/authorize?${authorizeBody(clientId, "")}`, {
      headers: { origin: "https://claude.ai", "x-forwarded-for": "203.0.113.50" },
    });
    expect(get.status).toBe(200);
  });

  it("rejects oversized bodies on OAuth endpoints with 413 before parsing", async () => {
    const app = await appFor();
    const res = await app.request("/register", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://claude.ai" },
      body: JSON.stringify({ client_name: "x".repeat(DEFAULT_BODY_LIMIT_BYTES + 1) }),
    });
    expect(res.status).toBe(413);
  });

  it("rejects MCP bodies above the MCP limit with 413 but accepts large CSV-sized bodies", async () => {
    const app = await appFor();
    const token = await accessTokenFor(app, "203.0.113.60");

    const tooBig = await app.request("/mcp", {
      method: "POST",
      headers: mcpHeaders(token),
      body: JSON.stringify({ pad: "x".repeat(MCP_BODY_LIMIT_BYTES + 1) }),
    });
    expect(tooBig.status).toBe(413);

    const sizeable = await app.request("/mcp", {
      method: "POST",
      headers: mcpHeaders(token),
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: { experimental: { pad: { data: "x".repeat(512 * 1024) } } },
          clientInfo: { name: "test", version: "0" },
        },
      }),
    });
    expect(sizeable.status).toBe(200);
  });

  it("does not let another OAuth client reuse an existing MCP session id", async () => {
    const app = await appFor();
    const ownerToken = await accessTokenFor(app, "203.0.113.70");
    const otherToken = await accessTokenFor(app, "203.0.113.71");

    const init = await app.request("/mcp", {
      method: "POST",
      headers: mcpHeaders(ownerToken),
      body: initialize,
    });
    expect(init.status).toBe(200);
    const sessionId = init.headers.get("mcp-session-id") ?? "";
    expect(sessionId).toBeTruthy();

    const listTools = JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
    const hijack = await app.request("/mcp", {
      method: "POST",
      headers: mcpHeaders(otherToken, sessionId),
      body: listTools,
    });
    expect(hijack.status).toBe(404);

    const owner = await app.request("/mcp", {
      method: "POST",
      headers: mcpHeaders(ownerToken, sessionId),
      body: listTools,
    });
    expect(owner.status).toBe(200);
  });
});
