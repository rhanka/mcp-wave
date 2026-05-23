import type { AppEnv } from "../../config/env.js";

export const OAUTH_SCOPE = "mcp:tools";

export interface OAuthRuntimeConfig {
  issuerUrl: URL;
  publicBaseUrl: URL;
  resourceServerUrl: URL;
  resourceMetadataUrl: string;
  consentSecret: string;
  allowedRedirectUris: readonly string[];
  accessTokenTtlSeconds: number;
  refreshTokenTtlSeconds: number;
  authCodeTtlSeconds: number;
}

export function parseOAuthCsv(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

export function oauthConfigFromEnv(env: AppEnv): OAuthRuntimeConfig {
  const publicBaseUrl = new URL(env.PUBLIC_BASE_URL);
  const issuerUrl = new URL(env.OAUTH_ISSUER_URL);
  const resourceServerUrl = new URL("/mcp", publicBaseUrl);
  const resourceMetadataUrl = new URL(
    "/.well-known/oauth-protected-resource/mcp",
    publicBaseUrl,
  ).href;

  return {
    issuerUrl,
    publicBaseUrl,
    resourceServerUrl,
    resourceMetadataUrl,
    consentSecret: env.OAUTH_CONSENT_SECRET ?? "local-dev-consent",
    allowedRedirectUris: parseOAuthCsv(env.OAUTH_ALLOWED_REDIRECT_URIS),
    accessTokenTtlSeconds: env.OAUTH_ACCESS_TOKEN_TTL_SECONDS,
    refreshTokenTtlSeconds: env.OAUTH_REFRESH_TOKEN_TTL_SECONDS,
    authCodeTtlSeconds: env.OAUTH_AUTH_CODE_TTL_SECONDS,
  };
}
