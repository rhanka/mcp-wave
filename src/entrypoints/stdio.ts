import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { parseEnv } from "../config/env.js";
import { createLogger } from "../config/logger.js";
import { AccountMappingLoader } from "../domain/tax/account-mapping-loader.js";
import { TaxRatesLoader } from "../domain/tax/rates-loader.js";
import { buildMcpServer } from "../server/mcp-server.js";
import { allTools } from "../server/tool-registry.js";
import { selectProvider } from "../wave/auth/select.js";
import { WaveClient } from "../wave/client.js";

async function main(): Promise<void> {
  const env = parseEnv(process.env);
  const logger = createLogger({ level: env.LOG_LEVEL, logPII: env.LOG_PII });
  const provider = selectProvider(env);
  const wave = new WaveClient({ endpoint: env.WAVE_GRAPHQL_ENDPOINT, provider });
  const taxRates = new TaxRatesLoader(resolve("data/tax-rates"));
  const accountMapping = new AccountMappingLoader(resolve("data/account-mapping"));

  const tools = allTools();
  const { server } = buildMcpServer({
    tools,
    makeCtx: () => ({
      req: { headers: null, request_id: randomUUID() },
      wave,
      taxRates,
      accountMapping,
      env,
      logger,
      identity: "stdio",
    }),
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info({ tools: tools.length }, "mcp-wave stdio ready");
  process.stderr.write("[mcp-wave] ready\n");
}

main().catch((e) => {
  console.error("[mcp-wave] fatal:", e);
  process.exit(1);
});
