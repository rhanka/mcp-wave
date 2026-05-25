import { createHash } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import type { OAuthRuntimeConfig } from "../../../../src/server/oauth/config.js";
import { FileOAuthStore } from "../../../../src/server/oauth/file-store.js";
import { buildOAuthAsRouter } from "../../../../src/server/oauth/hono-oauth-router.js";
import { SingleTenantOAuthProvider } from "../../../../src/server/oauth/single-tenant-provider.js";

const REDIRECT_URI = "https://claude.ai/api/mcp/auth_callback";
const VERIFIER = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"; // 43 chars
const CHALLENGE = createHash("sha256").update(VERIFIER).digest("base64url");

async function buildApp() {
  const dir = await mkdtemp(join(tmpdir(), "mcp-wave-hono-oauth-"));
  const store = new FileOAuthStore(join(dir, "oauth.json"));
  await store.load();

  const oauth: OAuthRuntimeConfig = {
    issuerUrl: new URL("http://localhost:8080"),
    publicBaseUrl: new URL("http://localhost:8080"),
    resourceServerUrl: new URL("http://localhost:8080/mcp"),
    resourceMetadataUrl: "http://localhost:8080/.well-known/oauth-protected-resource/mcp",
    consentSecret: "consent",
    allowedRedirectUris: [REDIRECT_URI],
    accessTokenTtlSeconds: 3600,
    refreshTokenTtlSeconds: 2592000,
    authCodeTtlSeconds: 300,
  };

  const provider = new SingleTenantOAuthProvider({
    store,
    nodeEnv: "test",
    issuerUrl: oauth.issuerUrl,
    publicBaseUrl: oauth.publicBaseUrl,
    resourceServerUrl: oauth.resourceServerUrl,
    consentSecret: oauth.consentSecret,
    allowedRedirectUris: oauth.allowedRedirectUris,
    authCodeTtlSeconds: oauth.authCodeTtlSeconds,
    accessTokenTtlSeconds: oauth.accessTokenTtlSeconds,
    refreshTokenTtlSeconds: oauth.refreshTokenTtlSeconds,
  });

  const oauthRouter = buildOAuthAsRouter(provider, oauth, "test");
  const app = new Hono();
  app.route("/", oauthRouter);

  return { app, provider };
}

// RFC 7591: clients submit metadata only; the server assigns client_id. Returns it.
async function register(app: Hono, redirectUris: string[] = [REDIRECT_URI]): Promise<string> {
  const res = await app.request("http://localhost:8080/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      redirect_uris: redirectUris,
      token_endpoint_auth_method: "none",
    }),
  });
  expect(res.status).toBe(201);
  const body = (await res.json()) as { client_id: string };
  expect(body.client_id).toBeTruthy();
  return body.client_id;
}

