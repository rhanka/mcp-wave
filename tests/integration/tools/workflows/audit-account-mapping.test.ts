import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { graphql, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { AccountMappingLoader } from "../../../../src/domain/tax/account-mapping-loader.js";
import { TaxRatesLoader } from "../../../../src/domain/tax/rates-loader.js";
import type { ToolContext } from "../../../../src/server/tool-context.js";
import { auditAccountMappingTool } from "../../../../src/tools/workflows/audit-account-mapping.js";
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
  - { code: CRA, name: "Receiver General of Canada", level: federal }
  - { code: RQ, name: "Revenu Québec", level: regional }
payroll_taxes: []
sales_taxes: []
`;

const PARTIAL_MAPPING = `
business_id_env: WAVE_DEFAULT_BUSINESS_ID
jurisdiction: CA-QC
remittance_buckets:
  CRA: { payable_account_id: "acct_fed" }
  RQ: { payable_account_id: "acct_missing" }
`;

function makeCtx(mappingYaml: string | null): ToolContext {
  const ratesDir = mkdtempSync(join(tmpdir(), "mcp-wave-rates-"));
  writeFileSync(join(ratesDir, "ca-qc-2026.yaml"), RATES);

  const mappingDir = mkdtempSync(join(tmpdir(), "mcp-wave-mapping-"));
  if (mappingYaml !== null) {
    writeFileSync(join(mappingDir, "default.yaml"), mappingYaml);
  }

  return {
    req: { headers: null, request_id: "test" },
    wave: new WaveClient({ endpoint: ENDPOINT, provider: new MockProvider("x") }),
    taxRates: new TaxRatesLoader(ratesDir),
    accountMapping: new AccountMappingLoader(mappingDir),
    env: { WAVE_DEFAULT_BUSINESS_ID: "biz_x" } as never,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never,
    identity: "mock",
  };
}

describe("audit_account_mapping", () => {
  it("reports mapped, broken, and unused accounts plus cash/bank choices", async () => {
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
                      id: "acct_desj",
                      name: "Desjardins Operating",
                      type: { value: "ASSET", normalBalanceType: "DEBIT" },
                      subtype: { value: "CASH_AND_BANK" },
                      currency: { code: "CAD" },
                    },
                  },
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
                  {
                    node: {
                      id: "acct_gst",
                      name: "GST/QST payable",
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

    const result = (await auditAccountMappingTool.handler(
      { jurisdiction: "CA-QC", year: 2026 },
      makeCtx(PARTIAL_MAPPING),
    )) as {
      mapping_file: { present: boolean; matches_requested_jurisdiction: boolean };
      remittance_authorities: Array<{
        code: string;
        status: string;
        configured_account_id: string | null;
        mapped_account: { id: string; name: string } | null;
        top_suggestions: Array<{ account_id: string }>;
      }>;
      cash_and_bank_accounts: Array<{ id: string; name: string }>;
      unused_liability_accounts: Array<{ id: string; name: string }>;
      summary: {
        mapped_authorities: number;
        unmapped_authorities: number;
        invalid_authorities: number;
      };
      recommended_next_actions: string[];
    };

    expect(receivedVariables).toEqual({ businessId: "biz_x" });
    expect(result.mapping_file).toEqual({
      present: true,
      jurisdiction: "CA-QC",
      matches_requested_jurisdiction: true,
    });
    expect(result.remittance_authorities).toMatchObject([
      {
        code: "CRA",
        status: "mapped",
        configured_account_id: "acct_fed",
        mapped_account: { id: "acct_fed", name: "Receiver General payable" },
      },
      {
        code: "RQ",
        status: "configured_account_missing",
        configured_account_id: "acct_missing",
        mapped_account: null,
      },
    ]);
    expect(result.remittance_authorities[1]?.top_suggestions[0]?.account_id).toBe("acct_qc");
    expect(result.cash_and_bank_accounts).toEqual([
      {
        id: "acct_desj",
        name: "Desjardins Operating",
        subtype: "CASH_AND_BANK",
        currency: "CAD",
      },
    ]);
    expect(result.unused_liability_accounts).toEqual([
      {
        id: "acct_qc",
        name: "Revenu Quebec payable",
        subtype: "OTHER_CURRENT_LIABILITY",
        currency: "CAD",
      },
      {
        id: "acct_gst",
        name: "GST/QST payable",
        subtype: "OTHER_CURRENT_LIABILITY",
        currency: "CAD",
      },
    ]);
    expect(result.summary).toEqual({
      mapped_authorities: 1,
      unmapped_authorities: 0,
      invalid_authorities: 1,
      cash_and_bank_accounts: 1,
      unused_liability_accounts: 2,
    });
    expect(result.recommended_next_actions).toContain(
      "Fix remittance_buckets.RQ.payable_account_id: account 'acct_missing' was not found in Wave.",
    );
  });

  it("continues when the mapping file is missing and marks every authority unmapped", async () => {
    server.use(
      graphql.query("ListAccounts", () =>
        HttpResponse.json({
          data: {
            business: {
              accounts: {
                edges: [
                  {
                    node: {
                      id: "acct_desj",
                      name: "Desjardins Operating",
                      type: { value: "ASSET", normalBalanceType: "DEBIT" },
                      subtype: { value: "CASH_AND_BANK" },
                      currency: { code: "CAD" },
                    },
                  },
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
        }),
      ),
    );

    const result = (await auditAccountMappingTool.handler(
      { jurisdiction: "CA-QC", year: 2026 },
      makeCtx(null),
    )) as {
      mapping_file: { present: boolean; error_code?: string };
      remittance_authorities: Array<{ code: string; status: string }>;
      summary: {
        mapped_authorities: number;
        unmapped_authorities: number;
        invalid_authorities: number;
      };
      recommended_next_actions: string[];
    };

    expect(result.mapping_file).toMatchObject({
      present: false,
      error_code: "ACCOUNT_MAPPING_MISSING",
    });
    expect(result.remittance_authorities).toMatchObject([
      { code: "CRA", status: "unmapped" },
      { code: "RQ", status: "unmapped" },
    ]);
    expect(result.summary).toEqual({
      mapped_authorities: 0,
      unmapped_authorities: 2,
      invalid_authorities: 0,
      cash_and_bank_accounts: 1,
      unused_liability_accounts: 2,
    });
    expect(result.recommended_next_actions).toContain(
      "Create data/account-mapping/default.yaml from setup_account_mapping output.",
    );
    expect(result.recommended_next_actions).toContain(
      "Map remittance_buckets.CRA.payable_account_id to a liability account.",
    );
  });
});
