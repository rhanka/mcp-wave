import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { graphql, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { AccountMappingLoader } from "../../../../src/domain/tax/account-mapping-loader.js";
import { TaxRatesLoader } from "../../../../src/domain/tax/rates-loader.js";
import type { ToolContext } from "../../../../src/server/tool-context.js";
import { splitPayrollRemittanceTool } from "../../../../src/tools/workflows/split-payroll-remittance.js";
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

const MAPPING = `
business_id_env: WAVE_DEFAULT_BUSINESS_ID
jurisdiction: CA-QC
remittance_buckets:
  CRA: { payable_account_id: "acct_fed" }
  RQ: { payable_account_id: "acct_qc" }
`;

function makeCtx(): ToolContext {
  const ratesDir = mkdtempSync(join(tmpdir(), "mcp-wave-rates-"));
  writeFileSync(join(ratesDir, "ca-qc-2026.yaml"), RATES);
  const mappingDir = mkdtempSync(join(tmpdir(), "mcp-wave-mapping-"));
  writeFileSync(join(mappingDir, "default.yaml"), MAPPING);

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

describe("split_payroll_remittance", () => {
  it("creates one multi-line withdrawal transaction for remittance buckets", async () => {
    let moneyTransactionCreateInput: Record<string, unknown> | null = null;

    server.use(
      graphql.query("GetBusinessAccountingSettings", () =>
        HttpResponse.json({
          data: { business: { id: "biz_x", isClassicAccounting: false } },
        }),
      ),
      graphql.mutation("MoneyTransactionCreate", ({ variables }) => {
        moneyTransactionCreateInput = (variables as { input: Record<string, unknown> }).input;
        return HttpResponse.json({
          data: {
            moneyTransactionCreate: {
              didSucceed: true,
              inputErrors: [],
              transaction: { id: "txn_new" },
            },
          },
        });
      }),
    );

    const result = (await splitPayrollRemittanceTool.handler(
      {
        date: "2026-11-15",
        bank_account_id: "acct_bank",
        description: "November 2026 payroll remittance",
        jurisdiction: "CA-QC",
        period_year: 2026,
        total_amount: 4820,
        buckets: { CRA: { amount: 3200 }, RQ: { amount: 1620 } },
        memo_prefix: "Nov 2026 DAS",
        external_id: "payroll-provider-2026-11-15",
      },
      makeCtx(),
    )) as {
      transaction_id: string;
      total_amount: number;
      line_items: Array<{ authority_code: string; amount: number; account_id: string }>;
    };

    expect(result).toEqual({
      transaction_id: "txn_new",
      total_amount: 4820,
      line_items: [
        { authority_code: "CRA", amount: 3200, account_id: "acct_fed" },
        { authority_code: "RQ", amount: 1620, account_id: "acct_qc" },
      ],
    });

    const capturedInput = moneyTransactionCreateInput as Record<string, unknown> | null;
    if (capturedInput === null) {
      throw new Error("Expected MoneyTransactionCreate variables to be captured");
    }

    expect(capturedInput).toMatchObject({
      businessId: "biz_x",
      date: "2026-11-15",
      description: "November 2026 payroll remittance",
      externalId: "payroll-provider-2026-11-15",
      anchor: {
        accountId: "acct_bank",
        amount: "4820",
        direction: "WITHDRAWAL",
      },
      lineItems: [
        {
          accountId: "acct_fed",
          amount: "3200",
          balance: "INCREASE",
          description: "Nov 2026 DAS — Receiver General",
        },
        {
          accountId: "acct_qc",
          amount: "1620",
          balance: "INCREASE",
          description: "Nov 2026 DAS — Revenu Québec",
        },
      ],
    });
  });

  it("rejects when bucket amounts do not match total_amount within tolerance", async () => {
    server.use(
      graphql.query("GetBusinessAccountingSettings", () =>
        HttpResponse.json({
          data: { business: { id: "biz_x", isClassicAccounting: false } },
        }),
      ),
    );

    await expect(
      splitPayrollRemittanceTool.handler(
        {
          date: "2026-11-15",
          bank_account_id: "acct_bank",
          description: "November 2026 payroll remittance",
          jurisdiction: "CA-QC",
          period_year: 2026,
          total_amount: 4820,
          buckets: { CRA: { amount: 3000 }, RQ: { amount: 1620 } },
        },
        makeCtx(),
      ),
    ).rejects.toMatchObject({
      code: "SPLIT_SUM_MISMATCH",
    });
  });

  it("rejects classic-accounting businesses because moneyTransactionCreate is unsupported", async () => {
    server.use(
      graphql.query("GetBusinessAccountingSettings", () =>
        HttpResponse.json({
          data: { business: { id: "biz_x", isClassicAccounting: true } },
        }),
      ),
    );

    await expect(
      splitPayrollRemittanceTool.handler(
        {
          date: "2026-11-15",
          bank_account_id: "acct_bank",
          description: "November 2026 payroll remittance",
          jurisdiction: "CA-QC",
          period_year: 2026,
          total_amount: 4820,
          buckets: { CRA: { amount: 3200 }, RQ: { amount: 1620 } },
        },
        makeCtx(),
      ),
    ).rejects.toMatchObject({
      code: "CLASSIC_ACCOUNTING_NOT_SUPPORTED",
    });
  });
});
