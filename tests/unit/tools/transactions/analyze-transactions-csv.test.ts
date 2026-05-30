import { describe, expect, it, vi } from "vitest";
import { ToolError } from "../../../../src/lib/errors.js";
import type { ToolContext } from "../../../../src/server/tool-context.js";
import {
  analyzeTransactionsCsvTool,
  parseCsv,
} from "../../../../src/tools/transactions/analyze-transactions-csv.js";

function makeCtx(): ToolContext {
  return {
    req: { headers: null, request_id: "req_test" },
    wave: {} as never,
    taxRates: {} as never,
    accountMapping: {} as never,
    env: {} as never,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never,
    identity: "mock",
  };
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
      makeCtx(),
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
      makeCtx(),
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
      makeCtx(),
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
      makeCtx(),
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
      makeCtx(),
    )) as { proposals: Array<{ confidence: string; reasoning: string }> };

    expect(result.proposals[0]?.confidence).toBe("none");
    expect(result.proposals[0]?.reasoning).toMatch(/no pattern matched/i);
  });

  it("throws when the CSV is missing an amount column", async () => {
    const csv = "Date,Description\n2026-04-12,Anything\n";
    const err = (await analyzeTransactionsCsvTool
      .handler({ csv, businessId: "biz_1" }, makeCtx())
      .catch((e) => e)) as ToolError;
    expect(err).toBeInstanceOf(ToolError);
    expect(err.code).toBe("CSV_MISSING_AMOUNT_COLUMN");
  });

  it("throws when the CSV has only a header row", async () => {
    const csv = "Date,Description,Amount\n";
    const err = (await analyzeTransactionsCsvTool
      .handler({ csv, businessId: "biz_1" }, makeCtx())
      .catch((e) => e)) as ToolError;
    expect(err).toBeInstanceOf(ToolError);
    expect(err.code).toBe("CSV_NO_ROWS");
  });
});
