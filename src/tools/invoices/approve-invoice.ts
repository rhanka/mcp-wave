import { z } from "zod";
import { ToolError } from "../../lib/errors.js";
import { defineTool } from "../../server/define-tool.js";
import { throwIfInputErrors } from "../../wave/payload-errors.js";

export const approveInvoiceTool = defineTool({
  name: "approve_invoice",
  description:
    "Approve a Wave invoice (DRAFT → SAVED). Required before invoiceSend on a freshly created invoice.",
  inputSchema: z.object({
    invoice_id: z.string().min(1),
  }),
  async execute(input, ctx) {
    const result = await ctx.wave.invoiceApprove(ctx.req, {
      input: { invoiceId: input.invoice_id },
    });
    throwIfInputErrors(result.invoiceApprove ?? undefined, "InvoiceApprove");
    if (result.invoiceApprove?.didSucceed === false) {
      throw new ToolError(
        "INVOICE_APPROVE_FAILED",
        { invoice_id: input.invoice_id },
        "Wave returned didSucceed=false without inputErrors.",
      );
    }
    return {
      invoice_id: input.invoice_id,
      status: result.invoiceApprove?.invoice?.status ?? "SAVED",
    };
  },
});
