import { describe, expect, it, vi } from "vitest";
import { ToolError } from "../../../../src/lib/errors.js";
import type { ToolContext } from "../../../../src/server/tool-context.js";
import {
  analyzeTransactionsCsvTool,
  parseCsv,
} from "../../../../src/tools/transactions/analyze-transactions-csv.js";

interface AccountStub {
  id: string;
  name: string;
}

function makeCtx(accounts: AccountStub[] = []): {
  ctx: ToolContext;
  listAccounts: ReturnType<typeof vi.fn>;
} {
  const listAccounts = vi.fn().mockResolvedValue({
    business: {
      accounts: {
        edges: accounts.map((a) => ({
          node: {
            id: a.id,
            name: a.name,
            type: { value: "EXPENSE", normalBalanceType: "DEBIT" },
            subtype: { value: "OPERATING_EXPENSE" },
            currency: { code: "CAD" },
          },
        })),
      },
    },
  });
  const ctx: ToolContext = {
    req: { headers: null, request_id: "req_test" },
    wave: { listAccounts } as never,
    taxRates: {} as never,
    accountMapping: {} as never,
    env: {} as never,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never,
    identity: "mock",
  };
  return { ctx, listAccounts };
}

describe("parseCsv", () => {
  it("parses simple comma-separated rows", () => {
    expect(parseCsv("a,b,c\n1,2,3\n")).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
    ]);
  });

  it("handles quoted fields with embedded commas and quotes", () => {
    const csv = 'name,memo\n"Doe, John","He said ""hi"""\n';
    expect(parseCsv(csv)).toEqual([
      ["name", "memo"],
      ["Doe, John", 'He said "hi"'],
    ]);
  });

  it("handles CRLF line endings and BOM", () => {
    const csv = "﻿a,b\r\n1,2\r\n3,4\r\n";
    expect(parseCsv(csv)).toEqual([
      ["a", "b"],
      ["1", "2"],
      ["3", "4"],
    ]);
  });
});

