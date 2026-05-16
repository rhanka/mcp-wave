import { z } from "zod";
import { ToolError } from "../../lib/errors.js";
import { defineTool } from "../../server/define-tool.js";
import { throwIfInputErrors } from "../../wave/payload-errors.js";

const InvoiceLineInput = z.object({
  product_id: z.string().min(1),
  description: z.string().optional(),
  quantity: z.number().positive(),
  unit_price: z.number().nonnegative().optional(),
  tax_ids: z.array(z.string()).optional(),
});

export const createInvoiceTool = defineTool({
  name: "create_invoice",
  description:
    "Create a DRAFT invoice in Wave. Returns invoice_id, status, pdf_url, and computed totals. Not idempotent: calling twice creates two invoices.",
  inputSchema: z.object({
    business_id: z.string().optional(),
    customer_id: z.string().min(1),
    currency: z.string().length(3),
    invoice_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "invoice_date must be YYYY-MM-DD"),
    due_date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "due_date must be YYYY-MM-DD")
      .optional(),
    invoice_number: z.string().optional(),
    memo: z.string().optional(),
    items: z.array(InvoiceLineInput).min(1),
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

    const items = input.items.map((i) => {
      const item: Record<string, unknown> = {
        productId: i.product_id,
        quantity: String(i.quantity),
      };
      if (i.description !== undefined) item.description = i.description;
      if (i.unit_price !== undefined) item.unitPrice = String(i.unit_price);
      if (i.tax_ids !== undefined) item.taxes = i.tax_ids.map((id) => ({ salesTaxId: id }));
      return item;
    });

    const invInput: Record<string, unknown> = {
      businessId,
      customerId: input.customer_id,
      currency: input.currency,
      invoiceDate: input.invoice_date,
      items,
    };
    if (input.due_date !== undefined) invInput.dueDate = input.due_date;
    if (input.invoice_number !== undefined) invInput.invoiceNumber = input.invoice_number;
    if (input.memo !== undefined) invInput.memo = input.memo;

    const r = await ctx.wave.invoiceCreate(ctx.req, { input: invInput as never });
    throwIfInputErrors(r.invoiceCreate ?? undefined, "InvoiceCreate");
    const inv = r.invoiceCreate?.invoice;
    if (!inv) throw new ToolError("WAVE_NO_INVOICE", { op: "InvoiceCreate" });

    return {
      invoice_id: inv.id,
      invoice_number: inv.invoiceNumber,
      status: inv.status,
      pdf_url: inv.pdfUrl,
      totals: {
        subtotal: inv.subtotal ? Number(inv.subtotal.value) : 0,
        tax_total: inv.taxTotal ? Number(inv.taxTotal.value) : 0,
        total: inv.total ? Number(inv.total.value) : 0,
        currency: input.currency,
      },
    };
  },
});
