import { randomUUID } from "node:crypto";
import { z } from "zod";
import { validateSplitSum } from "../../domain/tax/validate-split-sum.js";
import { ToolError } from "../../lib/errors.js";
import { defineTool } from "../../server/define-tool.js";
import { throwIfInputErrors } from "../../wave/payload-errors.js";

const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");
const BucketInput = z.object({
  amount: z.number().positive(),
  memo: z.string().optional(),
});

export const splitPayrollRemittanceTool = defineTool({
  name: "split_payroll_remittance",
  description:
    "Create a new Wave multi-line withdrawal transaction for a payroll remittance, with one line per remittance authority. This does not split already-imported bank transactions.",
  inputSchema: z.object({
    business_id: z.string().optional(),
    date: isoDateSchema,
    bank_account_id: z.string().min(1),
    description: z.string().min(1),
    jurisdiction: z.string().min(1),
    period_year: z.number().int(),
    total_amount: z.number().positive(),
    buckets: z.record(z.string().min(1), BucketInput),
    memo_prefix: z.string().default("DAS"),
    external_id: z.string().min(1).optional(),
    notes: z.string().optional(),
    tolerance_cents: z.number().int().min(0).default(1),
  }),
  async execute(input, ctx) {
    const businessId = input.business_id ?? ctx.env.WAVE_DEFAULT_BUSINESS_ID;
    if (!businessId) {
      throw new ToolError(
        "BUSINESS_ID_REQUIRED",
        {},
        "Pass business_id or set WAVE_DEFAULT_BUSINESS_ID in the environment.",
      );
    }

    const settings = await ctx.wave.getBusinessAccountingSettings(ctx.req, { businessId });
    if (!settings.business) {
      throw new ToolError("BUSINESS_NOT_FOUND", { business_id: businessId });
    }
    if (settings.business.isClassicAccounting) {
      throw new ToolError(
        "CLASSIC_ACCOUNTING_NOT_SUPPORTED",
        { business_id: businessId },
        "Wave moneyTransactionCreate requires a non-classic-accounting business.",
      );
    }

    const rates = await ctx.taxRates.load(input.jurisdiction, input.period_year);
    const authorities = new Map(
      rates.remittance_authorities.map((authority) => [authority.code, authority] as const),
    );
    const mapping = await ctx.accountMapping.load();

    const bucketEntries = Object.entries(input.buckets);
    for (const [code] of bucketEntries) {
      if (!authorities.has(code)) {
        throw new ToolError("UNKNOWN_AUTHORITY_CODE", {
          code,
          expected: [...authorities.keys()],
        });
      }
      if (!mapping.remittance_buckets[code]?.payable_account_id) {
        throw new ToolError(
          "MISSING_ACCOUNT_MAPPING",
          { authority: code },
          "Run setup_account_mapping or edit data/account-mapping/default.yaml.",
        );
      }
    }

    const tolerance = input.tolerance_cents / 100;
    const sumValidation = validateSplitSum(
      bucketEntries.map(([, bucket]) => bucket.amount),
      input.total_amount,
      tolerance,
    );
    if (!sumValidation.ok) {
      throw new ToolError("SPLIT_SUM_MISMATCH", sumValidation);
    }

    const lineItems = bucketEntries.map(([code, bucket]) => {
      const authority = authorities.get(code);
      const payableAccountId = mapping.remittance_buckets[code]?.payable_account_id;
      if (authority === undefined || payableAccountId === undefined) {
        throw new ToolError("INVALID_REMITTANCE_BUCKET", { code });
      }

      return {
        authority_code: code,
        amount: bucket.amount,
        account_id: payableAccountId,
        description: bucket.memo ?? `${input.memo_prefix} — ${authority.name}`,
      };
    });

    const createInput: Record<string, unknown> = {
      businessId,
      date: input.date,
      description: input.description,
      externalId: input.external_id ?? randomUUID(),
      anchor: {
        accountId: input.bank_account_id,
        amount: String(input.total_amount),
        direction: "WITHDRAWAL",
      },
      lineItems: lineItems.map((lineItem) => ({
        accountId: lineItem.account_id,
        amount: String(lineItem.amount),
        balance: "INCREASE",
        description: lineItem.description,
      })),
    };
    if (input.notes !== undefined) {
      createInput.notes = input.notes;
    }

    const result = await ctx.wave.moneyTransactionCreate(ctx.req, { input: createInput as never });
    throwIfInputErrors(result.moneyTransactionCreate ?? undefined, "MoneyTransactionCreate");
    const transaction = result.moneyTransactionCreate?.transaction;
    if (!transaction) {
      throw new ToolError("WAVE_NO_TRANSACTION", { op: "MoneyTransactionCreate" });
    }

    return {
      transaction_id: transaction.id,
      total_amount: input.total_amount,
      line_items: lineItems.map(({ authority_code, amount, account_id }) => ({
        authority_code,
        amount,
        account_id,
      })),
    };
  },
});
