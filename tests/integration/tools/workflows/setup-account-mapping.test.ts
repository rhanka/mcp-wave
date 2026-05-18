import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { graphql, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { parse as parseYaml } from "yaml";
import { AccountMappingLoader } from "../../../../src/domain/tax/account-mapping-loader.js";
import { TaxRatesLoader } from "../../../../src/domain/tax/rates-loader.js";
import type { ToolContext } from "../../../../src/server/tool-context.js";
import { setupAccountMappingTool } from "../../../../src/tools/workflows/setup-account-mapping.js";
import { MockProvider } from "../../../../src/wave/auth/mock.js";
import { WaveClient } from "../../../../src/wave/client.js";

const ENDPOINT = "https://gql.waveapps.com/graphql/public";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const RATES = `
jurisdiction: CA-QC
year: 2026
effective_from: 2026-01-01
effective_to: 2026-12-31
remittance_authorities:
  - { code: CRA, name: "Receiver General", level: federal }
  - { code: RQ, name: "Revenu Québec", level: regional }
payroll_taxes: []
sales_taxes: []
`;

function makeCtx(): ToolContext {
  const ratesDir = mkdtempSync(join(tmpdir(), "mcp-wave-rates-"));
  writeFileSync(join(ratesDir, "ca-qc-2026.yaml"), RATES);

  return {
    req: { headers: null, request_id: "test" },
    wave: new WaveClient({ endpoint: ENDPOINT, provider: new MockProvider("x") }),
    taxRates: new TaxRatesLoader(ratesDir),
    accountMapping: new AccountMappingLoader(ratesDir),
    env: { WAVE_DEFAULT_BUSINESS_ID: "biz_x" } as never,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never,
    identity: "mock",
  };
}

describe("setup_account_mapping", () => {
  it("returns suggested account-mapping YAML without writing files", async () => {
    let receivedVariables: { businessId?: string; types?: string[] } | null = null;

    server.use(
      graphql.query("ListAccounts", ({ variables }) => {
        receivedVariables = variables as { businessId?: string; types?: string[] };
        return HttpResponse.json({
          data: {
            business: {
              accounts: {
                edges: [
                  {
                    node: {
                      id: "acct_fed",
                      name: "Receiver General payable",
                      type: { value: "LIABILITY", normalBalanceType: "CREDIT" },
                      subtype: { value: "OTHER_CURRENT_LIABILITY" },
                      currency: { code: "CAD" },
                    },
                  },
                  {
                    node: {
                      id: "acct_qc",
                      name: "Revenu Quebec payable",
                      type: { value: "LIABILITY", normalBalanceType: "CREDIT" },
                      subtype: { value: "OTHER_CURRENT_LIABILITY" },
                      currency: { code: "CAD" },
                    },
                  },
                ],
              },
            },
          },
        });
      }),
    );

    const result = (await setupAccountMappingTool.handler(
      { jurisdiction: "CA-QC", year: 2026 },
      makeCtx(),
    )) as {
      jurisdiction: string;
      yaml: string;
      suggestions: Array<{ authority_code: string }>;
    };

    expect(receivedVariables).toEqual({ businessId: "biz_x", types: ["LIABILITY"] });
    expect(result.jurisdiction).toBe("CA-QC");
    expect(result.suggestions.map((s) => s.authority_code)).toEqual(["CRA", "RQ"]);
    expect(result.yaml.startsWith("# data/account-mapping/default.yaml\n")).toBe(true);
    expect(parseYaml(result.yaml.replace(/^#.*\n/, ""))).toEqual({
      business_id_env: "WAVE_DEFAULT_BUSINESS_ID",
      jurisdiction: "CA-QC",
      remittance_buckets: {
        CRA: { payable_account_id: "acct_fed" },
        RQ: { payable_account_id: "acct_qc" },
      },
    });
  });
});
