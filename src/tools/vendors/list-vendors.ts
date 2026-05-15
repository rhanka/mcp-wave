import { z } from "zod";
import { ToolError } from "../../lib/errors.js";
import { defineTool } from "../../server/define-tool.js";

export const listVendorsTool = defineTool({
  name: "list_vendors",
  description:
    "List vendors for a business. Returns each vendor's id, name, email, and default currency code (when set). Supports pagination.",
  inputSchema: z.object({
    business_id: z.string().min(1).optional(),
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

    const r = await ctx.wave.listVendors(ctx.req, {
      businessId,
      page: input.page ?? 1,
      pageSize: input.page_size ?? 50,
    });

    const business = r.business;
    if (!business) {
      throw new ToolError(
        "BUSINESS_NOT_FOUND",
        { business_id: businessId },
        "The Wave API returned no business for the given id; verify business_id.",
      );
    }

    const vendors = business.vendors;
    if (!vendors) {
      return {
        vendors: [],
        page_info: { current_page: 1, total_pages: 0, total_count: 0 },
      };
    }

    return {
      vendors: vendors.edges
        .filter((e): e is typeof e & { node: NonNullable<typeof e.node> } => e.node != null)
        .map((e) => ({
          id: e.node.id,
          name: e.node.name,
          email: e.node.email ?? null,
          currency: e.node.currency?.code ?? null,
        })),
      page_info: {
        current_page: vendors.pageInfo.currentPage,
        total_pages: vendors.pageInfo.totalPages,
        total_count: vendors.pageInfo.totalCount,
      },
    };
  },
});
