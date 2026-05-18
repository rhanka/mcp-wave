import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { serve } from "@hono/node-server";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { GraphQLClient } from "graphql-request";
import { Hono } from "hono";
import { type AppEnv, parseEnv } from "../config/env.js";
import { createLogger } from "../config/logger.js";
import { AccountMappingLoader } from "../domain/tax/account-mapping-loader.js";
import { TaxRatesLoader } from "../domain/tax/rates-loader.js";
import { ToolError } from "../lib/errors.js";
import { originAllowlist } from "../server/http/origin-allowlist.js";
import { rateLimit } from "../server/http/rate-limit.js";
import { buildMcpServer } from "../server/mcp-server.js";
import { allTools } from "../server/tool-registry.js";
import type { WaveCredentialProvider } from "../wave/auth/provider.js";
import { selectProvider } from "../wave/auth/select.js";
import { WaveClient } from "../wave/client.js";

interface HttpAppDeps {
  env: AppEnv;
  logger: ReturnType<typeof createLogger>;
  provider: WaveCredentialProvider;
  wave: WaveClient;
  taxRates: TaxRatesLoader;
  accountMapping: AccountMappingLoader;
}

interface HttpSession {
  transport: WebStandardStreamableHTTPServerTransport;
}

function jsonRpcAuthError(error: ToolError): Response {
  return Response.json(
    {
      jsonrpc: "2.0",
      error: {
        code: -32001,
        message: error.code,
        data: error.toJSON(),
      },
      id: null,
    },
    { status: 401 },
  );
}

export function buildHttpApp(deps: HttpAppDeps): Hono {
  const app = new Hono();
  const allowedOrigins = deps.env.ALLOWED_ORIGINS.split(",").map((origin) => origin.trim());
  const sessions = new Map<string, HttpSession>();

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

  app.all("/mcp", async (c) => {
    const requestId = randomUUID();
    const reqCtx = { headers: c.req.raw.headers, request_id: requestId };
    let identity: string;
    try {
      identity = await deps.provider.getIdentity(reqCtx);
    } catch (error) {
      if (error instanceof ToolError) {
        return jsonRpcAuthError(error);
      }
      throw error;
    }

    const requestedSessionId = c.req.header("mcp-session-id");
    let session = requestedSessionId !== undefined ? sessions.get(requestedSessionId) : undefined;

    if (session === undefined) {
      let newSession: HttpSession | undefined;
      const transport = new WebStandardStreamableHTTPServerTransport({
        enableJsonResponse: true,
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sessionId) => {
          if (newSession !== undefined) {
            sessions.set(sessionId, newSession);
          }
        },
        onsessionclosed: (sessionId) => {
          sessions.delete(sessionId);
        },
      });
      newSession = { transport };
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
      await server.connect(transport);
      session = newSession;
    }

    deps.logger.info({ request_id: requestId, identity }, "mcp http request");
    return session.transport.handleRequest(c.req.raw);
  });

  return app;
}

function defaultDeps(): HttpAppDeps {
  const env = parseEnv(process.env);
  const logger = createLogger({ level: env.LOG_LEVEL, logPII: env.LOG_PII });
  const provider = selectProvider(env);
  return {
    env,
    logger,
    provider,
    wave: new WaveClient({ endpoint: env.WAVE_GRAPHQL_ENDPOINT, provider }),
    taxRates: new TaxRatesLoader(resolve("data/tax-rates")),
    accountMapping: new AccountMappingLoader(resolve("data/account-mapping")),
  };
}

const deps = defaultDeps();
const app = buildHttpApp(deps);

if (process.env.NODE_ENV !== "test") {
  const port = Number(process.env.PORT ?? 8080);
  serve({ fetch: app.fetch, port }, () => {
    deps.logger.info({ port, tools: allTools().length }, "mcp-wave http ready");
  });
}

export { app };
