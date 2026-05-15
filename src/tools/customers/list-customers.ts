import { z } from "zod";
import { parseProfileFromNotes } from "../../domain/client-profiles/parse-from-notes.js";
import { ToolError } from "../../lib/errors.js";
import { defineTool } from "../../server/define-tool.js";

export const listCustomersTool = defineTool({
  name: "list_customers",
  description:
    "List customers for a business. When with_profiles=true, parses each customer's internalNotes for an mcp-wave profile block and includes it on the result.",
  inputSchema: z.object({
    business_id: z.string().optional(),
    page: z.number().int().min(1).optional(),
    page_size: z.number().int().min(1).max(100).optional(),
    with_profiles: z.boolean().optional(),
  }),
  async execute(input, ctx) {
    const businessId = input.business_id ?? ctx.env.WAVE_DEFAULT_BUSINESS_ID;
    if (!businessId) throw new ToolError("BUSINESS_ID_REQUIRED", {});
    const r = await ctx.wave.listCustomers(ctx.req, {
      businessId,
      page: input.page ?? 1,
      pageSize: input.page_size ?? 50,
    });
    if (!r.business) throw new ToolError("BUSINESS_NOT_FOUND", { business_id: businessId });
    const conn = r.business.customers;
    if (!conn) {
      return {
        customers: [],
        page_info: { current_page: 1, total_pages: 0, total_count: 0 },
      };
    }

    const customers = conn.edges
      .filter((e): e is typeof e & { node: NonNullable<typeof e.node> } => e.node != null)
      .map((e) => {
        const base = {
          id: e.node.id,
          name: e.node.name,
          email: e.node.email,
          currency: e.node.currency?.code ?? null,
        };
        if (input.with_profiles) {
          return { ...base, profile: parseProfileFromNotes(e.node.internalNotes) };
        }
        return base;
      });

    return {
      customers,
      page_info: {
        current_page: conn.pageInfo.currentPage,
        total_pages: conn.pageInfo.totalPages,
        total_count: conn.pageInfo.totalCount,
      },
    };
  },
});
