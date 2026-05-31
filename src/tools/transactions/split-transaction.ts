import { randomUUID } from "node:crypto";
import { z } from "zod";
import { ToolError } from "../../lib/errors.js";
import { defineTool } from "../../server/define-tool.js";
import type { ToolContext } from "../../server/tool-context.js";
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
  // When true, treat `amount` as tax-inclusive (gross). The computed tax is
  // backed out: tax = amount * rate / (1 + rate). Default false (tax-exclusive,
  // i.e. `amount` is pre-tax and tax adds on top).
  taxInclusive: z.boolean().optional(),
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

/**
 * Wave `SalesTax.rate` is a Decimal stored as a fraction (e.g. `0.15` = 15%),
 * per `data/wave-schema.graphql` (line ~5986). The auto-compute logic relies
 * on that. If Wave changes the unit, this needs to be revisited.
 */
interface ResolvedSalesTax {
  id: string;
  rate: number; // decimal fraction, e.g. 0.05 for 5%
}

export const splitTransactionTool = defineTool({
  name: "split_transaction",
  description:
    "Create a Wave money transaction (multi-line) anchored on a bank account, splitting the amount across N arbitrary account lines, with optional per-line sales taxes. Use this to record expense splits, mixed-category deposits, payroll remittances and other reconciliations. The anchor.totalAmount sign drives direction: negative=WITHDRAWAL (money out), positive=DEPOSIT (money in). When no line carries salesTaxes, the sum of lines[].amount MUST equal |anchor.totalAmount|. When a salesTax entry omits `amount`, it is auto-computed from the Wave sales tax rate (default tax-exclusive; set `taxInclusive: true` on the line for tax-inclusive math).",
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

    // Memoized fetch of business sales-tax definitions. One fetch per tool call max.
    // Per-businessId so a future multi-business call still respects "fetch once per id".
    const salesTaxCache = new Map<string, Map<string, ResolvedSalesTax>>();
    async function getTaxes(businessId: string): Promise<Map<string, ResolvedSalesTax>> {
      const hit = salesTaxCache.get(businessId);
      if (hit) return hit;
      const fetched = await fetchSalesTaxes(ctx, businessId);
      salesTaxCache.set(businessId, fetched);
      return fetched;
    }

    const lineItems: Record<string, unknown>[] = [];
    for (const line of lines) {
      const item: Record<string, unknown> = {
        accountId: line.accountId,
        amount: String(line.amount),
        balance: "INCREASE",
      };
      if (line.description !== undefined) item.description = line.description;
      if (line.salesTaxes && line.salesTaxes.length > 0) {
        const taxes: Array<{ salesTaxId: string; amount: string }> = [];
        for (const tax of line.salesTaxes) {
          let serialized: string;
          if (tax.amount !== undefined) {
            // Caller-provided: pass through as-is to preserve existing semantics.
            serialized = String(tax.amount);
          } else {
            const defs = await getTaxes(anchor.businessId);
            const def = defs.get(tax.salesTaxId);
            if (!def) {
              throw new ToolError(
                "SALES_TAX_NOT_FOUND",
                {
                  salesTaxId: tax.salesTaxId,
                  available: Array.from(defs.keys()),
                },
                "salesTaxId referenced by a line is not defined for this business. Provide `amount` explicitly or use a known sales tax id.",
              );
            }
            const computed = computeTaxAmount(line.amount, def.rate, line.taxInclusive === true);
            serialized = formatMoney(computed);
          }
          taxes.push({ salesTaxId: tax.salesTaxId, amount: serialized });
        }
        item.taxes = taxes;
      }
      lineItems.push(item);
    }

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

async function fetchSalesTaxes(
  ctx: ToolContext,
  businessId: string,
): Promise<Map<string, ResolvedSalesTax>> {
  const res = await ctx.wave.listSalesTaxes(ctx.req, { businessId });
  if (!res.business) {
    throw new ToolError("BUSINESS_NOT_FOUND", { business_id: businessId });
  }
  const map = new Map<string, ResolvedSalesTax>();
  for (const edge of res.business.salesTaxes?.edges ?? []) {
    const node = edge.node;
    if (!node) continue;
    map.set(node.id, { id: node.id, rate: Number(node.rate) });
  }
  return map;
}

/**
 * @param lineAmount  Line amount as provided by the caller.
 * @param rate        Sales tax rate as a decimal fraction (e.g. 0.05 for 5%).
 * @param inclusive   When true, `lineAmount` is gross (includes tax); when false (default), pre-tax.
 * @returns tax amount, rounded to 2 decimal places.
 */
function computeTaxAmount(lineAmount: number, rate: number, inclusive: boolean): number {
  const raw = inclusive ? (lineAmount * rate) / (1 + rate) : lineAmount * rate;
  return Math.round(raw * 100) / 100;
}

function formatMoney(value: number): string {
  return value.toFixed(2);
}
