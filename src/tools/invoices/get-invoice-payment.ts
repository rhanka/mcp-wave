import { z } from "zod";
import { ToolError } from "../../lib/errors.js";
import { defineTool } from "../../server/define-tool.js";

export const getInvoicePaymentTool = defineTool({
  name: "get_invoice_payment",
  description:
    "Fetch a single invoice payment by id, including the linked invoice, customer, currencies, receipt URL, and accounting transaction metadata useful for reconciliation.",
  inputSchema: z.object({
    business_id: z.string().min(1).optional(),
    invoice_payment_id: z.string().min(1),
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

    const r = await ctx.wave.getInvoicePayment(ctx.req, {
      businessId,
      invoicePaymentId: input.invoice_payment_id,
    });

    const business = r.business;
    if (!business) {
      throw new ToolError(
        "BUSINESS_NOT_FOUND",
        { business_id: businessId },
        "The Wave API returned no business for the given id; verify business_id.",
      );
    }

    const payment = business.invoicePayment;
    if (!payment) {
      throw new ToolError(
        "INVOICE_PAYMENT_NOT_FOUND",
        { business_id: businessId, invoice_payment_id: input.invoice_payment_id },
        "No invoice payment with that id exists in the given business.",
      );
    }

    return {
      id: payment.id,
      amount: payment.amount,
      payment_date: payment.paymentDate,
      payment_method: payment.paymentMethod,
      memo: payment.memo,
      exchange_rate: payment.exchangeRate,
      state: payment.state,
      receipt_url: payment.readonlyUrl,
      accounting_transaction_id: payment.accountingTransactionId,
      transaction_id: payment.transactionId,
      created_at: payment.createdAt,
      modified_at: payment.modifiedAt,
      account: {
        id: payment.account.id,
        name: payment.account.name,
        last3: payment.accountNumberLast3,
      },
      customer: payment.customer
        ? {
            id: payment.customer.id,
            name: payment.customer.name,
            email: payment.customer.email,
          }
        : null,
      currencies: {
        business: payment.businessCurrency?.code ?? null,
        invoice: payment.invoiceCurrency?.code ?? null,
        payment: payment.paymentCurrency?.code ?? null,
      },
      invoice: payment.invoice
        ? {
            id: payment.invoice.id,
            number: payment.invoice.invoiceNumber,
          }
        : null,
    };
  },
});
