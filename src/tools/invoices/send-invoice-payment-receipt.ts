import { z } from "zod";
import { defineTool } from "../../server/define-tool.js";
import { throwIfInputErrors } from "../../wave/payload-errors.js";

export const sendInvoicePaymentReceiptTool = defineTool({
  name: "send_invoice_payment_receipt",
  description:
    "Email a payment receipt for an invoice payment via Wave. NOT IDEMPOTENT: each call triggers a real outbound email. attach_pdf defaults to true.",
  inputSchema: z.object({
    invoice_id: z.string().min(1),
    invoice_payment_id: z.string().min(1),
    to_email: z.array(z.string().email()).min(1),
    subject: z.string().optional(),
    message: z.string().optional(),
    attach_pdf: z.boolean().optional(),
    cc_myself: z.boolean().optional(),
    from_address: z.string().email().optional(),
  }),
  async execute(input, ctx) {
    const sendInput: Record<string, unknown> = {
      invoiceId: input.invoice_id,
      invoicePaymentId: input.invoice_payment_id,
      to: input.to_email,
      attachPdf: input.attach_pdf ?? true,
    };
    if (input.subject !== undefined) sendInput.subject = input.subject;
    if (input.message !== undefined) sendInput.message = input.message;
    if (input.cc_myself !== undefined) sendInput.ccMyself = input.cc_myself;
    if (input.from_address !== undefined) sendInput.fromAddress = input.from_address;

    const r = await ctx.wave.invoicePaymentReceiptSend(ctx.req, { input: sendInput as never });
    throwIfInputErrors(r.invoicePaymentReceiptSend ?? undefined, "InvoicePaymentReceiptSend");

    return {
      invoice_id: input.invoice_id,
      invoice_payment_id: input.invoice_payment_id,
      sent_to: input.to_email,
      sent_at: new Date().toISOString(),
    };
  },
});
