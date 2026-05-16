import { z } from "zod";
import { ToolError } from "../../lib/errors.js";
import { defineTool } from "../../server/define-tool.js";
import { throwIfInputErrors } from "../../wave/payload-errors.js";

export const markInvoicePaidTool = defineTool({
  name: "mark_invoice_paid",
  description:
    "Record a manual payment against an invoice via Wave's invoicePaymentCreateManual mutation. Use this for cash/cheque/bank-transfer payments collected outside of Wave Payments. Do NOT call this if Wave has already auto-matched a bank transaction to the invoice — doing so will double-count the payment. exchange_rate defaults to 1 when omitted (use it only when the payment account currency differs from the invoice currency).",
  inputSchema: z.object({
    business_id: z.string().optional(),
    invoice_id: z.string().min(1),
    amount: z.number().positive(),
    paid_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "paid_at must be YYYY-MM-DD"),
    payment_account_id: z.string().min(1),
    payment_method: z.enum(["BANK_TRANSFER", "CASH", "CHEQUE", "CREDIT_CARD", "OTHER"]),
    memo: z.string().optional(),
    exchange_rate: z.number().positive().optional(),
  }),
  async execute(input, ctx) {
    const payInput: Record<string, unknown> = {
      invoiceId: input.invoice_id,
      amount: String(input.amount),
      exchangeRate: String(input.exchange_rate ?? 1),
      paymentAccountId: input.payment_account_id,
      paymentDate: input.paid_at,
      paymentMethod: input.payment_method,
    };
    if (input.memo !== undefined) payInput.memo = input.memo;

    const r = await ctx.wave.invoicePaymentCreateManual(ctx.req, { input: payInput as never });
    throwIfInputErrors(r.invoicePaymentCreateManual ?? undefined, "InvoicePaymentCreateManual");
    const payment = r.invoicePaymentCreateManual?.invoicePayment;
    if (!payment) throw new ToolError("WAVE_NO_PAYMENT", { op: "InvoicePaymentCreateManual" });

    return {
      payment_id: payment.id,
      amount: payment.amount !== null ? Number(payment.amount) : input.amount,
      payment_date: payment.paymentDate ?? input.paid_at,
      payment_method: payment.paymentMethod ?? input.payment_method,
      memo: payment.memo,
    };
  },
});
