import { stringify as stringifyYaml } from "yaml";
import { z } from "zod";
import { suggestMapping } from "../../domain/tax/suggest-mapping.js";
import { ToolError } from "../../lib/errors.js";
import { defineTool } from "../../server/define-tool.js";

const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");

export const setupAccountMappingTool = defineTool({
  name: "setup_account_mapping",
  description:
    "Suggest data/account-mapping/default.yaml by matching Wave liability accounts to payroll remittance authorities. Returns YAML only; it does not write files.",
  inputSchema: z
    .object({
      business_id: z.string().optional(),
      jurisdiction: z.string().min(1),
      year: z.number().int().optional(),
      on_date: isoDateSchema.optional(),
    })
    .refine((input) => input.year !== undefined || input.on_date !== undefined, {
      message: "Provide either year or on_date",
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

    const rates =
      input.year !== undefined
        ? await ctx.taxRates.load(input.jurisdiction, input.year)
        : await ctx.taxRates.loadForDate(input.jurisdiction, input.on_date as string);

    const accountsResult = await ctx.wave.listAccounts(ctx.req, {
      businessId,
      types: ["LIABILITY"],
    } as never);
    if (!accountsResult.business) {
      throw new ToolError("BUSINESS_NOT_FOUND", { business_id: businessId });
    }

    const accounts =
      accountsResult.business.accounts?.edges
        .map((edge) => edge.node)
        .filter((account): account is NonNullable<typeof account> => account !== null)
        .map((account) => ({ id: account.id, name: account.name })) ?? [];
    const authorities = rates.remittance_authorities.map((authority) => ({
      code: authority.code,
      name: authority.name,
    }));
    const suggestions = suggestMapping(accounts, authorities);

    const remittanceBuckets = Object.fromEntries(
      suggestions.map((suggestion) => {
        const best = suggestion.suggestions[0];
        return [
          suggestion.authority_code,
          { payable_account_id: best && best.score > 0 ? best.account_id : "" },
        ];
      }),
    );

    const yamlBody = stringifyYaml({
      business_id_env: "WAVE_DEFAULT_BUSINESS_ID",
      jurisdiction: rates.jurisdiction,
      remittance_buckets: remittanceBuckets,
    });

    return {
      jurisdiction: rates.jurisdiction,
      yaml: `# data/account-mapping/default.yaml\n${yamlBody}`,
      suggestions,
    };
  },
});
