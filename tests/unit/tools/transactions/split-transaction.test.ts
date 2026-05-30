import { describe, expect, it, vi } from "vitest";
import { ToolError, WaveApiError } from "../../../../src/lib/errors.js";
import type { ToolContext } from "../../../../src/server/tool-context.js";
import { splitTransactionTool } from "../../../../src/tools/transactions/split-transaction.js";

function makeCtx(moneyTransactionCreate: ReturnType<typeof vi.fn>): ToolContext {
  return {
    req: { headers: null, request_id: "req_test" },
    wave: { moneyTransactionCreate } as never,
    taxRates: {} as never,
    accountMapping: {} as never,
    env: {} as never,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never,
    identity: "mock",
  };
}

const VALID_ANCHOR = {
  date: "2026-04-15",
  anchorAccountId: "acct_bank",
  totalAmount: -100,
  description: "Mixed grocery + fuel run",
  businessId: "biz_1",
};

describe("split_transaction tool", () => {
  it("happy path (no tax): splits amount across lines, maps to Wave WITHDRAWAL", async () => {
    const moneyTransactionCreate = vi.fn().mockResolvedValue({
      moneyTransactionCreate: {
        didSucceed: true,
        inputErrors: [],
        transaction: { id: "txn_42" },
      },
    });
    const ctx = makeCtx(moneyTransactionCreate);

    const result = (await splitTransactionTool.handler(
      {
        anchor: VALID_ANCHOR,
        lines: [
          { accountId: "acct_groc", amount: 70, description: "Groceries" },
          { accountId: "acct_fuel", amount: 30, description: "Fuel" },
        ],
        externalId: "ext-1",
      },
      ctx,
    )) as Record<string, unknown>;

    expect(result).toMatchObject({
      transactionId: "txn_42",
      status: "CREATED",
      direction: "WITHDRAWAL",
      totalAmount: -100,
      lineCount: 2,
    });

    expect(moneyTransactionCreate).toHaveBeenCalledTimes(1);
    const [, vars] = moneyTransactionCreate.mock.calls[0] as [
      unknown,
      { input: Record<string, unknown> },
    ];
    expect(vars.input).toMatchObject({
      businessId: "biz_1",
      date: "2026-04-15",
      description: "Mixed grocery + fuel run",
      externalId: "ext-1",
      anchor: { accountId: "acct_bank", amount: "100", direction: "WITHDRAWAL" },
      lineItems: [
        { accountId: "acct_groc", amount: "70", balance: "INCREASE", description: "Groceries" },
        { accountId: "acct_fuel", amount: "30", balance: "INCREASE", description: "Fuel" },
      ],
    });
  });

  it("positive totalAmount drives direction=DEPOSIT", async () => {
    const moneyTransactionCreate = vi.fn().mockResolvedValue({
      moneyTransactionCreate: {
        didSucceed: true,
        inputErrors: [],
        transaction: { id: "txn_dep" },
      },
    });
    const ctx = makeCtx(moneyTransactionCreate);

    const result = (await splitTransactionTool.handler(
      {
        anchor: { ...VALID_ANCHOR, totalAmount: 250, description: "Client deposit + interest" },
        lines: [
          { accountId: "acct_sales", amount: 245 },
          { accountId: "acct_interest", amount: 5 },
        ],
      },
      ctx,
    )) as Record<string, unknown>;

    expect(result).toMatchObject({ direction: "DEPOSIT", totalAmount: 250 });
    const [, vars] = moneyTransactionCreate.mock.calls[0] as [
      unknown,
      { input: { anchor: { direction: string; amount: string } } },
    ];
    expect(vars.input.anchor.direction).toBe("DEPOSIT");
    expect(vars.input.anchor.amount).toBe("250");
  });

  it("rejects sum mismatch when no line has salesTaxes", async () => {
    const moneyTransactionCreate = vi.fn();
    const ctx = makeCtx(moneyTransactionCreate);

    const err = (await splitTransactionTool
      .handler(
        {
          anchor: VALID_ANCHOR,
          lines: [
            { accountId: "acct_groc", amount: 70 },
            { accountId: "acct_fuel", amount: 25 }, // total 95 ≠ 100
          ],
        },
        ctx,
      )
      .catch((e) => e)) as ToolError;

    expect(err).toBeInstanceOf(ToolError);
    expect(err.code).toBe("SPLIT_SUM_MISMATCH");
    expect(err.details).toMatchObject({ provided_sum: 95, expected: 100 });
    expect(moneyTransactionCreate).not.toHaveBeenCalled();
  });

  it("skips the sum check when at least one line has salesTaxes (Wave arbitrates)", async () => {
    const moneyTransactionCreate = vi.fn().mockResolvedValue({
      moneyTransactionCreate: {
        didSucceed: true,
        inputErrors: [],
        transaction: { id: "txn_tax" },
      },
    });
    const ctx = makeCtx(moneyTransactionCreate);

    // lines sum to 90, totalAmount is 100, but a tax of 10 explains the gap.
    await splitTransactionTool.handler(
      {
        anchor: { ...VALID_ANCHOR, totalAmount: -100 },
        lines: [
          {
            accountId: "acct_expense",
            amount: 90,
            salesTaxes: [{ salesTaxId: "tax_tps_tvq", amount: 10 }],
          },
        ],
      },
      ctx,
    );

    expect(moneyTransactionCreate).toHaveBeenCalledTimes(1);
    const [, vars] = moneyTransactionCreate.mock.calls[0] as [
      unknown,
      { input: { lineItems: Array<{ taxes?: Array<Record<string, unknown>> }> } },
    ];
    expect(vars.input.lineItems[0]?.taxes).toEqual([{ salesTaxId: "tax_tps_tvq", amount: "10" }]);
  });

  it("throws SALES_TAX_AMOUNT_REQUIRED when a tax entry omits amount", async () => {
    const moneyTransactionCreate = vi.fn();
    const ctx = makeCtx(moneyTransactionCreate);

    const err = (await splitTransactionTool
      .handler(
        {
          anchor: { ...VALID_ANCHOR, totalAmount: -100 },
          lines: [
            {
              accountId: "acct_expense",
              amount: 90,
              salesTaxes: [{ salesTaxId: "tax_tps_tvq" }],
            },
          ],
        },
        ctx,
      )
      .catch((e) => e)) as ToolError;

    expect(err).toBeInstanceOf(ToolError);
    expect(err.code).toBe("SALES_TAX_AMOUNT_REQUIRED");
    expect(moneyTransactionCreate).not.toHaveBeenCalled();
  });

  it("bubbles Wave inputErrors as WaveApiError", async () => {
    const moneyTransactionCreate = vi.fn().mockResolvedValue({
      moneyTransactionCreate: {
        didSucceed: false,
        inputErrors: [{ code: "ACCOUNT_NOT_FOUND", message: "bad acct", path: ["lineItems", "0"] }],
        transaction: null,
      },
    });
    const ctx = makeCtx(moneyTransactionCreate);

    const err = (await splitTransactionTool
      .handler(
        {
          anchor: VALID_ANCHOR,
          lines: [{ accountId: "missing", amount: 100 }],
        },
        ctx,
      )
      .catch((e) => e)) as WaveApiError;

    expect(err).toBeInstanceOf(WaveApiError);
    expect(err.waveCode).toBe("VALIDATION_ERROR");
  });

  it("throws WAVE_NO_TRANSACTION when Wave returns success but no transaction", async () => {
    const moneyTransactionCreate = vi.fn().mockResolvedValue({
      moneyTransactionCreate: {
        didSucceed: true,
        inputErrors: [],
        transaction: null,
      },
    });
    const ctx = makeCtx(moneyTransactionCreate);

    const err = (await splitTransactionTool
      .handler(
        {
          anchor: VALID_ANCHOR,
          lines: [{ accountId: "acct_x", amount: 100 }],
        },
        ctx,
      )
      .catch((e) => e)) as ToolError;

    expect(err).toBeInstanceOf(ToolError);
    expect(err.code).toBe("WAVE_NO_TRANSACTION");
  });

  it("rejects totalAmount of 0 (direction would be ambiguous)", async () => {
    const moneyTransactionCreate = vi.fn();
    const ctx = makeCtx(moneyTransactionCreate);

    await expect(
      splitTransactionTool.handler(
        {
          anchor: { ...VALID_ANCHOR, totalAmount: 0 },
          lines: [{ accountId: "acct_x", amount: 0.01 }],
        },
        ctx,
      ),
    ).rejects.toThrow();
    expect(moneyTransactionCreate).not.toHaveBeenCalled();
  });
});
