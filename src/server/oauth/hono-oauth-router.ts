import { createHash } from "node:crypto";
import {
  InvalidClientMetadataError,
  InvalidGrantError,
  InvalidScopeError,
  InvalidTargetError,
  InvalidTokenError,
  OAuthError,
} from "@modelcontextprotocol/sdk/server/auth/errors.js";
import type { AuthorizationParams } from "@modelcontextprotocol/sdk/server/auth/provider.js";
import { Hono } from "hono";
import type { AppEnv } from "../../config/env.js";
import { OAUTH_SCOPE, type OAuthRuntimeConfig } from "./config.js";
import type { SingleTenantOAuthProvider } from "./single-tenant-provider.js";

function sha256Base64url(value: string): string {
  return createHash("sha256").update(value).digest("base64url");
}

function oauthErrorResponse(
  e: unknown,
): { error: string; error_description: string } & { _status: number } {
  if (e instanceof OAuthError) {
    const status =
      e instanceof InvalidClientMetadataError ||
      e instanceof InvalidGrantError ||
      e instanceof InvalidScopeError ||
      e instanceof InvalidTargetError
        ? 400
        : e instanceof InvalidTokenError
          ? 401
          : 400;
    return { error: e.errorCode, error_description: e.message, _status: status };
  }
  return { error: "server_error", error_description: String(e), _status: 500 };
}

export function buildOAuthAsRouter(
  provider: SingleTenantOAuthProvider,
  oauth: OAuthRuntimeConfig,
  _nodeEnv: AppEnv["NODE_ENV"],
): Hono {
  const router = new Hono();

  // GET /.well-known/oauth-authorization-server
  router.get("/.well-known/oauth-authorization-server", (c) => {
    return c.json({
      issuer: oauth.issuerUrl.href,
      authorization_endpoint: new URL("/authorize", oauth.publicBaseUrl).href,
      token_endpoint: new URL("/token", oauth.publicBaseUrl).href,
      registration_endpoint: new URL("/register", oauth.publicBaseUrl).href,
      revocation_endpoint: new URL("/revoke", oauth.publicBaseUrl).href,
      scopes_supported: [OAUTH_SCOPE],
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      revocation_endpoint_auth_methods_supported: ["none"],
    });
  });

  // POST /register
  router.post("/register", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json(
        { error: "invalid_client_metadata", error_description: "Invalid JSON body" },
        400,
      );
    }
    try {
      const client = await provider.clientsStore.registerClient?.(
        body as Parameters<NonNullable<typeof provider.clientsStore.registerClient>>[0],
      );
      return c.json(client, 201);
    } catch (e) {
      if (e instanceof InvalidClientMetadataError) {
        return c.json({ error: "invalid_client_metadata", error_description: e.message }, 400);
      }
      throw e;
    }
  });

  // GET|POST /authorize
  router.on(["GET", "POST"], "/authorize", async (c) => {
    let rawParams: Record<string, string>;
    if (c.req.method === "POST") {
      const parsed = await c.req.parseBody();
      rawParams = parsed as Record<string, string>;
    } else {
      const q = c.req.query();
      rawParams = q as Record<string, string>;
    }

    const clientId = rawParams["client_id"];
    if (!clientId) {
      return c.json({ error: "invalid_client", error_description: "missing client_id" }, 400);
    }
    const client = await provider.clientsStore.getClient(clientId);
    if (!client) {
      return c.json({ error: "invalid_client", error_description: "unknown client_id" }, 400);
    }

    const redirectUri = rawParams["redirect_uri"] ?? "";
    const codeChallenge = rawParams["code_challenge"] ?? "";
    const scopeRaw = rawParams["scope"];
    const state = rawParams["state"];
    const resourceRaw = rawParams["resource"];
    const consentSecret = rawParams["consent_secret"];

    const params: AuthorizationParams = {
      redirectUri,
      codeChallenge,
      ...(scopeRaw !== undefined && { scopes: scopeRaw.split(" ") }),
      ...(state !== undefined && { state }),
      ...(resourceRaw !== undefined && { resource: new URL(resourceRaw) }),
    };

    const outcome = await provider.authorizeRequest(client, params, {
      method: c.req.method,
      ...(consentSecret !== undefined && { consentSecret }),
    });

    if (outcome.kind === "consent") {
      return c.html(outcome.html, outcome.status);
    }
    return c.redirect(outcome.location, 302);
  });

  // POST /token
  router.post("/token", async (c) => {
    const body = await c.req.parseBody();

    const clientId = body["client_id"] as string | undefined;
    if (!clientId) {
      return c.json({ error: "invalid_client", error_description: "missing client_id" }, 400);
    }
    const client = await provider.clientsStore.getClient(clientId);
    if (!client) {
      return c.json({ error: "invalid_client", error_description: "unknown client_id" }, 400);
    }

    const grantType = body["grant_type"] as string | undefined;

    try {
      if (grantType === "authorization_code") {
        const code = body["code"] as string | undefined;
        const codeVerifier = body["code_verifier"] as string | undefined;
        const redirectUri = body["redirect_uri"] as string | undefined;
        const resourceRaw = body["resource"] as string | undefined;

        if (!code) {
          return c.json({ error: "invalid_grant", error_description: "missing code" }, 400);
        }

        // PKCE verification
        const storedChallenge = await provider.challengeForAuthorizationCode(client, code);
        if (codeVerifier !== undefined) {
          const expected = sha256Base64url(codeVerifier);
          if (expected !== storedChallenge) {
            throw new InvalidGrantError("PKCE verification failed");
          }
        }

        const tokens = await provider.exchangeAuthorizationCode(
          client,
          code,
          codeVerifier,
          redirectUri,
          resourceRaw !== undefined ? new URL(resourceRaw) : undefined,
        );
        return c.json(tokens, 200);
      }

      if (grantType === "refresh_token") {
        const refreshToken = body["refresh_token"] as string | undefined;
        const scopeRaw = body["scope"] as string | undefined;
        const resourceRaw = body["resource"] as string | undefined;

        if (!refreshToken) {
          return c.json(
            { error: "invalid_grant", error_description: "missing refresh_token" },
            400,
          );
        }

        const tokens = await provider.exchangeRefreshToken(
          client,
          refreshToken,
          scopeRaw !== undefined ? scopeRaw.split(" ") : undefined,
          resourceRaw !== undefined ? new URL(resourceRaw) : undefined,
        );
        return c.json(tokens, 200);
      }

      return c.json(
        { error: "unsupported_grant_type", error_description: "unsupported grant_type" },
        400,
      );
    } catch (e) {
      const { _status, ...errBody } = oauthErrorResponse(e);
      return c.json(errBody, _status as 400 | 401 | 500);
    }
  });

  // POST /revoke
  router.post("/revoke", async (c) => {
    const body = await c.req.parseBody();
    const clientId = body["client_id"] as string | undefined;
    const token = body["token"] as string | undefined;

    if (!token) {
      return c.json({}, 200);
    }

    // Best-effort client resolution
    let client = clientId ? await provider.clientsStore.getClient(clientId) : undefined;
    if (!client) {
      // Create a minimal placeholder — revokeToken does not depend on client fields
      client = {
        client_id: clientId ?? "unknown",
        redirect_uris: [],
      };
    }

    try {
      await provider.revokeToken(client, { token });
    } catch {
      // Revocation errors are silently ignored per RFC 7009
    }

    return c.json({}, 200);
  });

  return router;
}
