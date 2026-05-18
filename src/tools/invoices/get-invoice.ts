import { z } from "zod";
import { ToolError } from "../../lib/errors.js";
import { defineTool } from "../../server/define-tool.js";

export const getInvoiceTool = defineTool({
  name: "get_invoice",
  description:
    "Fetch a single invoice by id, including line items, taxes, totals, amount due/paid, linked invoice payments, customer, currency, and PDF URL.",
  inputSchema: z.object({
    business_id: z.string().min(1).optional(),
    invoice_id: z.string().min(1),
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

    const r = await ctx.wave.getInvoice(ctx.req, {
      businessId,
      invoiceId: input.invoice_id,
    });

    const business = r.business;
    if (!business) {
      throw new ToolError(
        "BUSINESS_NOT_FOUND",
        { business_id: businessId },
        "The Wave API returned no business for the given id; verify business_id.",
      );
    }

    const invoice = business.invoice;
    if (!invoice) {
      throw new ToolError(
        "INVOICE_NOT_FOUND",
        { business_id: businessId, invoice_id: input.invoice_id },
        "No invoice with that id exists in the given business.",
      );
    }

    const items = (invoice.items ?? []).map((it) => ({
      product: { id: it.product.id, name: it.product.name },
      description: it.description,
      quantity: it.quantity,
      unit_price: it.unitPrice,
      taxes: it.taxes.map((t) => ({
        sales_tax: {
          id: t.salesTax.id,
          name: t.salesTax.name,
          rate: t.salesTax.rate,
        },
        amount: t.amount?.value ?? null,
      })),
      subtotal: it.subtotal.value,
      total: it.total.value,
    }));
    const payments = (invoice.payments ?? [])
      .filter((payment): payment is NonNullable<typeof payment> => payment != null)
      .map((payment) => ({
        id: payment.id,
        amount: payment.amount,
        payment_date: payment.paymentDate,
        payment_method: payment.paymentMethod,
        memo: payment.memo,
        accounting_transaction_id: payment.accountingTransactionId,
        transaction_id: payment.transactionId,
        state: payment.state,
        receipt_url: payment.readonlyUrl,
        created_at: payment.createdAt,
        modified_at: payment.modifiedAt,
        account: {
          id: payment.account.id,
          name: payment.account.name,
        },
      }));

    return {
      id: invoice.id,
      number: invoice.invoiceNumber,
      status: invoice.status,
      invoice_date: invoice.invoiceDate,
      due_date: invoice.dueDate,
      memo: invoice.memo,
      customer: {
        id: invoice.customer.id,
        name: invoice.customer.name,
        email: invoice.customer.email,
      },
      currency: invoice.currency.code,
      items,
      subtotal: invoice.subtotal.value,
      tax_total: invoice.taxTotal.value,
      total: invoice.total.value,
      amount_due: invoice.amountDue.value,
      amount_paid: invoice.amountPaid.value,
      payments,
      pdf_url: invoice.pdfUrl,
    };
  },
});
