import { createHash } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { AppEnv } from "../../../src/config/env.js";
import type { createLogger } from "../../../src/config/logger.js";
import { AccountMappingLoader } from "../../../src/domain/tax/account-mapping-loader.js";
import { TaxRatesLoader } from "../../../src/domain/tax/rates-loader.js";
import { buildOAuthHonoApp } from "../../../src/entrypoints/oauth-http.js";
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
  const dir = await mkdtemp(join(tmpdir(), "mcp-wave-oauth-hono-"));
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
  const app = buildOAuthHonoApp({
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

describe("OAuth Hono MCP entrypoint", () => {
  it("serves OAuth authorization-server metadata", async () => {
    const { app } = await appFor();
    const res = await app.request("/.well-known/oauth-authorization-server", {
      headers: { origin: "https://claude.ai" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body["issuer"]).toBe("http://localhost:8080");
    expect(body["authorization_endpoint"]).toBe("http://localhost:8080/authorize");
    expect(body["token_endpoint"]).toBe("http://localhost:8080/token");
    expect(body["registration_endpoint"]).toBe("http://localhost:8080/register");
    expect(body["revocation_endpoint"]).toBe("http://localhost:8080/revoke");
  });

  it("serves protected-resource metadata at both well-known paths (suffixed + the one the 401 advertises)", async () => {
    const { app } = await appFor();
    for (const path of [
      "/.well-known/oauth-protected-resource/mcp",
      "/.well-known/oauth-protected-resource",
    ]) {
      const res = await app.request(path, { headers: { origin: "https://claude.ai" } });
      expect(res.status, path).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body["resource"], path).toBe("http://localhost:8080/mcp");
      expect(body["authorization_servers"], path).toEqual(["http://localhost:8080"]);
    }
  });

  it("rejects unauthenticated POST /mcp initialize with 401 and WWW-Authenticate containing resource_metadata", async () => {
    const { app } = await appFor();
    const res = await app.request("/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        origin: "https://claude.ai",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "test", version: "0" },
        },
      }),
    });
    expect(res.status).toBe(401);
    const wwwAuth = res.headers.get("www-authenticate") ?? "";
    expect(wwwAuth).toContain("resource_metadata");
  });

  it("full OAuth flow: register → authorize → token → MCP initialize with bearer → 200 with protocolVersion and Mcp-Session-Id", async () => {
    const { app } = await appFor();

    // Step 1: Register client
    const registerRes = await app.request("/register", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://claude.ai",
      },
      body: JSON.stringify({
        redirect_uris: ["https://claude.ai/api/mcp/auth_callback"],
        token_endpoint_auth_method: "none",
        client_name: "Claude test",
      }),
    });
    expect(registerRes.status).toBe(201);
    const client = (await registerRes.json()) as { client_id: string };
    expect(client.client_id).toBeTruthy();

    // Step 2: PKCE setup
    const verifier = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~";
    const challenge = pkceChallenge(verifier);

    // Step 3: Authorize with consent_secret — follow redirect manually
    const authorizeParams = new URLSearchParams({
      response_type: "code",
      client_id: client.client_id,
      redirect_uri: "https://claude.ai/api/mcp/auth_callback",
      code_challenge: challenge,
      code_challenge_method: "S256",
      scope: "mcp:tools",
      resource: "http://localhost:8080/mcp",
      state: "state-a",
      consent_secret: "consent",
    });
    const authorizeRes = await app.request("/authorize", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        origin: "https://claude.ai",
      },
      body: authorizeParams.toString(),
    });
    // Hono's c.redirect returns a 302 by default; follow it manually
    expect(authorizeRes.status).toBe(302);
    const locationHeader = authorizeRes.headers.get("location") ?? "";
    const location = new URL(locationHeader);
    expect(location.searchParams.get("state")).toBe("state-a");
    const code = location.searchParams.get("code");
    expect(code).toBeTruthy();

    // Step 4: Exchange code for tokens
    const tokenParams = new URLSearchParams({
      grant_type: "authorization_code",
      client_id: client.client_id,
      code: code ?? "",
      code_verifier: verifier,
      redirect_uri: "https://claude.ai/api/mcp/auth_callback",
      resource: "http://localhost:8080/mcp",
    });
    const tokenRes = await app.request("/token", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        origin: "https://claude.ai",
      },
      body: tokenParams.toString(),
    });
    expect(tokenRes.status).toBe(200);
    const tokens = (await tokenRes.json()) as { access_token: string; refresh_token: string };
    expect(tokens.access_token).toBeTruthy();
    expect(tokens.refresh_token).toBeTruthy();

    // Step 5: POST /mcp initialize with bearer token. The transport assigns the
    // session id and returns it in the Mcp-Session-Id response header.
    const initRes = await app.request("/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        authorization: `Bearer ${tokens.access_token}`,
        origin: "https://claude.ai",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "test", version: "0" },
        },
      }),
    });
    expect(initRes.status).toBe(200);
    const initBody = (await initRes.json()) as {
      result?: { protocolVersion?: string };
    };
    expect(initBody.result?.protocolVersion).toBe("2025-03-26");
    expect(initRes.headers.get("mcp-session-id")).toBeTruthy();
  });

  it("tools/list with bearer returns tools including create_invoice with items array schema", async () => {
    const { app } = await appFor();

    // Register + authorize + get token (abbreviated)
    const registerRes = await app.request("/register", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://claude.ai" },
      body: JSON.stringify({
        redirect_uris: ["https://claude.ai/api/mcp/auth_callback"],
        token_endpoint_auth_method: "none",
        client_name: "Claude test 2",
      }),
    });
    const client = (await registerRes.json()) as { client_id: string };

    const verifier = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~";
    const challenge = pkceChallenge(verifier);

    const authorizeRes = await app.request("/authorize", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        origin: "https://claude.ai",
      },
      body: new URLSearchParams({
        response_type: "code",
        client_id: client.client_id,
        redirect_uri: "https://claude.ai/api/mcp/auth_callback",
        code_challenge: challenge,
        code_challenge_method: "S256",
        scope: "mcp:tools",
        resource: "http://localhost:8080/mcp",
        consent_secret: "consent",
      }).toString(),
    });
    const location2 = new URL(authorizeRes.headers.get("location") ?? "");
    const code2 = location2.searchParams.get("code") ?? "";

    const tokenRes = await app.request("/token", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        origin: "https://claude.ai",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: client.client_id,
        code: code2,
        code_verifier: verifier,
        redirect_uri: "https://claude.ai/api/mcp/auth_callback",
        resource: "http://localhost:8080/mcp",
      }).toString(),
    });
    const tokens2 = (await tokenRes.json()) as { access_token: string };

    const mcpHeaders = {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${tokens2.access_token}`,
      origin: "https://claude.ai",
    };

    // initialize first to establish the MCP session, then reuse its id
    const initRes = await app.request("/mcp", {
      method: "POST",
      headers: mcpHeaders,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "test", version: "0" },
        },
      }),
    });
    expect(initRes.status).toBe(200);
    const sessionId = initRes.headers.get("mcp-session-id") ?? "";
    expect(sessionId).toBeTruthy();

    // tools/list within the session
    const listRes = await app.request("/mcp", {
      method: "POST",
      headers: { ...mcpHeaders, "mcp-session-id": sessionId },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/list",
        params: {},
      }),
    });
    expect(listRes.status).toBe(200);
    const listBody = (await listRes.json()) as {
      result?: { tools?: Array<{ name: string; inputSchema?: Record<string, unknown> }> };
    };
    const tools = listBody.result?.tools ?? [];
    expect(tools.length).toBeGreaterThan(0);

    const createInvoice = tools.find((t) => t.name === "create_invoice");
    expect(createInvoice).toBeDefined();
    const props = createInvoice?.inputSchema?.["properties"] as
      | Record<string, { type?: string }>
      | undefined;
    expect(props?.["items"]?.type).toBe("array");
  });
});
