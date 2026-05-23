import type { AppEnv } from "../../config/env.js";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

export function redirectUriAllowed(
  redirectUri: string,
  allowedRedirectUris: readonly string[],
  nodeEnv: AppEnv["NODE_ENV"],
): boolean {
  let parsed: URL;
  try {
    parsed = new URL(redirectUri);
  } catch {
    return false;
  }

  if (allowedRedirectUris.includes(parsed.href)) {
    return true;
  }

  if (nodeEnv !== "production" && LOOPBACK_HOSTS.has(parsed.hostname)) {
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  }

  return false;
}

export function allRedirectUrisAllowed(
  redirectUris: readonly string[],
  allowedRedirectUris: readonly string[],
  nodeEnv: AppEnv["NODE_ENV"],
): boolean {
  return redirectUris.every((redirectUri) =>
    redirectUriAllowed(redirectUri, allowedRedirectUris, nodeEnv),
  );
}
