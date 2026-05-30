import { randomUUID } from "node:crypto";
import { z } from "zod";
import { ToolError } from "../../lib/errors.js";
import { defineTool } from "../../server/define-tool.js";
import { throwIfInputErrors } from "../../wave/payload-errors.js";

const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");

const SalesTaxInputSchema = z.object({
  salesTaxId: z.string().min(1),
  amount: z.number().nonnegative().optional(),
});

const LineSchema = z.object({
  accountId: z.string().min(1),
  amount: z.number().positive(),
  description: z.string().optional(),
  salesTaxes: z.array(SalesTaxInputSchema).optional(),
});

const AnchorSchema = z.object({
  date: isoDateSchema,
  anchorAccountId: z.string().min(1),
  totalAmount: z
    .number()
    .refine((v) => v !== 0, { message: "totalAmount must be non-zero (sign drives direction)" }),
  description: z.string().min(1),
  businessId: z.string().min(1),
});

export const splitTransactionTool = defineTool({
  name: "split_transaction",
  description:
    "Create a Wave money transaction (multi-line) anchored on a bank account, splitting the amount across N arbitrary account lines, with optional per-line sales taxes. Use this to record expense splits, mixed-category deposits, payroll remittances and other reconciliations. The anchor.totalAmount sign drives direction: negative=WITHDRAWAL (money out), positive=DEPOSIT (money in). When no line carries salesTaxes, the sum of lines[].amount MUST equal |anchor.totalAmount|.",
  inputSchema: z.object({
    anchor: AnchorSchema,
    lines: z.array(LineSchema).min(1),
    externalId: z.string().min(1).optional(),
    notes: z.string().optional(),
  }),
  async execute(input, ctx) {
    const { anchor, lines } = input;
    const direction = anchor.totalAmount < 0 ? "WITHDRAWAL" : "DEPOSIT";
    const absTotal = Math.abs(anchor.totalAmount);

    const anyTax = lines.some((l) => l.salesTaxes !== undefined && l.salesTaxes.length > 0);
    if (!anyTax) {
      const sum = lines.reduce((acc, l) => acc + l.amount, 0);
      // Penny rounding: 0.01 tolerance.
      if (Math.abs(sum - absTotal) > 0.01) {
        throw new ToolError(
          "SPLIT_SUM_MISMATCH",
          {
            provided_sum: Number(sum.toFixed(2)),
            expected: absTotal,
            delta: Number((sum - absTotal).toFixed(4)),
          },
          "Without per-line salesTaxes, sum(lines[].amount) must equal |anchor.totalAmount| within $0.01.",
        );
      }
    }

    const lineItems = lines.map((line) => {
      const item: Record<string, unknown> = {
        accountId: line.accountId,
        amount: String(line.amount),
        balance: "INCREASE",
      };
      if (line.description !== undefined) item.description = line.description;
      if (line.salesTaxes && line.salesTaxes.length > 0) {
        item.taxes = line.salesTaxes.map((tax) => ({
          salesTaxId: tax.salesTaxId,
          // Wave's MoneyTransactionCreateSalesTaxInput requires `amount`. If the caller
          // didn't override, omit it so Wave computes from the configured tax rate —
          // but the SDK type marks it required; we send "" only when omitted is invalid.
          // In practice Wave accepts an empty amount only when configured; we keep amount
          // mandatory at the API boundary. If omitted, surface a clear error to caller.
          amount: tax.amount === undefined ? requireTaxAmount(line.accountId) : String(tax.amount),
        }));
      }
      return item;
    });

    const createInput = {
      businessId: anchor.businessId,
      date: anchor.date,
      description: anchor.description,
      externalId: input.externalId ?? randomUUID(),
      anchor: {
        accountId: anchor.anchorAccountId,
        amount: String(absTotal),
        direction,
      },
      lineItems,
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
    } as const;

    const result = await ctx.wave.moneyTransactionCreate(ctx.req, {
      input: createInput as never,
    });
    throwIfInputErrors(result.moneyTransactionCreate ?? undefined, "MoneyTransactionCreate");
    const transaction = result.moneyTransactionCreate?.transaction;
    if (!transaction) {
      throw new ToolError("WAVE_NO_TRANSACTION", { op: "MoneyTransactionCreate" });
    }

    return {
      transactionId: transaction.id,
      status: "CREATED",
      direction,
      totalAmount: anchor.totalAmount,
      lineCount: lines.length,
    };
  },
});

function requireTaxAmount(accountId: string): never {
  throw new ToolError(
    "SALES_TAX_AMOUNT_REQUIRED",
    { accountId },
    "Wave's MoneyTransactionCreateSalesTaxInput requires `amount`. Provide salesTaxes[].amount for every tax on this line.",
  );
}
