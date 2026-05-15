import { z } from "zod";
import { defineTool } from "../../server/define-tool.js";

export const listBusinessesTool = defineTool({
  name: "list_businesses",
  description:
    "List all businesses (Wave entities) accessible to the authenticated token. Use this to discover the business_id for other tools when WAVE_DEFAULT_BUSINESS_ID is unset.",
  inputSchema: z.object({
    page: z.number().int().min(1).optional(),
    page_size: z.number().int().min(1).max(100).optional(),
  }),
  async execute(input, ctx) {
    const r = await ctx.wave.listBusinesses(ctx.req, {
      page: input.page ?? 1,
      pageSize: input.page_size ?? 20,
    });
    const businesses = r.businesses;
    if (!businesses) {
      return {
        businesses: [],
        page_info: { current_page: 1, total_pages: 0, total_count: 0 },
      };
    }
    return {
      businesses: businesses.edges
        .filter((e): e is typeof e & { node: NonNullable<typeof e.node> } => e.node != null)
        .map((e) => ({
          id: e.node.id,
          name: e.node.name,
          currency: e.node.currency.code,
          timezone: e.node.timezone,
        })),
      page_info: {
        current_page: businesses.pageInfo.currentPage,
        total_pages: businesses.pageInfo.totalPages,
        total_count: businesses.pageInfo.totalCount,
      },
    };
  },
});