describe("buildOAuthAsRouter", () => {
  it("1. GET /.well-known/oauth-authorization-server returns 200 with endpoints", async () => {
    const { app } = await buildApp();
    const res = await app.request("http://localhost:8080/.well-known/oauth-authorization-server");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body["issuer"]).toBe("http://localhost:8080/");
    expect(body["authorization_endpoint"]).toBe("http://localhost:8080/authorize");
    expect(body["token_endpoint"]).toBe("http://localhost:8080/token");
    expect(body["registration_endpoint"]).toBe("http://localhost:8080/register");
    expect(body["revocation_endpoint"]).toBe("http://localhost:8080/revoke");
    expect(body["scopes_supported"]).toEqual(["mcp:tools"]);
    expect(body["grant_types_supported"] as string[]).toContain("authorization_code");
    expect(body["grant_types_supported"] as string[]).toContain("refresh_token");
    expect(body["code_challenge_methods_supported"] as string[]).toContain("S256");
  });

  it("2a. POST /register with valid redirect_uri returns 201 with a server-assigned client_id", async () => {
    const { app } = await buildApp();
    const clientId = await register(app);
    expect(typeof clientId).toBe("string");
    expect(clientId.length).toBeGreaterThan(0);
  });

  it("2b. POST /register with invalid redirect_uri returns 400 invalid_client_metadata", async () => {
    const { app } = await buildApp();
    const res = await app.request("http://localhost:8080/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        redirect_uris: ["https://evil.example/callback"],
        token_endpoint_auth_method: "none",
      }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body["error"]).toBe("invalid_client_metadata");
  });

  it("3. Full flow: register -> POST /authorize -> 302 -> POST /token (auth_code) -> access+refresh tokens", async () => {
    const { app } = await buildApp();
    const clientId = await register(app);

    // POST /authorize with form body and consent secret
    const authBody = new URLSearchParams({
      client_id: clientId,
      redirect_uri: REDIRECT_URI,
      code_challenge: CHALLENGE,
      code_challenge_method: "S256",
      scope: "mcp:tools",
      state: "state-xyz",
      resource: "http://localhost:8080/mcp",
      consent_secret: "consent",
    });
    const authRes = await app.request("http://localhost:8080/authorize", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: authBody.toString(),
    });
    expect(authRes.status).toBe(302);
    const location = authRes.headers.get("location") ?? "";
    const redirectUrl = new URL(location);
    const code = redirectUrl.searchParams.get("code");
    expect(code).toBeTruthy();
    expect(redirectUrl.searchParams.get("state")).toBe("state-xyz");

    // POST /token with authorization_code
    const tokenBody = new URLSearchParams({
      grant_type: "authorization_code",
      client_id: clientId,
      code: code ?? "",
      code_verifier: VERIFIER,
      redirect_uri: REDIRECT_URI,
      resource: "http://localhost:8080/mcp",
    });
    const tokenRes = await app.request("http://localhost:8080/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: tokenBody.toString(),
    });
    expect(tokenRes.status).toBe(200);
    const tokens = (await tokenRes.json()) as Record<string, unknown>;
    expect(tokens["access_token"]).toBeTruthy();
    expect(tokens["refresh_token"]).toBeTruthy();
    expect(tokens["token_type"]).toBe("Bearer");
  });

  it("4. POST /token with wrong code_verifier returns 400 invalid_grant", async () => {
    const { app, provider } = await buildApp();
    const clientId = await register(app);

    const client = await provider.clientsStore.getClient(clientId);
    if (!client) throw new Error("client not found");

    // Issue code with CHALLENGE
    const code = await provider.issueAuthorizationCode(client, {
      redirectUri: REDIRECT_URI,
      codeChallenge: CHALLENGE,
      scopes: ["mcp:tools"],
      resource: new URL("http://localhost:8080/mcp"),
      state: "state-pkce",
    });

    // Submit wrong verifier
    const tokenBody = new URLSearchParams({
      grant_type: "authorization_code",
      client_id: clientId,
      code,
      code_verifier: "wrong-verifier-that-does-not-match-the-challenge-at-all",
      redirect_uri: REDIRECT_URI,
    });
    const res = await app.request("http://localhost:8080/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: tokenBody.toString(),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body["error"]).toBe("invalid_grant");
  });

  it("5. refresh_token grant returns 200 new tokens", async () => {
    const { app, provider } = await buildApp();
    const clientId = await register(app);

    const client = await provider.clientsStore.getClient(clientId);
    if (!client) throw new Error("client not found");

    // Issue tokens directly
    const initialTokens = await provider.issueTokensForTests(client);
    expect(initialTokens.refresh_token).toBeTruthy();

    const tokenBody = new URLSearchParams({
      grant_type: "refresh_token",
      client_id: clientId,
      refresh_token: initialTokens.refresh_token ?? "",
      resource: "http://localhost:8080/mcp",
    });
    const res = await app.request("http://localhost:8080/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: tokenBody.toString(),
    });
    expect(res.status).toBe(200);
    const newTokens = (await res.json()) as Record<string, unknown>;
    expect(newTokens["access_token"]).toBeTruthy();
    expect(newTokens["refresh_token"]).toBeTruthy();
    // Should be new tokens
    expect(newTokens["access_token"]).not.toBe(initialTokens.access_token);
  });

  it("6. POST /revoke returns 200", async () => {
    const { app, provider } = await buildApp();
    const clientId = await register(app);

    const client = await provider.clientsStore.getClient(clientId);
    if (!client) throw new Error("client not found");

    const tokens = await provider.issueTokensForTests(client);

    const revokeBody = new URLSearchParams({
      client_id: clientId,
      token: tokens.access_token,
    });
    const res = await app.request("http://localhost:8080/revoke", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: revokeBody.toString(),
    });
    expect(res.status).toBe(200);
  });
});
