import type { OAuthRegisteredClientsStore } from "@modelcontextprotocol/sdk/server/auth/clients.js";
import {
  InvalidClientMetadataError,
  InvalidGrantError,
  InvalidScopeError,
  InvalidTargetError,
  InvalidTokenError,
} from "@modelcontextprotocol/sdk/server/auth/errors.js";
import type { AuthorizationParams } from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type {
  OAuthClientInformationFull,
  OAuthTokenRevocationRequest,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
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

export class SingleTenantOAuthProvider {
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
    const clientName = escapeHtml(client.client_name ?? client.client_id);
    const errorHtml = error ? `<p class="alert" role="alert">${escapeHtml(error)}</p>` : "";
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Connect to Wave · SENT Tech</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<style>
  :root {
    --bg: #f8fafc; --surface: #ffffff; --ink: #0f172a; --muted: #475569;
    --border: #e2e8f0; --brand: oklch(50% 0.134 242.749); --brand-ink: #ffffff;
    --warn-bg: #fffbeb; --warn-border: #fcd34d; --warn-ink: #92400e;
    --radius: 0.5rem;
    --font: Inter, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    --mono: 'SFMono-Regular', Consolas, 'Liberation Mono', monospace;
  }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center;
    background: var(--bg); color: var(--ink); font-family: var(--font);
    line-height: 1.5; padding: 1.5rem; }
  .card { width: 100%; max-width: 30rem; background: var(--surface);
    border: 1px solid var(--border); border-radius: var(--radius);
    box-shadow: 0 1px 3px rgb(15 23 42 / 0.08); padding: 1.75rem; }
  .head { display: flex; align-items: center; gap: 0.75rem; margin-bottom: 1.25rem; }
  .head svg { width: 40px; height: 40px; border-radius: 10px; flex: none; }
  .head h1 { font-size: 1.125rem; margin: 0; }
  .head p { margin: 0; font-size: 0.8125rem; color: var(--muted); }
  .lead { font-size: 0.9375rem; color: var(--muted); margin: 0 0 1.25rem; }
  dl { display: grid; grid-template-columns: auto 1fr; gap: 0.4rem 0.9rem;
    margin: 0 0 1.25rem; font-size: 0.8125rem; }
  dt { color: var(--muted); }
  dd { margin: 0; word-break: break-all; font-family: var(--mono); font-size: 0.75rem; }
  .disclaimer { background: var(--warn-bg); border: 1px solid var(--warn-border);
    color: var(--warn-ink); border-radius: var(--radius); padding: 0.75rem 0.9rem;
    font-size: 0.8125rem; margin: 0 0 1.25rem; }
  .disclaimer a { color: inherit; font-weight: 600; }
  label { display: block; font-size: 0.875rem; font-weight: 600; margin-bottom: 0.35rem; }
  .hint { font-weight: 400; color: var(--muted); font-size: 0.8125rem; }
  input[type=password] { width: 100%; padding: 0.6rem 0.7rem; font-size: 0.95rem;
    border: 1px solid var(--border); border-radius: var(--radius);
    margin-bottom: 1rem; font-family: var(--mono); }
  input[type=password]:focus { outline: 2px solid var(--brand); outline-offset: 1px; border-color: var(--brand); }
  button { width: 100%; padding: 0.65rem 1rem; font-size: 0.95rem; font-weight: 600;
    color: var(--brand-ink); background: var(--brand); border: 0;
    border-radius: var(--radius); cursor: pointer; }
  button:hover { filter: brightness(0.94); }
  .alert { background: #fef2f2; border: 1px solid #fecaca; color: #991b1b;
    border-radius: var(--radius); padding: 0.6rem 0.8rem; font-size: 0.8125rem; margin: 0 0 1rem; }
</style>
</head>
<body>
<main class="card">
  <div class="head">
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 229.49 229.49" role="img" aria-label="SENT Tech">
      <g fill="#133d5e">
        <rect x="0" y="0" width="63.86" height="63.86" rx="9.82"/>
        <rect x="165.82" y="0" width="63.86" height="63.86" rx="9.82"/>
        <rect x="0" y="165.63" width="63.86" height="63.86" rx="9.82"/>
        <rect x="165.82" y="165.63" width="63.86" height="63.86" rx="9.82"/>
        <rect x="82.67" y="81.15" width="63.86" height="63.86" rx="14.74"/>
        <g opacity="0.6">
          <rect x="82.67" y="0" width="63.86" height="63.86" rx="31.93"/>
          <rect x="0" y="81.15" width="63.86" height="63.86" rx="31.93"/>
          <rect x="165.82" y="81.15" width="63.86" height="63.86" rx="31.93"/>
          <rect x="82.67" y="165.63" width="63.86" height="63.86" rx="31.93"/>
        </g>
      </g>
    </svg>
    <div>
      <h1>Connect to Wave</h1>
      <p>SENT Tech · Wave MCP connector</p>
    </div>
  </div>
  <p class="lead"><strong>${clientName}</strong> is requesting access to this Wave
    MCP connector. Approving grants it the <code>mcp:tools</code> scope on this
    endpoint only &mdash; it never receives your Wave credentials. Enter the
    operator consent secret (held by whoever deployed this server) to approve.</p>
  ${errorHtml}
  <dl>
    <dt>Client</dt><dd>${clientName}</dd>
    <dt>Redirect</dt><dd>${escapeHtml(params.redirectUri)}</dd>
    <dt>Scope</dt><dd>${escapeHtml(scope)}</dd>
  </dl>
  <div class="disclaimer">
    <strong>Experimental connector.</strong> Provided by SENT Tech as-is, on an
    experimental basis, without warranty of any kind. SENT Tech disclaims all
    liability arising from the use of this solution. For official support,
    contact <a href="mailto:admin@sent-tech.ca">admin@sent-tech.ca</a>.
  </div>
  <form method="post" action="/authorize">
    <input type="hidden" name="response_type" value="code">
    <input type="hidden" name="client_id" value="${escapeHtml(client.client_id)}">
    <input type="hidden" name="redirect_uri" value="${escapeHtml(params.redirectUri)}">
    <input type="hidden" name="code_challenge" value="${escapeHtml(params.codeChallenge)}">
    <input type="hidden" name="code_challenge_method" value="S256">
    <input type="hidden" name="scope" value="${escapeHtml(scope)}">
    <input type="hidden" name="resource" value="${escapeHtml(resource)}">
    ${params.state ? `<input type="hidden" name="state" value="${escapeHtml(params.state)}">` : ""}
    <label for="cs">Consent secret <span class="hint">— operator only</span></label>
    <input id="cs" name="consent_secret" type="password" autocomplete="current-password" autofocus>
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
    const rs = this.opts.resourceServerUrl;
    if (resource === undefined) return rs;
    // Accept the canonical RS URL as well as the bare origin and trailing-slash
    // variants — MCP clients (Claude.ai) advertise the resource indicator as
    // either `https://host/mcp` or `https://host`. All normalize to the RS URL.
    const path = resource.pathname.replace(/\/+$/, "");
    const rsPath = rs.pathname.replace(/\/+$/, "");
    if (resource.origin === rs.origin && (path === rsPath || path === "")) {
      return rs;
    }
    throw new InvalidTargetError("resource must match the MCP resource server URL");
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