describe("analyze_transactions_csv tool", () => {
  it("parses a standard 6-column Wave export and proposes categories", async () => {
    const csv = [
      "Account,Date,Description,Amount,Category,Notes",
      'Chequing,2026-04-12,"PETRO-CANADA #123",-45.20,,',
      'Chequing,2026-04-13,"IGA EXTRA MTL",-78.50,,',
      'Chequing,2026-04-14,"Some unknown vendor xyz",-12.00,,',
    ].join("\n");

    const result = (await analyzeTransactionsCsvTool.handler(
      { csv, businessId: "biz_1" },
      makeCtx().ctx,
    )) as {
      proposals: Array<{
        rowIndex: number;
        amount: number;
        description: string;
        proposedCategoryAccount: string | null;
        confidence: string;
      }>;
      summary: { total: number; withSuggestion: number; withoutSuggestion: number };
    };

    expect(result.summary).toEqual({ total: 3, withSuggestion: 2, withoutSuggestion: 1 });
    expect(result.proposals[0]).toMatchObject({
      amount: -45.2,
      description: "PETRO-CANADA #123",
      proposedCategoryAccount: "6400_FUEL_VEHICLE",
      confidence: "high",
    });
    expect(result.proposals[1]).toMatchObject({
      proposedCategoryAccount: "6300_GROCERIES",
      confidence: "high",
    });
    expect(result.proposals[2]).toMatchObject({
      proposedCategoryAccount: null,
      confidence: "none",
    });
  });

  it("handles withdrawal/deposit split columns", async () => {
    const csv = [
      "Date,Description,Withdrawal,Deposit",
      "2026-04-12,Stripe payout,,250.00",
      "2026-04-13,AWS,32.45,",
    ].join("\n");

    const result = (await analyzeTransactionsCsvTool.handler(
      { csv, businessId: "biz_1", defaultAnchorAccountId: "acct_main" },
      makeCtx().ctx,
    )) as { proposals: Array<{ amount: number; proposedCategoryAccount: string | null }> };

    expect(result.proposals[0]?.amount).toBe(250);
    expect(result.proposals[1]?.amount).toBe(-32.45);
    expect(result.proposals[1]?.proposedCategoryAccount).toBe("6810_SAAS_HOSTING");
  });

  it("tolerates header case variants and alternative names", async () => {
    const csv = [
      "BANK ACCOUNT,Transaction Date,Memo,Net Amount,Posted To",
      'Visa,2026-04-12,"GITHUB.COM/SUB",-4.00,',
    ].join("\n");

    const result = (await analyzeTransactionsCsvTool.handler(
      { csv, businessId: "biz_1" },
      makeCtx().ctx,
    )) as { proposals: Array<{ proposedCategoryAccount: string | null; anchorAccount: string }> };

    expect(result.proposals[0]).toMatchObject({
      proposedCategoryAccount: "6810_SAAS_HOSTING",
      anchorAccount: "Visa",
    });
  });

  it("uses existing category from CSV as a high-confidence proposal", async () => {
    const csv = [
      "Date,Description,Amount,Category",
      "2026-04-12,Random vendor,-50.00,Office Supplies",
    ].join("\n");

    const result = (await analyzeTransactionsCsvTool.handler(
      { csv, businessId: "biz_1" },
      makeCtx().ctx,
    )) as { proposals: Array<{ proposedCategoryAccount: string | null; confidence: string }> };

    expect(result.proposals[0]).toMatchObject({
      proposedCategoryAccount: "Office Supplies",
      confidence: "high",
    });
  });

  it("returns 'none' confidence with reasoning for unknown descriptions", async () => {
    const csv = ["Date,Description,Amount", "2026-04-12,Mystery vendor zzz,-12.00"].join("\n");

    const result = (await analyzeTransactionsCsvTool.handler(
      { csv, businessId: "biz_1" },
      makeCtx().ctx,
    )) as { proposals: Array<{ confidence: string; reasoning: string }> };

    expect(result.proposals[0]?.confidence).toBe("none");
    expect(result.proposals[0]?.reasoning).toMatch(/no pattern matched/i);
  });

  it("throws when the CSV is missing an amount column", async () => {
    const csv = "Date,Description\n2026-04-12,Anything\n";
    const err = (await analyzeTransactionsCsvTool
      .handler({ csv, businessId: "biz_1" }, makeCtx().ctx)
      .catch((e) => e)) as ToolError;
    expect(err).toBeInstanceOf(ToolError);
    expect(err.code).toBe("CSV_MISSING_AMOUNT_COLUMN");
  });

  it("throws when the CSV has only a header row", async () => {
    const csv = "Date,Description,Amount\n";
    const err = (await analyzeTransactionsCsvTool
      .handler({ csv, businessId: "biz_1" }, makeCtx().ctx)
      .catch((e) => e)) as ToolError;
    expect(err).toBeInstanceOf(ToolError);
    expect(err.code).toBe("CSV_NO_ROWS");
  });

  it("resolves proposedWaveAccountId when seed waveAccountName matches a Wave account", async () => {
    const csv = ["Date,Description,Amount", "2026-04-12,PETRO-CANADA #123,-45.20"].join("\n");
    const { ctx } = makeCtx([
      { id: "acct_fuel_id", name: "Vehicle Expense - Fuel" },
      { id: "acct_other", name: "Office Supplies" },
    ]);

    const result = (await analyzeTransactionsCsvTool.handler(
      { csv, businessId: "biz_1" },
      ctx,
    )) as {
      proposals: Array<{
        proposedCategoryAccount: string | null;
        proposedWaveAccountId: string | null;
        reasoning: string;
      }>;
    };

    expect(result.proposals[0]).toMatchObject({
      proposedCategoryAccount: "6400_FUEL_VEHICLE",
      proposedWaveAccountId: "acct_fuel_id",
    });
    expect(result.proposals[0]?.reasoning).toMatch(/acct_fuel_id/);
  });

  it("returns null proposedWaveAccountId and explains the miss when no Wave account matches", async () => {
    const csv = ["Date,Description,Amount", "2026-04-12,PETRO-CANADA #123,-45.20"].join("\n");
    const { ctx } = makeCtx([{ id: "acct_other", name: "Office Supplies" }]);

    const result = (await analyzeTransactionsCsvTool.handler(
      { csv, businessId: "biz_1" },
      ctx,
    )) as {
      proposals: Array<{
        proposedCategoryAccount: string | null;
        proposedWaveAccountId: string | null;
        reasoning: string;
      }>;
    };

    expect(result.proposals[0]).toMatchObject({
      proposedCategoryAccount: "6400_FUEL_VEHICLE",
      proposedWaveAccountId: null,
    });
    expect(result.proposals[0]?.reasoning).toMatch(/did not match/i);
  });

  it("returns null proposedWaveAccountId without blaming Wave when seed lacks waveAccountName", async () => {
    // The 7000_PAYROLL seed entry intentionally has no waveAccountName.
    // Confirm null id, and the reasoning mentions the missing seed field
    // rather than claiming Wave is short an account.
    const csv = ["Date,Description,Amount", "2026-04-15,Wagepoint payroll run,-1200.00"].join("\n");
    const { ctx } = makeCtx([{ id: "acct_anything", name: "Anything" }]);

    const result = (await analyzeTransactionsCsvTool.handler(
      { csv, businessId: "biz_1" },
      ctx,
    )) as {
      proposals: Array<{
        proposedCategoryAccount: string | null;
        proposedWaveAccountId: string | null;
        reasoning: string;
      }>;
    };

    expect(result.proposals[0]).toMatchObject({
      proposedCategoryAccount: "7000_PAYROLL",
      proposedWaveAccountId: null,
    });
    // Reasoning should point at the seed (missing waveAccountName) rather
    // than blaming Wave's account list.
    expect(result.proposals[0]?.reasoning).toMatch(/seed/i);
    expect(result.proposals[0]?.reasoning).toMatch(/waveAccountName/);
    expect(result.proposals[0]?.reasoning).not.toMatch(/did not match any Wave account/i);
  });

  it("fetches Wave accounts ONCE regardless of row count", async () => {
    const csv = [
      "Date,Description,Amount",
      "2026-04-12,PETRO-CANADA #1,-10.00",
      "2026-04-13,IGA EXTRA,-20.00",
      "2026-04-14,AWS,-30.00",
      "2026-04-15,Tim Hortons,-5.00",
      "2026-04-16,Bell Canada,-50.00",
    ].join("\n");
    const { ctx, listAccounts } = makeCtx([
      { id: "acct_fuel", name: "Vehicle Expense - Fuel" },
      { id: "acct_groc", name: "Groceries" },
    ]);

    await analyzeTransactionsCsvTool.handler({ csv, businessId: "biz_1" }, ctx);

    expect(listAccounts).toHaveBeenCalledTimes(1);
  });
});
