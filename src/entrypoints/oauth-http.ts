import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { StreamableHTTPTransport } from "@hono/mcp";
import { bearerAuth } from "@hono/mcp/auth";
import { serve } from "@hono/node-server";
import { GraphQLClient } from "graphql-request";
import { type Context, Hono } from "hono";
import { type AppEnv, parseEnv } from "../config/env.js";
import { createLogger } from "../config/logger.js";
import { AccountMappingLoader } from "../domain/tax/account-mapping-loader.js";
import { TaxRatesLoader } from "../domain/tax/rates-loader.js";
import { originAllowlist } from "../server/http/origin-allowlist.js";
import { rateLimit } from "../server/http/rate-limit.js";
import { buildMcpServer } from "../server/mcp-server.js";
import { OAUTH_SCOPE, oauthConfigFromEnv } from "../server/oauth/config.js";
import { FileOAuthStore } from "../server/oauth/file-store.js";
import { buildOAuthRoutes } from "../server/oauth/hono-oauth-router.js";
import { SingleTenantOAuthProvider } from "../server/oauth/single-tenant-provider.js";
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

interface McpSession {
  transport: StreamableHTTPTransport;
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

  // Origin allowlist guards ONLY the MCP JSON-RPC endpoint (DNS-rebinding
  // protection for the browser-called /mcp). The OAuth endpoints are part of a
  // browser-driven flow (the operator opens /authorize and submits the consent
  // form same-origin), so a global allowlist would 403 them — scope it to /mcp.
  app.use("*", rateLimit(deps.env.RATE_LIMIT_RPM));

  // Access log (skip k8s probes) — surfaces the OAuth handler responses, which
  // the @hono/mcp handlers do not log themselves.
  app.use("*", async (c, next) => {
    await next();
    if (c.req.path !== "/healthz" && c.req.path !== "/readyz") {
      deps.logger.info({ method: c.req.method, path: c.req.path, status: c.res.status }, "http");
    }
  });

  app.get("/healthz", (c) => c.json({ ok: true }));

  // Connector icon (Claude.ai fetches the origin favicon for the connector card).
  const faviconSvg =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 229.49 229.49" role="img" aria-label="SENT Tech">' +
    '<g fill="#133d5e">' +
    '<rect x="0" y="0" width="63.86" height="63.86" rx="9.82"/>' +
    '<rect x="165.82" y="0" width="63.86" height="63.86" rx="9.82"/>' +
    '<rect x="0" y="165.63" width="63.86" height="63.86" rx="9.82"/>' +
    '<rect x="165.82" y="165.63" width="63.86" height="63.86" rx="9.82"/>' +
    '<rect x="82.67" y="81.15" width="63.86" height="63.86" rx="14.74"/>' +
    '<g opacity="0.6">' +
    '<rect x="82.67" y="0" width="63.86" height="63.86" rx="31.93"/>' +
    '<rect x="0" y="81.15" width="63.86" height="63.86" rx="31.93"/>' +
    '<rect x="165.82" y="81.15" width="63.86" height="63.86" rx="31.93"/>' +
    '<rect x="82.67" y="165.63" width="63.86" height="63.86" rx="31.93"/>' +
    "</g></g></svg>";
  const serveFavicon = (c: Context) => {
    c.header("Content-Type", "image/svg+xml");
    c.header("Cache-Control", "public, max-age=86400");
    return c.body(faviconSvg);
  };
  app.get("/favicon.svg", serveFavicon);
  app.get("/favicon.ico", serveFavicon);

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

  // OAuth authorization-server + protected-resource routes (mounted at root).
  app.route("/", buildOAuthRoutes(oauthProvider, oauth, deps.env.NODE_ENV));

  // Bearer auth for /mcp: validates the access token (and scope) via the provider.
  // @hono/mcp's bearerAuth emits 401 + WWW-Authenticate with resource_metadata.
  const requireAuth = bearerAuth({
    verifyToken: async (token: string): Promise<boolean> => {
      try {
        const info = await oauthProvider.verifyAccessToken(token);
        return info.scopes.includes(OAUTH_SCOPE);
      } catch {
        return false;
      }
    },
  });

  const sessions = new Map<string, McpSession>();

  const mcpHandler = async (c: Context) => {
    const requestId = randomUUID();
    const requestedSessionId = c.req.header("mcp-session-id");
    let session = requestedSessionId ? sessions.get(requestedSessionId) : undefined;

    if (!session) {
      // requireAuth guarantees a valid bearer token; re-read it for identity.
      const token = (c.req.header("authorization") ?? "").replace(/^Bearer\s+/i, "");
      const authInfo = await oauthProvider.verifyAccessToken(token);
      const identity = `oauth:${authInfo.clientId}:${String(authInfo.extra?.["tokenHashPrefix"] ?? "unknown")}`;

      let created: McpSession | undefined;
      const transport = new StreamableHTTPTransport({
        enableJsonResponse: true,
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sessionId) => {
          if (created) sessions.set(sessionId, created);
        },
        onsessionclosed: (sessionId) => {
          sessions.delete(sessionId);
        },
      });
      created = { transport };

      const { server } = buildMcpServer({
        tools: allTools(),
        makeCtx: (): ToolContext => ({
          req: { headers: c.req.raw.headers, request_id: requestId },
          wave: deps.wave,
          taxRates: deps.taxRates,
          accountMapping: deps.accountMapping,
          env: deps.env,
          logger: deps.logger.child({ request_id: requestId }),
          identity,
        }),
      });
      await server.connect(transport);
      session = created;
    }

    deps.logger.info({ request_id: requestId }, "mcp oauth http request");
    const res = await session.transport.handleRequest(c);
    return res ?? c.body(null, 202);
  };

  // Serve the MCP endpoint at both the dedicated /mcp path and the root, so the
  // connector works whether it is registered as https://host or https://host/mcp
  // (Claude.ai connects at the path the 401 came from).
  app.all("/mcp", originAllowlist(allowedOrigins), requireAuth, mcpHandler);
  app.all("/", originAllowlist(allowedOrigins), requireAuth, mcpHandler);

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
