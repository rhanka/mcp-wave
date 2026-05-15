import { z } from "zod";
import { parseProfileFromNotes } from "../../domain/client-profiles/parse-from-notes.js";
import { ToolError } from "../../lib/errors.js";
import { defineTool } from "../../server/define-tool.js";

export const listClientProfilesTool = defineTool({
  name: "list_client_profiles",
  description:
    "List all customers that have an mcp-wave profile defined in their internalNotes. Returns alias→customer mappings and any parse errors.",
  inputSchema: z.object({
    business_id: z.string().optional(),
  }),
  async execute(input, ctx) {
    const businessId = input.business_id ?? ctx.env.WAVE_DEFAULT_BUSINESS_ID;
    if (!businessId) throw new ToolError("BUSINESS_ID_REQUIRED", {});

    const profiles: Array<{
      customer_id: string;
      customer_name: string;
      profile: unknown;
    }> = [];
    const errors: Array<{
      customer_id: string;
      customer_name: string;
      issues: Array<{ path: string; message: string }>;
    }> = [];

    let page = 1;
    while (true) {
      const r = await ctx.wave.listCustomers(ctx.req, { businessId, page, pageSize: 100 });
      if (!r.business) throw new ToolError("BUSINESS_NOT_FOUND", { business_id: businessId });
      const conn = r.business.customers;
      if (!conn) break;
      for (const edge of conn.edges) {
        if (!edge.node) continue;
        const result = parseProfileFromNotes(edge.node.internalNotes);
        if (result.kind === "ok") {
          profiles.push({
            customer_id: edge.node.id,
            customer_name: edge.node.name,
            profile: result.profile,
          });
        } else if (result.kind === "parse_error") {
          errors.push({
            customer_id: edge.node.id,
            customer_name: edge.node.name,
            issues: result.issues,
          });
        }
      }
      const totalPages = conn.pageInfo.totalPages ?? page;
      if (page >= totalPages) break;
      page++;
    }

    return { profiles, errors };
  },
});
