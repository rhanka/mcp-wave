import { createHash } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import type { AppEnv } from "../../../src/config/env.js";
import type { createLogger } from "../../../src/config/logger.js";
import { AccountMappingLoader } from "../../../src/domain/tax/account-mapping-loader.js";
import { TaxRatesLoader } from "../../../src/domain/tax/rates-loader.js";
import { buildOAuthHttpApp } from "../../../src/entrypoints/oauth-http.js";
import { FileOAuthStore } from "../../../src/server/oauth/file-store.js";
import { selectProvider } from "../../../src/wave/auth/select.js";
import { WaveClient } from "../../../src/wave/client.js";

function makeEnv(storePath: string): AppEnv {
  return {
    WAVE_AUTH_MODE: "env_token",
    WAVE_API_TOKEN: "wave-token",
    WAVE_DEFAULT_BUSINESS_ID: "biz_x",
    WAVE_GRAPHQL_ENDPOINT: "https://example.invalid/graphql",
    LOG_LEVEL: "fatal",
    LOG_PII: false,
    NODE_ENV: "test",
    ALLOWED_ORIGINS: "https://claude.ai,http://localhost:*",
    RATE_LIMIT_RPM: 120,
    PUBLIC_BASE_URL: "http://localhost:8080",
    OAUTH_ISSUER_URL: "http://localhost:8080",
    OAUTH_CONSENT_SECRET: "consent",
    OAUTH_STORE_PATH: storePath,
    OAUTH_ACCESS_TOKEN_TTL_SECONDS: 3600,
    OAUTH_REFRESH_TOKEN_TTL_SECONDS: 2592000,
    OAUTH_AUTH_CODE_TTL_SECONDS: 300,
    OAUTH_ALLOWED_REDIRECT_URIS: "https://claude.ai/api/mcp/auth_callback",
  };
}

async function appFor() {
  const dir = await mkdtemp(join(tmpdir(), "mcp-wave-oauth-http-"));
  const testEnv = makeEnv(join(dir, "oauth-store.json"));
  const provider = selectProvider(testEnv);
  const store = new FileOAuthStore(testEnv.OAUTH_STORE_PATH);
  await store.load();
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child() {
      return logger;
    },
  };
  const app = buildOAuthHttpApp({
    env: testEnv,
    logger: logger as unknown as ReturnType<typeof createLogger>,
    provider,
    oauthStore: store,
    wave: new WaveClient({ endpoint: testEnv.WAVE_GRAPHQL_ENDPOINT, provider }),
    taxRates: new TaxRatesLoader(resolve("data/tax-rates")),
    accountMapping: new AccountMappingLoader(resolve("data/account-mapping")),
  });
  return { app, logger };
}

function pkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

describe("OAuth HTTP entrypoint", () => {
  it("serves OAuth metadata", async () => {
    const { app } = await appFor();
    const res = await request(app).get("/.well-known/oauth-authorization-server");
    expect(res.status).toBe(200);
    // The SDK formats the issuer as URL.href which includes a trailing slash
    expect(res.body.issuer).toBe("http://localhost:8080/");
    expect(res.body.authorization_endpoint).toBe("http://localhost:8080/authorize");
    expect(res.body.token_endpoint).toBe("http://localhost:8080/token");
    expect(res.body.registration_endpoint).toBe("http://localhost:8080/register");
    expect(res.body.revocation_endpoint).toBe("http://localhost:8080/revoke");
  });

  it("rejects /mcp without an OAuth bearer token", async () => {
    const { app } = await appFor();
    const res = await request(app)
      .post("/mcp")
      .set("accept", "application/json, text/event-stream")
      .set("content-type", "application/json")
      .set("origin", "https://claude.ai")
      .send(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2025-03-26",
            capabilities: {},
            clientInfo: { name: "test", version: "0" },
          },
        }),
      );
    expect(res.status).toBe(401);
    expect(res.headers["www-authenticate"]).toContain("resource_metadata");
  });

  it("registers, authorizes, exchanges, and uses an OAuth token for MCP initialize", async () => {
    const { app } = await appFor();

    // Step 1: Register client
    const registerRes = await request(app)
      .post("/register")
      .set("content-type", "application/json")
      .set("origin", "https://claude.ai")
      .send({
        redirect_uris: ["https://claude.ai/api/mcp/auth_callback"],
        token_endpoint_auth_method: "none",
        client_name: "Claude test",
      });
    expect(registerRes.status).toBe(201);
    const client = registerRes.body as { client_id: string };

    // Step 2: PKCE setup
    const verifier = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~";
    const challenge = pkceChallenge(verifier);

    // Step 3: Authorize (POST with consent_secret, stop before redirect)
    const authorizeRes = await request(app)
      .post("/authorize")
      .set("content-type", "application/x-www-form-urlencoded")
      .redirects(0)
      .send(
        new URLSearchParams({
          response_type: "code",
          client_id: client.client_id,
          redirect_uri: "https://claude.ai/api/mcp/auth_callback",
          code_challenge: challenge,
          code_challenge_method: "S256",
          scope: "mcp:tools",
          resource: "http://localhost:8080/mcp",
          state: "state-a",
          consent_secret: "consent",
        }).toString(),
      );
    expect(authorizeRes.status).toBe(302);
    const locationHeader = authorizeRes.headers.location as string;
    const location = new URL(locationHeader);
    expect(location.searchParams.get("state")).toBe("state-a");
    const code = location.searchParams.get("code");
    expect(code).toBeTruthy();

    // Step 4: Exchange code for tokens
    const tokenRes = await request(app)
      .post("/token")
      .set("content-type", "application/x-www-form-urlencoded")
      .set("origin", "https://claude.ai")
      .send(
        new URLSearchParams({
          grant_type: "authorization_code",
          client_id: client.client_id,
          code: code ?? "",
          code_verifier: verifier,
          redirect_uri: "https://claude.ai/api/mcp/auth_callback",
          resource: "http://localhost:8080/mcp",
        }).toString(),
      );
    expect(tokenRes.status).toBe(200);
    const tokens = tokenRes.body as { access_token: string; refresh_token: string };
    expect(tokens.access_token).toBeTruthy();
    expect(tokens.refresh_token).toBeTruthy();

    // Step 5: Use token to call /mcp
    const initRes = await request(app)
      .post("/mcp")
      .set("accept", "application/json, text/event-stream")
      .set("content-type", "application/json")
      .set("authorization", `Bearer ${tokens.access_token}`)
      .set("origin", "https://claude.ai")
      .send({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "test", version: "0" },
        },
      });
    expect(initRes.status).toBe(200);
    expect(initRes.headers["mcp-session-id"]).toBeTruthy();
  });
});
