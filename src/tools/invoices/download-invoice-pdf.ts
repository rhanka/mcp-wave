import { z } from "zod";
import { ToolError } from "../../lib/errors.js";
import { defineTool } from "../../server/define-tool.js";

export const downloadInvoicePdfTool = defineTool({
  name: "download_invoice_pdf",
  description:
    "Return the PDF URL for an invoice. The URL is short-lived and can be fetched to download the PDF representation.",
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

    if (!invoice.pdfUrl) {
      throw new ToolError(
        "PDF_UNAVAILABLE",
        { business_id: businessId, invoice_id: input.invoice_id },
        "Wave did not return a pdfUrl for this invoice.",
      );
    }

    return {
      invoice_id: invoice.id,
      invoice_number: invoice.invoiceNumber,
      pdf_url: invoice.pdfUrl,
    };
  },
});
