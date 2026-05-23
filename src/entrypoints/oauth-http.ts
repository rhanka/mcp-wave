import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import { mcpAuthRouter } from "@modelcontextprotocol/sdk/server/auth/router.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express, { type Express } from "express";
import rateLimit from "express-rate-limit";
import { GraphQLClient } from "graphql-request";
import { type AppEnv, parseEnv } from "../config/env.js";
import { createLogger } from "../config/logger.js";
import { AccountMappingLoader } from "../domain/tax/account-mapping-loader.js";
import { TaxRatesLoader } from "../domain/tax/rates-loader.js";
import { expressOriginAllowlist } from "../server/http/express-origin-allowlist.js";
import { buildMcpServer } from "../server/mcp-server.js";
import { OAUTH_SCOPE, oauthConfigFromEnv } from "../server/oauth/config.js";
import { FileOAuthStore } from "../server/oauth/file-store.js";
import { SingleTenantOAuthProvider } from "../server/oauth/single-tenant-provider.js";
import { allTools } from "../server/tool-registry.js";
import type { WaveCredentialProvider } from "../wave/auth/provider.js";
import { selectProvider } from "../wave/auth/select.js";
import { WaveClient } from "../wave/client.js";

export interface OAuthHttpAppDeps {
  env: AppEnv;
  logger: ReturnType<typeof createLogger>;
  provider: WaveCredentialProvider;
  oauthStore: FileOAuthStore;
  wave: WaveClient;
  taxRates: TaxRatesLoader;
  accountMapping: AccountMappingLoader;
}

interface OAuthHttpSession {
  transport: StreamableHTTPServerTransport;
}

export function buildOAuthHttpApp(deps: OAuthHttpAppDeps): Express {
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

  const app = express();
  const sessions = new Map<string, OAuthHttpSession>();
  const allowedOrigins = deps.env.ALLOWED_ORIGINS.split(",").map((origin) => origin.trim());

  app.set("trust proxy", 1);
  app.disable("x-powered-by");
  app.use(expressOriginAllowlist(allowedOrigins));
  app.use(
    rateLimit({
      windowMs: 60_000,
      limit: deps.env.RATE_LIMIT_RPM,
      standardHeaders: true,
      legacyHeaders: false,
    }),
  );

  app.get("/healthz", (_req, res) => {
    res.json({ ok: true });
  });

  app.get("/readyz", async (_req, res) => {
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
    if (issues.length > 0) {
      res.status(503).json({ ok: false, issues });
      return;
    }
    res.json({ ok: true });
  });

  app.use(
    mcpAuthRouter({
      provider: oauthProvider,
      issuerUrl: oauth.issuerUrl,
      baseUrl: oauth.publicBaseUrl,
      resourceServerUrl: oauth.resourceServerUrl,
      resourceName: "mcp-wave",
      scopesSupported: [OAUTH_SCOPE],
    }),
  );

  app.all(
    "/mcp",
    express.json({ limit: "1mb", type: ["application/json", "application/*+json"] }),
    requireBearerAuth({
      verifier: oauthProvider,
      requiredScopes: [OAUTH_SCOPE],
      resourceMetadataUrl: oauth.resourceMetadataUrl,
    }),
    async (req, res, next) => {
      try {
        const requestId = randomUUID();
        const requestedSessionId = req.header("mcp-session-id");
        let session = requestedSessionId ? sessions.get(requestedSessionId) : undefined;

        if (!session) {
          let newSession: OAuthHttpSession | undefined;
          const transport = new StreamableHTTPServerTransport({
            enableJsonResponse: true,
            sessionIdGenerator: () => randomUUID(),
            onsessioninitialized: (sessionId) => {
              if (newSession) sessions.set(sessionId, newSession);
            },
            onsessionclosed: (sessionId) => {
              sessions.delete(sessionId);
            },
          });
          newSession = { transport };
          const clientId = req.auth?.clientId ?? "unknown";
          const tokenHashPrefix =
            req.auth?.extra !== undefined && typeof req.auth.extra.tokenHashPrefix === "string"
              ? req.auth.extra.tokenHashPrefix
              : "unknown";
          const identity = `oauth:${clientId}:${tokenHashPrefix}`;
          const reqCtx = {
            headers: new Headers(req.headers as Record<string, string>),
            request_id: requestId,
          };
          const { server } = buildMcpServer({
            tools: allTools(),
            makeCtx: () => ({
              req: reqCtx,
              wave: deps.wave,
              taxRates: deps.taxRates,
              accountMapping: deps.accountMapping,
              env: deps.env,
              logger: deps.logger.child({ request_id: requestId }),
              identity,
            }),
          });
          // Cast required: Node.js StreamableHTTPServerTransport exposes
          // `onclose` as a getter returning `(() => void) | undefined`, which
          // conflicts with Transport's `onclose?: () => void` under
          // exactOptionalPropertyTypes. The runtime behaviour is identical.
          await server.connect(transport as Parameters<typeof server.connect>[0]);
          session = newSession;
        }

        deps.logger.info(
          { request_id: requestId, client_id: req.auth?.clientId },
          "mcp oauth http request",
        );
        await session.transport.handleRequest(req, res, req.body);
      } catch (error) {
        next(error);
      }
    },
  );

  return app;
}

async function defaultDeps(): Promise<OAuthHttpAppDeps> {
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
  const app = buildOAuthHttpApp(deps);
  const port = Number(process.env.PORT ?? 8080);
  createServer(app).listen(port, () => {
    deps.logger.info({ port, tools: allTools().length }, "mcp-wave oauth http ready");
  });
}
