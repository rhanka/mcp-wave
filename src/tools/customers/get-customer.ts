import { z } from "zod";
import { parseProfileFromNotes } from "../../domain/client-profiles/parse-from-notes.js";
import { ToolError } from "../../lib/errors.js";
import { defineTool } from "../../server/define-tool.js";

export const getCustomerTool = defineTool({
  name: "get_customer",
  description:
    "Fetch a single customer by id. When with_profile=true, also returns the parsed mcp-wave profile block from internalNotes.",
  inputSchema: z.object({
    business_id: z.string().optional(),
    customer_id: z.string().min(1),
    with_profile: z.boolean().optional(),
  }),
  async execute(input, ctx) {
    const businessId = input.business_id ?? ctx.env.WAVE_DEFAULT_BUSINESS_ID;
    if (!businessId) throw new ToolError("BUSINESS_ID_REQUIRED", {});
    const r = await ctx.wave.getCustomer(ctx.req, {
      businessId,
      customerId: input.customer_id,
    });
    if (!r.business) throw new ToolError("BUSINESS_NOT_FOUND", { business_id: businessId });
    if (!r.business.customer) {
      throw new ToolError("CUSTOMER_NOT_FOUND", {
        business_id: businessId,
        customer_id: input.customer_id,
      });
    }
    const c = r.business.customer;
    const base = {
      id: c.id,
      name: c.name,
      email: c.email,
      currency: c.currency?.code ?? null,
      internal_notes_raw: c.internalNotes,
    };
    if (input.with_profile) {
      return { ...base, profile: parseProfileFromNotes(c.internalNotes) };
    }
    return base;
  },
});
