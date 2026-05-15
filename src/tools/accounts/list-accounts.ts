import { z } from "zod";
import { ToolError } from "../../lib/errors.js";
import { defineTool } from "../../server/define-tool.js";

export const listAccountsTool = defineTool({
  name: "list_accounts",
  description:
    "List chart-of-accounts entries for a business, optionally filtered by type (ASSET, LIABILITY, INCOME, EXPENSE, EQUITY).",
  inputSchema: z.object({
    business_id: z.string().min(1).optional(),
    type: z.string().min(1).optional(),
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

    const vars: { businessId: string; types?: string[] } = { businessId };
    if (input.type !== undefined) vars.types = [input.type];

    const r = await ctx.wave.listAccounts(ctx.req, vars as never);

    const business = r.business;
    if (!business) {
      throw new ToolError(
        "BUSINESS_NOT_FOUND",
        { business_id: businessId },
        "The Wave API returned no business for the given id; verify business_id.",
      );
    }

    const accounts = business.accounts;
    if (!accounts) {
      return { accounts: [] };
    }

    return {
      accounts: accounts.edges
        .filter((e): e is typeof e & { node: NonNullable<typeof e.node> } => e.node != null)
        .map((e) => ({
          id: e.node.id,
          name: e.node.name,
          type: e.node.type.value,
          normal_balance_type: e.node.type.normalBalanceType,
          subtype: e.node.subtype.value,
          currency: e.node.currency.code,
        })),
    };
  },
});
