import { z } from "zod";
import { defineTool } from "../../server/define-tool.js";
import { throwIfInputErrors } from "../../wave/payload-errors.js";

export const sendInvoiceTool = defineTool({
  name: "send_invoice",
  description:
    "Email an invoice to one or more recipients via Wave. NOT IDEMPOTENT: each call triggers a real outbound email (and may resend a previously-sent invoice). Always confirm recipients, subject, and message with the user before calling. attach_pdf defaults to true.",
  inputSchema: z.object({
    business_id: z.string().optional(),
    invoice_id: z.string().min(1),
    to_email: z.array(z.string().email()).min(1),
    subject: z.string().optional(),
    message: z.string().optional(),
    attach_pdf: z.boolean().optional(),
    cc_myself: z.boolean().optional(),
  }),
  async execute(input, ctx) {
    const sendInput: Record<string, unknown> = {
      invoiceId: input.invoice_id,
      to: input.to_email,
      attachPDF: input.attach_pdf ?? true,
    };
    if (input.subject !== undefined) sendInput.subject = input.subject;
    if (input.message !== undefined) sendInput.message = input.message;
    if (input.cc_myself !== undefined) sendInput.ccMyself = input.cc_myself;

    const r = await ctx.wave.invoiceSend(ctx.req, { input: sendInput as never });
    throwIfInputErrors(r.invoiceSend ?? undefined, "InvoiceSend");

    return {
      invoice_id: input.invoice_id,
      sent_to: input.to_email,
      sent_at: new Date().toISOString(),
    };
  },
});
