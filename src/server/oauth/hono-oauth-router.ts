import {
  authenticateClient,
  clientRegistrationHandler,
  createOAuthMetadata,
  revokeHandler,
  tokenHandler,
  wellKnownRouter,
} from "@hono/mcp/auth";
import type { OAuthRegisteredClientsStore } from "@modelcontextprotocol/sdk/server/auth/clients.js";
import { OAuthError, ServerError } from "@modelcontextprotocol/sdk/server/auth/errors.js";
import type {
  AuthorizationParams,
  OAuthServerProvider,
} from "@modelcontextprotocol/sdk/server/auth/provider.js";
import { Hono } from "hono";
import type { AppEnv } from "../../config/env.js";
import { OAUTH_SCOPE, type OAuthRuntimeConfig } from "./config.js";
import type { SingleTenantOAuthProvider } from "./single-tenant-provider.js";

/**
 * Authorization-server + protected-resource routes for the single-tenant MCP
 * server. Standard endpoints (DCR, token+PKCE, revoke, well-known metadata)
 * come from `@hono/mcp/auth`; only `/authorize` is custom because we gate it
 * behind an operator consent secret (single-tenant protection).
 */
export function buildOAuthRoutes(
  provider: SingleTenantOAuthProvider,
  oauth: OAuthRuntimeConfig,
  nodeEnv: AppEnv["NODE_ENV"],
): Hono {
  // @hono/mcp's handlers are typed against the SDK OAuthServerProvider. Our
  // provider implements those methods structurally; the only divergence is the
  // framework-agnostic `authorizeRequest` (we serve /authorize ourselves), so a
  // localized cast is safe — @hono/mcp never calls `authorize` here.
  const sdkProvider = provider as unknown as OAuthServerProvider;
  const clientsStore = provider.clientsStore as unknown as OAuthRegisteredClientsStore;

  const router = new Hono();

  const oauthMetadata = createOAuthMetadata({
    provider: sdkProvider,
    issuerUrl: oauth.issuerUrl,
    baseUrl: oauth.publicBaseUrl,
    scopesSupported: [OAUTH_SCOPE],
  });

  // /.well-known/oauth-authorization-server + /.well-known/oauth-protected-resource/<rs-path>
  router.route(
    "/",
    wellKnownRouter({
      oauthMetadata,
      resourceServerUrl: oauth.resourceServerUrl,
      scopesSupported: [OAUTH_SCOPE],
      resourceName: "mcp-wave",
    }),
  );

  // @hono/mcp's wellKnownRouter serves PRM at the resource-path-suffixed URL
  // (/.well-known/oauth-protected-resource/mcp), but its bearerAuth 401 advertises
  // the unsuffixed /.well-known/oauth-protected-resource. Serve PRM there too so
  // a client following the WWW-Authenticate `resource_metadata` URL resolves it.
  router.get("/.well-known/oauth-protected-resource", (c) =>
    c.json({
      resource: oauth.resourceServerUrl.href,
      authorization_servers: [oauth.issuerUrl.href],
      bearer_methods_supported: ["header"],
      scopes_supported: [OAUTH_SCOPE],
      resource_name: "mcp-wave",
    }),
  );

  // Dynamic client registration (server assigns client_id).
  router.post("/register", clientRegistrationHandler({ clientsStore }));

  // Token (authorization_code + PKCE, refresh_token) and revocation.
  router.post("/token", authenticateClient({ clientsStore }), tokenHandler(sdkProvider));
  router.post("/revoke", authenticateClient({ clientsStore }), revokeHandler(sdkProvider));

  // Consent-gated authorization endpoint (single-tenant). GET renders the
  // consent form; POST validates the operator consent secret then issues a code.
  router.on(["GET", "POST"], "/authorize", async (c) => {
    c.header("Cache-Control", "no-store");
    const raw =
      c.req.method === "POST"
        ? ((await c.req.parseBody()) as Record<string, string>)
        : (c.req.query() as Record<string, string>);

    const clientId = raw["client_id"];
    if (!clientId) {
      return c.json({ error: "invalid_request", error_description: "missing client_id" }, 400);
    }
    const client = await provider.clientsStore.getClient(clientId);
    if (!client) {
      return c.json({ error: "invalid_client", error_description: "unknown client_id" }, 400);
    }

    const redirectUri = raw["redirect_uri"] ?? client.redirect_uris[0] ?? "";
    const scopeRaw = raw["scope"];
    const stateRaw = raw["state"];
    const resourceRaw = raw["resource"];
    const params: AuthorizationParams = {
      redirectUri,
      codeChallenge: raw["code_challenge"] ?? "",
      ...(scopeRaw !== undefined && { scopes: scopeRaw.split(" ") }),
      ...(stateRaw !== undefined && { state: stateRaw }),
      ...(resourceRaw !== undefined && { resource: new URL(resourceRaw) }),
    };

    try {
      const consentSecret = raw["consent_secret"];
      const outcome = await provider.authorizeRequest(client, params, {
        method: c.req.method,
        ...(consentSecret !== undefined && { consentSecret }),
      });
      if (outcome.kind === "consent") {
        return c.html(outcome.html, outcome.status);
      }
      return c.redirect(outcome.location, 302);
    } catch (e) {
      const err = e instanceof OAuthError ? e : new ServerError("Internal Server Error");
      return c.json(err.toResponseObject(), err instanceof ServerError ? 500 : 400);
    }
  });

  void nodeEnv;
  return router;
}
