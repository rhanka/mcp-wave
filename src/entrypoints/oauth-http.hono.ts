import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { serve } from "@hono/node-server";
import { getOAuthContext, mcp } from "@sentropic/mcp-hono";
import { GraphQLClient } from "graphql-request";
import { Hono } from "hono";
import type { z } from "zod";
import { type AppEnv, parseEnv } from "../config/env.js";
import { createLogger } from "../config/logger.js";
import { AccountMappingLoader } from "../domain/tax/account-mapping-loader.js";
import { TaxRatesLoader } from "../domain/tax/rates-loader.js";
import { toMcpResult } from "../server/error-bridge.js";
import { originAllowlist } from "../server/http/origin-allowlist.js";
import { rateLimit } from "../server/http/rate-limit.js";
import { OAUTH_SCOPE, oauthConfigFromEnv } from "../server/oauth/config.js";
import { FileOAuthStore } from "../server/oauth/file-store.js";
import { buildOAuthAsRouter } from "../server/oauth/hono-oauth-router.js";
import { SingleTenantOAuthProvider } from "../server/oauth/single-tenant-provider.js";
import { makeValidateToken } from "../server/oauth/token-verifier.js";
import type { ToolContext } from "../server/tool-context.js";
import { allTools } from "../server/tool-registry.js";
import type { WaveCredentialProvider } from "../wave/auth/provider.js";
import { selectProvider } from "../wave/auth/select.js";
import { WaveClient } from "../wave/client.js";

export interface OAuthHttpDeps {
  env: AppEnv;
  logger: ReturnType<typeof createLogger>;
  provider: WaveCredentialProvider;
  oauthStore: FileOAuthStore;
  wave: WaveClient;
  taxRates: TaxRatesLoader;
  accountMapping: AccountMappingLoader;
}

export function buildOAuthHonoApp(deps: OAuthHttpDeps): Hono {
  const oauth = oauthConfigFromEnv(deps.env);

  const oauthProvider = new SingleTenantOAuthProvider({
    store: deps.oauthStore,
    nodeEnv: deps.env.NODE_ENV,
    issuerUrl: oauth.issuerUrl,
    publicBaseUrl: oauth.publicBaseUrl,
    resourceServerUrl: oauth.resourceServerUrl,
    consentSecret: oauth.consentSecret,
    allowedRedirectUris: oauth.allowedRedirectUris,
    authCodeTtlSeconds: oauth.authCodeTtlSeconds,
    accessTokenTtlSeconds: oauth.accessTokenTtlSeconds,
    refreshTokenTtlSeconds: oauth.refreshTokenTtlSeconds,
  });

  const app = new Hono();
  const allowedOrigins = deps.env.ALLOWED_ORIGINS.split(",").map((s) => s.trim());

  app.use("*", originAllowlist(allowedOrigins));
  app.use("*", rateLimit(deps.env.RATE_LIMIT_RPM));

  app.get("/healthz", (c) => c.json({ ok: true }));

  app.get("/readyz", async (c) => {
    const issues: string[] = [];
    try {
      await deps.taxRates.load("CA-QC", new Date().getUTCFullYear());
    } catch (e) {
      issues.push(`tax-rates: ${e instanceof Error ? e.message : String(e)}`);
    }
    try {
      const gql = new GraphQLClient(deps.env.WAVE_GRAPHQL_ENDPOINT);
      await gql.request("{ __typename }");
    } catch (e) {
      issues.push(`wave-schema: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (issues.length > 0) return c.json({ ok: false, issues }, 503);
    return c.json({ ok: true });
  });

  // Mount Authorization Server routes at root
  app.route("/", buildOAuthAsRouter(oauthProvider, oauth, deps.env.NODE_ENV));

  // Serve Protected Resource Metadata at the root-level well-known path.
  //
  // The mcp-hono lib mounts its own PRM handler at
  //   /.well-known/oauth-protected-resource
  // relative to the McpHono mount point (i.e. /mcp/.well-known/oauth-protected-resource).
  // Our resourceMetadataUrl is http://host/.well-known/oauth-protected-resource/mcp
  // (a different root-level path), so the lib does NOT serve it automatically.
  // We add this route manually so the URL advertised in WWW-Authenticate resolves.
  app.get("/.well-known/oauth-protected-resource/mcp", (c) => {
    const body: Record<string, unknown> = {
      resource: oauth.resourceServerUrl.href,
      authorization_servers: [oauth.issuerUrl.href],
      bearer_methods_supported: ["header"],
      scopes_supported: [OAUTH_SCOPE],
    };
    return c.json(body);
  });

  // Build MCP server with OAuth protection.
  //
  // Note: mcp-hono validates tool arguments against the Zod schema BEFORE calling
  // the handler, returning a JSON-RPC -32602 INVALID_PARAMS error on failure.
  // This differs from our error-bridge INVALID_INPUT envelope. This is an accepted
  // behavior change; we do not double-validate here.
  const server = mcp({
    name: "mcp-wave",
    version: "0.1.0",
    oauth: {
      issuer: oauth.issuerUrl.href,
      authorizationServers: [oauth.issuerUrl.href],
      resource: oauth.resourceServerUrl.href,
      resourceMetadataUrl: oauth.resourceMetadataUrl,
      requiredScopes: [OAUTH_SCOPE],
      scopesSupported: [OAUTH_SCOPE],
      validateToken: makeValidateToken(oauthProvider, oauth.issuerUrl.href),
    },
  });

  for (const tool of allTools()) {
    server.tool({
      name: tool.name,
      description: tool.description,
      schema: tool.inputSchema as unknown as z.ZodObject<z.ZodRawShape>,
      handler: (args, c) => {
        const requestId = randomUUID();
        const octx = getOAuthContext(c);
        const identity =
          "oauth:" +
          (octx?.subject ?? "unknown") +
          ":" +
          String(octx?.claims?.["tokenHashPrefix"] ?? "unknown");
        const ctx: ToolContext = {
          req: { headers: c.req.raw.headers, request_id: requestId },
          wave: deps.wave,
          taxRates: deps.taxRates,
          accountMapping: deps.accountMapping,
          env: deps.env,
          logger: deps.logger.child({ request_id: requestId }),
          identity,
        };
        return toMcpResult(tool)(args, ctx);
      },
    });
  }

  app.route("/mcp", server);

  return app;
}

async function defaultDeps(): Promise<OAuthHttpDeps> {
  const env = parseEnv(process.env);
  const logger = createLogger({ level: env.LOG_LEVEL, logPII: env.LOG_PII });
  const provider = selectProvider(env);
  const oauthStore = new FileOAuthStore(env.OAUTH_STORE_PATH);
  await oauthStore.load();
  return {
    env,
    logger,
    provider,
    oauthStore,
    wave: new WaveClient({ endpoint: env.WAVE_GRAPHQL_ENDPOINT, provider }),
    taxRates: new TaxRatesLoader(resolve("data/tax-rates")),
    accountMapping: new AccountMappingLoader(resolve("data/account-mapping")),
  };
}

if (process.env.NODE_ENV !== "test") {
  const deps = await defaultDeps();
  const app = buildOAuthHonoApp(deps);
  const port = Number(process.env.PORT ?? 8080);
  serve({ fetch: app.fetch, port }, () => {
    deps.logger.info({ port, tools: allTools().length }, "mcp-wave oauth hono ready");
  });
}
