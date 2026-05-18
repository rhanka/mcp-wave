import { z } from "zod";
import { defineTool } from "../../server/define-tool.js";
import { throwIfInputErrors } from "../../wave/payload-errors.js";

export const deleteInvoicePaymentTool = defineTool({
  name: "delete_invoice_payment",
  description:
    "Delete a manual invoice payment in Wave. Use this to undo an incorrect manual reconciliation or payment record before re-entering the right one.",
  inputSchema: z.object({
    invoice_payment_id: z.string().min(1),
  }),
  async execute(input, ctx) {
    const r = await ctx.wave.invoicePaymentDelete(ctx.req, {
      input: { id: input.invoice_payment_id },
    });
    throwIfInputErrors(r.invoicePaymentDelete ?? undefined, "InvoicePaymentDelete");

    return {
      invoice_payment_id: input.invoice_payment_id,
      deleted: true,
    };
  },
});
