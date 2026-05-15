import { z } from "zod";
import { ToolError } from "../../lib/errors.js";
import { defineTool } from "../../server/define-tool.js";

export const listProductsTool = defineTool({
  name: "list_products",
  description:
    "List products for a business with their default price and income account. Returns paginated results.",
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

    const r = await ctx.wave.listProducts(ctx.req, {
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

    const products = business.products;
    if (!products) {
      return {
        products: [],
        page_info: { current_page: 1, total_pages: 0, total_count: 0 },
      };
    }

    return {
      products: products.edges
        .filter((e): e is typeof e & { node: NonNullable<typeof e.node> } => e.node != null)
        .map((e) => ({
          id: e.node.id,
          name: e.node.name,
          description: e.node.description,
          unit_price: e.node.unitPrice,
          income_account: e.node.incomeAccount
            ? { id: e.node.incomeAccount.id, name: e.node.incomeAccount.name }
            : null,
        })),
      page_info: {
        current_page: products.pageInfo.currentPage,
        total_pages: products.pageInfo.totalPages,
        total_count: products.pageInfo.totalCount,
      },
    };
  },
});
