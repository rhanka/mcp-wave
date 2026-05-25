import type { OAuthTokenValidationResult } from "@sentropic/mcp-hono";
import type { SingleTenantOAuthProvider } from "./single-tenant-provider.js";

export function makeValidateToken(
  provider: SingleTenantOAuthProvider,
  issuerHref: string,
): (token: string) => Promise<OAuthTokenValidationResult | false> {
  return async (token: string): Promise<OAuthTokenValidationResult | false> => {
    try {
      const a = await provider.verifyAccessToken(token);
      return {
        subject: a.clientId,
        scopes: a.scopes,
        ...(a.resource !== undefined && { audience: a.resource.href }),
        issuer: issuerHref,
        ...(a.extra !== undefined && {
          claims: { tokenHashPrefix: a.extra.tokenHashPrefix },
        }),
      };
    } catch {
      return false;
    }
  };
}
