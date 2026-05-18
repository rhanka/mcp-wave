import { z } from "zod";
import { ToolError } from "../../lib/errors.js";
import { defineTool } from "../../server/define-tool.js";
import { throwIfInputErrors } from "../../wave/payload-errors.js";

const invoicePaymentMethodSchema = z.enum([
  "BANK_TRANSFER",
  "CASH",
  "CHEQUE",
  "CREDIT_CARD",
  "OTHER",
  "PAYPAL",
  "UNSPECIFIED",
]);

export const updateInvoicePaymentTool = defineTool({
  name: "update_invoice_payment",
  description:
    "Correct an existing invoice payment record in Wave by patching amount, date, account, method, memo, or exchange rate. Use this to fix manual payment entries when a reconciliation was recorded with the wrong details.",
  inputSchema: z
    .object({
      invoice_payment_id: z.string().min(1),
      amount: z.number().positive().optional(),
      paid_at: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, "paid_at must be YYYY-MM-DD")
        .optional(),
      payment_account_id: z.string().min(1).optional(),
      payment_method: invoicePaymentMethodSchema.optional(),
      memo: z.string().optional(),
      exchange_rate: z.number().positive().optional(),
    })
    .refine(
      (value) =>
        value.amount !== undefined ||
        value.paid_at !== undefined ||
        value.payment_account_id !== undefined ||
        value.payment_method !== undefined ||
        value.memo !== undefined ||
        value.exchange_rate !== undefined,
      {
        message:
          "Provide at least one field to update: amount, paid_at, payment_account_id, payment_method, memo, or exchange_rate.",
      },
    ),
  async execute(input, ctx) {
    const patchInput: Record<string, unknown> = {
      id: input.invoice_payment_id,
    };
    if (input.amount !== undefined) patchInput.amount = String(input.amount);
    if (input.paid_at !== undefined) patchInput.paymentDate = input.paid_at;
    if (input.payment_account_id !== undefined) {
      patchInput.paymentAccountId = input.payment_account_id;
    }
    if (input.payment_method !== undefined) patchInput.paymentMethod = input.payment_method;
    if (input.memo !== undefined) patchInput.memo = input.memo;
    if (input.exchange_rate !== undefined) patchInput.exchangeRate = String(input.exchange_rate);

    const r = await ctx.wave.invoicePaymentPatch(ctx.req, { input: patchInput as never });
    throwIfInputErrors(r.invoicePaymentPatch ?? undefined, "InvoicePaymentPatch");
    const payment = r.invoicePaymentPatch?.invoicePayment;
    if (!payment) {
      throw new ToolError("WAVE_NO_PAYMENT", { op: "InvoicePaymentPatch" });
    }

    return {
      payment_id: payment.id,
      amount: payment.amount !== null ? Number(payment.amount) : (input.amount ?? null),
      payment_date: payment.paymentDate ?? input.paid_at ?? null,
      payment_method: payment.paymentMethod ?? input.payment_method ?? null,
      memo: payment.memo,
    };
  },
});
