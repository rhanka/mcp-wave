import { z } from "zod";
import { ToolError } from "../../lib/errors.js";
import { defineTool } from "../../server/define-tool.js";

export const getAccountTool = defineTool({
  name: "get_account",
  description:
    "Fetch a single chart-of-accounts entry by id, including type, normal balance type, subtype, and currency.",
  inputSchema: z.object({
    business_id: z.string().min(1).optional(),
    account_id: z.string().min(1),
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

    const r = await ctx.wave.getAccount(ctx.req, {
      businessId,
      accountId: input.account_id,
    });

    const business = r.business;
    if (!business) {
      throw new ToolError(
        "BUSINESS_NOT_FOUND",
        { business_id: businessId },
        "The Wave API returned no business for the given id; verify business_id.",
      );
    }

    const account = business.account;
    if (!account) {
      throw new ToolError(
        "ACCOUNT_NOT_FOUND",
        { business_id: businessId, account_id: input.account_id },
        "No account with that id exists in the given business.",
      );
    }

    return {
      id: account.id,
      name: account.name,
      type: account.type.value,
      normal_balance_type: account.type.normalBalanceType,
      subtype: account.subtype.value,
      currency: account.currency.code,
    };
  },
});
