import type { OAuthRegisteredClientsStore } from "@modelcontextprotocol/sdk/server/auth/clients.js";
import {
  InvalidClientMetadataError,
  InvalidGrantError,
  InvalidScopeError,
  InvalidTargetError,
  InvalidTokenError,
} from "@modelcontextprotocol/sdk/server/auth/errors.js";
import type {
  AuthorizationParams,
  OAuthServerProvider,
} from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type {
  OAuthClientInformationFull,
  OAuthTokenRevocationRequest,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import type { Response } from "express";
import type { AppEnv } from "../../config/env.js";
import { OAUTH_SCOPE } from "./config.js";
import { randomToken, sha256Hex, timingSafeEqualString, tokenHashPrefix } from "./crypto.js";
import type { FileOAuthStore } from "./file-store.js";
import { allRedirectUrisAllowed } from "./redirect-uri.js";

export type AuthorizeOutcome =
  | { kind: "consent"; status: 200 | 401; html: string }
  | { kind: "redirect"; location: string };

interface ProviderOptions {
  store: FileOAuthStore;
  nodeEnv: AppEnv["NODE_ENV"];
  issuerUrl: URL;
  publicBaseUrl: URL;
  resourceServerUrl: URL;
  consentSecret: string;
  allowedRedirectUris: readonly string[];
  authCodeTtlSeconds: number;
  accessTokenTtlSeconds: number;
  refreshTokenTtlSeconds: number;
  nowSeconds?: () => number;
}

interface IssueCodeParams {
  redirectUri: string;
  codeChallenge: string;
  scopes: string[];
  resource?: URL;
  state?: string;
}

// Wider clients-store type: registerClient accepts a full client object so that
// tests (and the SDK router, which constructs the full object before calling us)
// can pass client_id / client_id_issued_at.  The class field is typed as this
// intersection so it satisfies both the SDK interface and the test call-sites.
type WideClientsStore = Omit<OAuthRegisteredClientsStore, "registerClient"> & {
  registerClient?(
    client: OAuthClientInformationFull,
  ): OAuthClientInformationFull | Promise<OAuthClientInformationFull>;
};

export class SingleTenantOAuthProvider implements OAuthServerProvider {
  readonly clientsStore: WideClientsStore;

  constructor(private readonly opts: ProviderOptions) {
    this.clientsStore = {
      getClient: (clientId) => this.opts.store.getClient(clientId),
      registerClient: async (client) => {
        if (
          !allRedirectUrisAllowed(
            client.redirect_uris,
            this.opts.allowedRedirectUris,
            this.opts.nodeEnv,
          )
        ) {
          throw new InvalidClientMetadataError("redirect_uris contains a URI that is not allowed");
        }

        const normalized: OAuthClientInformationFull = {
          ...client,
          scope: OAUTH_SCOPE,
          grant_types: ["authorization_code", "refresh_token"],
          response_types: ["code"],
          token_endpoint_auth_method: client.token_endpoint_auth_method ?? "none",
        };

        return this.opts.store.registerClient(normalized);
      },
    };
  }

  private nowSeconds(): number {
    return this.opts.nowSeconds?.() ?? Math.floor(Date.now() / 1000);
  }

  async authorizeRequest(
    client: OAuthClientInformationFull,
    params: AuthorizationParams,
    input: { method: string; consentSecret?: string },
  ): Promise<AuthorizeOutcome> {
    if (input.method !== "POST") {
      return {
        kind: "consent",
        status: 200,
        html: this.renderConsentForm(client, params, undefined),
      };
    }

    if (
      !input.consentSecret ||
      !timingSafeEqualString(input.consentSecret, this.opts.consentSecret)
    ) {
      return {
        kind: "consent",
        status: 401,
        html: this.renderConsentForm(client, params, "Invalid consent secret"),
      };
    }

    const code = await this.issueAuthorizationCode(client, {
      redirectUri: params.redirectUri,
      codeChallenge: params.codeChallenge,
      scopes: this.normalizeScopes(params.scopes),
      ...(params.resource !== undefined && { resource: params.resource }),
      ...(params.state !== undefined && { state: params.state }),
    });

    const redirect = new URL(params.redirectUri);
    redirect.searchParams.set("code", code);
    if (params.state) redirect.searchParams.set("state", params.state);
    return { kind: "redirect", location: redirect.href };
  }

  async authorize(
    client: OAuthClientInformationFull,
    params: AuthorizationParams,
    res: Response,
  ): Promise<void> {
    const req = res.req;
    const body = req.body as { consent_secret?: string } | undefined;
    const consentSecret = body?.consent_secret;
    const outcome = await this.authorizeRequest(client, params, {
      method: req.method,
      ...(consentSecret !== undefined && { consentSecret }),
    });
    if (outcome.kind === "consent") {
      res.status(outcome.status).type("html").send(outcome.html);
    } else {
      res.redirect(302, outcome.location);
    }
  }

  async issueAuthorizationCode(
    client: OAuthClientInformationFull,
    params: IssueCodeParams,
  ): Promise<string> {
    const resource = this.normalizeResource(params.resource);
    const scopes = this.normalizeScopes(params.scopes);
    const code = randomToken();
    const now = this.nowSeconds();
    await this.opts.store.putAuthorizationCode(code, {
      clientId: client.client_id,
      redirectUri: params.redirectUri,
      codeChallenge: params.codeChallenge,
      scopes,
      resource: resource.href,
      createdAt: now,
      expiresAt: now + this.opts.authCodeTtlSeconds,
    });
    return code;
  }

  private renderConsentForm(
    client: OAuthClientInformationFull,
    params: AuthorizationParams,
    error: string | undefined,
  ): string {
    const scope = this.normalizeScopes(params.scopes).join(" ");
    const resource = this.normalizeResource(params.resource).href;
    const errorHtml = error ? `<p role="alert">${escapeHtml(error)}</p>` : "";
    return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Authorize mcp-wave</title></head>
<body>
<main>
<h1>Authorize mcp-wave</h1>
${errorHtml}
<form method="post" action="/authorize">
<input type="hidden" name="response_type" value="code">
<input type="hidden" name="client_id" value="${escapeHtml(client.client_id)}">
<input type="hidden" name="redirect_uri" value="${escapeHtml(params.redirectUri)}">
<input type="hidden" name="code_challenge" value="${escapeHtml(params.codeChallenge)}">
<input type="hidden" name="code_challenge_method" value="S256">
<input type="hidden" name="scope" value="${escapeHtml(scope)}">
<input type="hidden" name="resource" value="${escapeHtml(resource)}">
${params.state ? `<input type="hidden" name="state" value="${escapeHtml(params.state)}">` : ""}
<p>Client: ${escapeHtml(client.client_name ?? client.client_id)}</p>
<p>Redirect URI: ${escapeHtml(params.redirectUri)}</p>
<p>Scope: ${escapeHtml(scope)}</p>
<label>Consent secret <input name="consent_secret" type="password" autocomplete="current-password"></label>
<button type="submit">Authorize</button>
</form>
</main>
</body>
</html>`;
  }

  async challengeForAuthorizationCode(
    _client: OAuthClientInformationFull,
    authorizationCode: string,
  ): Promise<string> {
    const record = await this.opts.store.getAuthorizationCode(authorizationCode, this.nowSeconds());
    if (!record) throw new InvalidGrantError("authorization code is invalid or expired");
    return record.codeChallenge;
  }

  async exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string,
    _codeVerifier?: string,
    redirectUri?: string,
    resource?: URL,
  ): Promise<OAuthTokens> {
    const record = await this.opts.store.consumeAuthorizationCode(
      authorizationCode,
      this.nowSeconds(),
    );
    if (!record)
      throw new InvalidGrantError("authorization code is invalid, expired, or already used");
    if (record.clientId !== client.client_id)
      throw new InvalidGrantError("authorization code was issued to another client");
    if (redirectUri && redirectUri !== record.redirectUri)
      throw new InvalidGrantError("redirect_uri does not match authorization code");
    if (this.normalizeResource(resource).href !== record.resource)
      throw new InvalidTargetError("resource does not match authorization code");
    return this.issueTokens(client, record.scopes, new URL(record.resource), undefined);
  }

  async exchangeRefreshToken(
    client: OAuthClientInformationFull,
    refreshToken: string,
    scopes?: string[],
    resource?: URL,
  ): Promise<OAuthTokens> {
    const record = await this.opts.store.findToken(refreshToken);
    const now = this.nowSeconds();
    if (!record || record.tokenType !== "refresh" || record.revokedAt || record.expiresAt <= now) {
      throw new InvalidGrantError("refresh token is invalid or expired");
    }
    if (record.clientId !== client.client_id)
      throw new InvalidGrantError("refresh token was issued to another client");
    if (this.normalizeResource(resource).href !== record.resource)
      throw new InvalidTargetError("resource does not match refresh token");

    const requestedScopes = this.normalizeScopes(scopes ?? record.scopes);
    if (!requestedScopes.every((scope) => record.scopes.includes(scope))) {
      throw new InvalidScopeError("requested scope exceeds refresh token scope");
    }

    await this.opts.store.revokeToken(refreshToken, now);
    return this.issueTokens(
      client,
      requestedScopes,
      new URL(record.resource),
      sha256Hex(refreshToken),
    );
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const record = await this.opts.store.findToken(token);
    const now = this.nowSeconds();
    if (!record || record.tokenType !== "access" || record.revokedAt || record.expiresAt <= now) {
      throw new InvalidTokenError("access token is invalid or expired");
    }
    return {
      token,
      clientId: record.clientId,
      scopes: record.scopes,
      expiresAt: record.expiresAt,
      resource: new URL(record.resource),
      extra: {
        tokenHashPrefix: tokenHashPrefix(record.tokenHash),
      },
    };
  }

  async revokeToken(
    _client: OAuthClientInformationFull,
    request: OAuthTokenRevocationRequest,
  ): Promise<void> {
    await this.opts.store.revokeToken(request.token, this.nowSeconds());
  }

  async issueTokensForTests(client: OAuthClientInformationFull): Promise<OAuthTokens> {
    return this.issueTokens(client, [OAUTH_SCOPE], this.opts.resourceServerUrl, undefined);
  }

  private async issueTokens(
    client: OAuthClientInformationFull,
    scopes: string[],
    resource: URL,
    parentRefreshTokenHash: string | undefined,
  ): Promise<OAuthTokens> {
    const accessToken = randomToken();
    const refreshToken = randomToken();
    const now = this.nowSeconds();
    await this.opts.store.putToken(accessToken, {
      tokenType: "access",
      clientId: client.client_id,
      scopes,
      resource: resource.href,
      issuedAt: now,
      expiresAt: now + this.opts.accessTokenTtlSeconds,
      ...(parentRefreshTokenHash !== undefined && { parentRefreshTokenHash }),
    });
    await this.opts.store.putToken(refreshToken, {
      tokenType: "refresh",
      clientId: client.client_id,
      scopes,
      resource: resource.href,
      issuedAt: now,
      expiresAt: now + this.opts.refreshTokenTtlSeconds,
      ...(parentRefreshTokenHash !== undefined && { parentRefreshTokenHash }),
    });
    return {
      access_token: accessToken,
      refresh_token: refreshToken,
      token_type: "Bearer",
      expires_in: this.opts.accessTokenTtlSeconds,
      scope: scopes.join(" "),
    };
  }

  private normalizeScopes(scopes: readonly string[] | undefined): string[] {
    const requested = scopes && scopes.length > 0 ? [...scopes] : [OAUTH_SCOPE];
    if (!requested.every((scope) => scope === OAUTH_SCOPE)) {
      throw new InvalidScopeError("only mcp:tools scope is supported");
    }
    return [OAUTH_SCOPE];
  }

  private normalizeResource(resource: URL | undefined): URL {
    const resolved = resource ?? this.opts.resourceServerUrl;
    if (resolved.href !== this.opts.resourceServerUrl.href) {
      throw new InvalidTargetError("resource must match the MCP resource server URL");
    }
    return resolved;
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
