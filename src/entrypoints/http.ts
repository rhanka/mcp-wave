import { resolve } from "node:path";
import { serve } from "@hono/node-server";
import { GraphQLClient } from "graphql-request";
import { Hono } from "hono";
import { parseEnv } from "../config/env.js";
import { createLogger } from "../config/logger.js";
import { TaxRatesLoader } from "../domain/tax/rates-loader.js";

const env = parseEnv(process.env);
const logger = createLogger({ level: env.LOG_LEVEL, logPII: env.LOG_PII });
const taxRates = new TaxRatesLoader(resolve("data/tax-rates"));

const app = new Hono();

app.get("/healthz", (c) => c.json({ ok: true }));

app.get("/readyz", async (c) => {
  const issues: string[] = [];
  try {
    await taxRates.load("CA-QC", new Date().getUTCFullYear());
  } catch (e) {
    issues.push(`tax-rates: ${e instanceof Error ? e.message : String(e)}`);
  }
  try {
    const gql = new GraphQLClient(env.WAVE_GRAPHQL_ENDPOINT);
    await gql.request("{ __typename }");
  } catch (e) {
    issues.push(`wave-schema: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (issues.length > 0) return c.json({ ok: false, issues }, 503);
  return c.json({ ok: true });
});

if (process.env.NODE_ENV !== "test") {
  const port = Number(process.env.PORT ?? 8080);
  serve({ fetch: app.fetch, port }, () => {
    logger.info({ port }, "mcp-wave http ready (healthz only — MCP HTTP in Part B)");
  });
}

export { app };
