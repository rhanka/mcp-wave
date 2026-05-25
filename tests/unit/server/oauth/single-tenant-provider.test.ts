import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  InvalidClientMetadataError,
  InvalidGrantError,
  InvalidTokenError,
} from "@modelcontextprotocol/sdk/server/auth/errors.js";
import { describe, expect, it } from "vitest";
import { FileOAuthStore } from "../../../../src/server/oauth/file-store.js";
import { SingleTenantOAuthProvider } from "../../../../src/server/oauth/single-tenant-provider.js";

async function provider(now = 100): Promise<SingleTenantOAuthProvider> {
  const dir = await mkdtemp(join(tmpdir(), "mcp-wave-provider-"));
  const store = new FileOAuthStore(join(dir, "oauth.json"));
  await store.load();
  return new SingleTenantOAuthProvider({
    store,
    nodeEnv: "test",
    issuerUrl: new URL("http://localhost:8080"),
    publicBaseUrl: new URL("http://localhost:8080"),
    resourceServerUrl: new URL("http://localhost:8080/mcp"),
    consentSecret: "consent",
    allowedRedirectUris: ["https://claude.ai/api/mcp/auth_callback"],
    authCodeTtlSeconds: 300,
    accessTokenTtlSeconds: 3600,
    refreshTokenTtlSeconds: 2592000,
    nowSeconds: () => now,
  });
}

describe("SingleTenantOAuthProvider", () => {
  it("registers clients with allowed redirect URIs", async () => {
    const p = await provider();
    const client = await p.clientsStore.registerClient?.({
      client_id: "client-a",
      client_id_issued_at: 100,
      redirect_uris: ["https://claude.ai/api/mcp/auth_callback"],
      token_endpoint_auth_method: "none",
    });

    expect(client?.client_id).toBe("client-a");
    expect(await p.clientsStore.getClient("client-a")).toEqual(client);
  });

  it("rejects clients with unknown redirect URIs", async () => {
    const p = await provider();

    await expect(
      p.clientsStore.registerClient?.({
        client_id: "client-a",
        client_id_issued_at: 100,
        redirect_uris: ["https://evil.example/callback"],
        token_endpoint_auth_method: "none",
      }),
    ).rejects.toBeInstanceOf(InvalidClientMetadataError);
  });

  it("exchanges a valid code for access and refresh tokens", async () => {
    const p = await provider();
    const client = await p.clientsStore.registerClient?.({
      client_id: "client-a",
      client_id_issued_at: 100,
      redirect_uris: ["https://claude.ai/api/mcp/auth_callback"],
      token_endpoint_auth_method: "none",
    });
    if (!client) throw new Error("client registration failed");

    const code = await p.issueAuthorizationCode(client, {
      redirectUri: "https://claude.ai/api/mcp/auth_callback",
      codeChallenge: "challenge",
      scopes: ["mcp:tools"],
      resource: new URL("http://localhost:8080/mcp"),
      state: "state-a",
    });

    const tokens = await p.exchangeAuthorizationCode(
      client,
      code,
      undefined,
      "https://claude.ai/api/mcp/auth_callback",
      new URL("http://localhost:8080/mcp"),
    );

    expect(tokens.token_type).toBe("Bearer");
    expect(tokens.expires_in).toBe(3600);
    expect(tokens.scope).toBe("mcp:tools");
    expect(tokens.access_token).toBeTruthy();
    expect(tokens.refresh_token).toBeTruthy();
    await expect(p.exchangeAuthorizationCode(client, code)).rejects.toBeInstanceOf(
      InvalidGrantError,
    );
  });

  it("verifies and revokes access tokens", async () => {
    const p = await provider();
    const client = await p.clientsStore.registerClient?.({
      client_id: "client-a",
      client_id_issued_at: 100,
      redirect_uris: ["https://claude.ai/api/mcp/auth_callback"],
      token_endpoint_auth_method: "none",
    });
    if (!client) throw new Error("client registration failed");

    const tokens = await p.issueTokensForTests(client);
    const auth = await p.verifyAccessToken(tokens.access_token);
    expect(auth.clientId).toBe("client-a");
    expect(auth.scopes).toEqual(["mcp:tools"]);

    await p.revokeToken(client, { token: tokens.access_token });
    await expect(p.verifyAccessToken(tokens.access_token)).rejects.toBeInstanceOf(
      InvalidTokenError,
    );
  });

  describe("authorizeRequest", () => {
    async function registeredClient() {
      const p = await provider();
      const client = await p.clientsStore.registerClient?.({
        client_id: "client-b",
        client_id_issued_at: 100,
        redirect_uris: ["https://claude.ai/api/mcp/auth_callback"],
        token_endpoint_auth_method: "none",
      });
      if (!client) throw new Error("client registration failed");
      return { p, client };
    }

    const params = {
      redirectUri: "https://claude.ai/api/mcp/auth_callback",
      codeChallenge: "challenge-b",
      codeChallengeMethod: "S256" as const,
      scopes: ["mcp:tools"],
      state: "state-a",
      resource: new URL("http://localhost:8080/mcp"),
    };

    it("GET returns consent form with status 200", async () => {
      const { p, client } = await registeredClient();
      const outcome = await p.authorizeRequest(client, params, { method: "GET" });
      expect(outcome.kind).toBe("consent");
      if (outcome.kind !== "consent") throw new Error("expected consent");
      expect(outcome.status).toBe(200);
      expect(outcome.html).toContain("Authorize mcp-wave");
      expect(outcome.html).toContain("consent_secret");
    });

    it("POST with wrong secret returns consent form with status 401", async () => {
      const { p, client } = await registeredClient();
      const outcome = await p.authorizeRequest(client, params, {
        method: "POST",
        consentSecret: "wrong-secret",
      });
      expect(outcome.kind).toBe("consent");
      if (outcome.kind !== "consent") throw new Error("expected consent");
      expect(outcome.status).toBe(401);
      expect(outcome.html).toContain("Invalid consent secret");
    });

    it("POST with correct secret returns redirect with code and state", async () => {
      const { p, client } = await registeredClient();
      const outcome = await p.authorizeRequest(client, params, {
        method: "POST",
        consentSecret: "consent",
      });
      expect(outcome.kind).toBe("redirect");
      if (outcome.kind !== "redirect") throw new Error("expected redirect");
      const url = new URL(outcome.location);
      expect(url.searchParams.get("code")).toBeTruthy();
      expect(url.searchParams.get("state")).toBe("state-a");
    });
  });
});
