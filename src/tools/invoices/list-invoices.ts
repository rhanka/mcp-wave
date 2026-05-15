import { z } from "zod";
import { ToolError } from "../../lib/errors.js";
import { defineTool } from "../../server/define-tool.js";

export const listInvoicesTool = defineTool({
  name: "list_invoices",
  description:
    "List invoices for a business. Supports status filter (e.g. DRAFT, SAVED, SENT, VIEWED, PARTIAL, PAID, UNPAID, OVERDUE, OVERPAID), a customer_id filter, an invoice date range, and a currency filter. Returns paginated results with totals and amounts due.",
  inputSchema: z.object({
    business_id: z.string().min(1).optional(),
    status: z.string().min(1).optional(),
    customer_id: z.string().min(1).optional(),
    date_from: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "date_from must be YYYY-MM-DD")
      .optional(),
    date_to: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "date_to must be YYYY-MM-DD")
      .optional(),
    currency: z.string().min(1).optional(),
    page: z.number().int().min(1).optional(),
    page_size: z.number().int().min(1).max(100).optional(),
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

    const vars: {
      businessId: string;
      page: number;
      pageSize: number;
      status?: string;
      customerId?: string;
      currency?: string;
      invoiceDateStart?: string;
      invoiceDateEnd?: string;
    } = {
      businessId,
      page: input.page ?? 1,
      pageSize: input.page_size ?? 50,
    };
    if (input.status !== undefined) vars.status = input.status;
    if (input.customer_id !== undefined) vars.customerId = input.customer_id;
    if (input.currency !== undefined) vars.currency = input.currency;
    if (input.date_from !== undefined) vars.invoiceDateStart = input.date_from;
    if (input.date_to !== undefined) vars.invoiceDateEnd = input.date_to;

    const r = await ctx.wave.listInvoices(ctx.req, vars as never);

    const business = r.business;
    if (!business) {
      throw new ToolError(
        "BUSINESS_NOT_FOUND",
        { business_id: businessId },
        "The Wave API returned no business for the given id; verify business_id.",
      );
    }

    const invoices = business.invoices;
    if (!invoices) {
      return {
        invoices: [],
        page_info: { current_page: 1, total_pages: 0, total_count: 0 },
      };
    }

    return {
      invoices: invoices.edges
        .filter((e): e is typeof e & { node: NonNullable<typeof e.node> } => e.node != null)
        .map((e) => ({
          id: e.node.id,
          number: e.node.invoiceNumber,
          status: e.node.status,
          customer: { id: e.node.customer.id, name: e.node.customer.name },
          currency: e.node.currency.code,
          total: e.node.total.value,
          amount_due: e.node.amountDue.value,
          invoice_date: e.node.invoiceDate,
          due_date: e.node.dueDate,
        })),
      page_info: {
        current_page: invoices.pageInfo.currentPage,
        total_pages: invoices.pageInfo.totalPages,
        total_count: invoices.pageInfo.totalCount,
      },
    };
  },
});
