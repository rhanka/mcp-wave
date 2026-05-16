import { z } from "zod";
import { defineTool } from "../../server/define-tool.js";
import { throwIfInputErrors } from "../../wave/payload-errors.js";

export const deleteInvoiceTool = defineTool({
  name: "delete_invoice",
  description:
    "Delete a DRAFT invoice in Wave. Wave rejects deletion of sent invoices: attempting to delete a SENT/PAID/etc invoice returns WAVE_VALIDATION_ERROR. For sent invoices, void them in the Wave UI instead.",
  inputSchema: z.object({
    business_id: z.string().optional(),
    invoice_id: z.string().min(1),
  }),
  async execute(input, ctx) {
    const r = await ctx.wave.invoiceDelete(ctx.req, {
      input: { invoiceId: input.invoice_id },
    });
    throwIfInputErrors(r.invoiceDelete ?? undefined, "InvoiceDelete");

    return {
      invoice_id: input.invoice_id,
      deleted: true,
    };
  },
});
