import { z } from "zod";
import { suggestMapping } from "../../domain/tax/suggest-mapping.js";
import { ToolError } from "../../lib/errors.js";
import { defineTool } from "../../server/define-tool.js";

const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");

interface AccountRow {
  id: string;
  name: string;
  type: string;
  subtype: string;
  currency: string;
}

export const auditAccountMappingTool = defineTool({
  name: "audit_account_mapping",
  description:
    "Audit the current payroll/remittance account mapping against the Wave chart of accounts. Returns mapped, unmapped, and broken remittance buckets, plus available cash/bank accounts and concrete next actions.",
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

    const accountsResult = await ctx.wave.listAccounts(ctx.req, { businessId } as never);
    if (!accountsResult.business) {
      throw new ToolError("BUSINESS_NOT_FOUND", { business_id: businessId });
    }

    const accounts =
      accountsResult.business.accounts?.edges
        .map((edge) => edge.node)
        .filter((account): account is NonNullable<typeof account> => account !== null)
        .map(
          (account): AccountRow => ({
            id: account.id,
            name: account.name,
            type: account.type.value,
            subtype: account.subtype.value,
            currency: account.currency.code,
          }),
        ) ?? [];

    const allAccountsById = new Map(accounts.map((account) => [account.id, account] as const));
    const liabilityAccounts = accounts.filter((account) => account.type === "LIABILITY");
    const liabilityAccountsById = new Map(
      liabilityAccounts.map((account) => [account.id, account] as const),
    );
    const cashAndBankAccounts = accounts
      .filter((account) => account.type === "ASSET" && account.subtype === "CASH_AND_BANK")
      .map(({ id, name, subtype, currency }) => ({ id, name, subtype, currency }));

    let mapping: Awaited<ReturnType<typeof ctx.accountMapping.load>> | null = null;
    let mappingFile:
      | {
          present: true;
          jurisdiction: string;
          matches_requested_jurisdiction: boolean;
        }
      | {
          present: false;
          error_code: string;
        };
    try {
      mapping = await ctx.accountMapping.load();
      mappingFile = {
        present: true,
        jurisdiction: mapping.jurisdiction,
        matches_requested_jurisdiction: mapping.jurisdiction === rates.jurisdiction,
      };
    } catch (error) {
      if (
        error instanceof ToolError &&
        (error.code === "ACCOUNT_MAPPING_MISSING" || error.code === "ACCOUNT_MAPPING_INVALID")
      ) {
        mappingFile = {
          present: false,
          error_code: error.code,
        };
      } else {
        throw error;
      }
    }

    const suggestions = suggestMapping(
      liabilityAccounts.map((account) => ({ id: account.id, name: account.name })),
      rates.remittance_authorities.map((authority) => ({
        code: authority.code,
        name: authority.name,
      })),
    );
    const suggestionsByCode = new Map(
      suggestions.map((suggestion) => [suggestion.authority_code, suggestion.suggestions] as const),
    );

    const usedLiabilityAccounts = new Set<string>();
    const remittanceAuthorities = rates.remittance_authorities.map((authority) => {
      const configuredAccountId =
        mapping?.remittance_buckets[authority.code]?.payable_account_id ?? null;
      const configuredAccount =
        configuredAccountId !== null ? (allAccountsById.get(configuredAccountId) ?? null) : null;
      const mappedAccount =
        configuredAccountId !== null
          ? (liabilityAccountsById.get(configuredAccountId) ?? null)
          : null;

      let status:
        | "mapped"
        | "unmapped"
        | "configured_account_missing"
        | "configured_account_not_liability";
      if (configuredAccountId === null) {
        status = "unmapped";
      } else if (configuredAccount === null) {
        status = "configured_account_missing";
      } else if (configuredAccount.type !== "LIABILITY") {
        status = "configured_account_not_liability";
      } else {
        status = "mapped";
        usedLiabilityAccounts.add(configuredAccountId);
      }

      return {
        code: authority.code,
        name: authority.name,
        status,
        configured_account_id: configuredAccountId,
        mapped_account:
          mappedAccount === null
            ? null
            : {
                id: mappedAccount.id,
                name: mappedAccount.name,
                subtype: mappedAccount.subtype,
                currency: mappedAccount.currency,
              },
        top_suggestions: (suggestionsByCode.get(authority.code) ?? []).map((suggestion) => ({
          account_id: suggestion.account_id,
          account_name: suggestion.account_name,
          score: suggestion.score,
        })),
      };
    });

    const unusedLiabilityAccounts = liabilityAccounts
      .filter((account) => !usedLiabilityAccounts.has(account.id))
      .map(({ id, name, subtype, currency }) => ({ id, name, subtype, currency }));

    const mappedAuthorities = remittanceAuthorities.filter(
      (authority) => authority.status === "mapped",
    );
    const unmappedAuthorities = remittanceAuthorities.filter(
      (authority) => authority.status === "unmapped",
    );
    const invalidAuthorities = remittanceAuthorities.filter(
      (authority) =>
        authority.status === "configured_account_missing" ||
        authority.status === "configured_account_not_liability",
    );

    const recommendedNextActions: string[] = [];
    if (!mappingFile.present) {
      recommendedNextActions.push(
        "Create data/account-mapping/default.yaml from setup_account_mapping output.",
      );
    } else if (!mappingFile.matches_requested_jurisdiction) {
      recommendedNextActions.push(
        `Align data/account-mapping/default.yaml jurisdiction (${mappingFile.jurisdiction}) with the requested jurisdiction (${rates.jurisdiction}).`,
      );
    }
    for (const authority of remittanceAuthorities) {
      if (authority.status === "unmapped") {
        recommendedNextActions.push(
          `Map remittance_buckets.${authority.code}.payable_account_id to a liability account.`,
        );
      }
      if (authority.status === "configured_account_missing" && authority.configured_account_id) {
        recommendedNextActions.push(
          `Fix remittance_buckets.${authority.code}.payable_account_id: account '${authority.configured_account_id}' was not found in Wave.`,
        );
      }
      if (
        authority.status === "configured_account_not_liability" &&
        authority.configured_account_id !== null
      ) {
        recommendedNextActions.push(
          `Fix remittance_buckets.${authority.code}.payable_account_id: account '${authority.configured_account_id}' is not a liability account.`,
        );
      }
    }

    return {
      jurisdiction: rates.jurisdiction,
      mapping_file: mappingFile,
      remittance_authorities: remittanceAuthorities,
      cash_and_bank_accounts: cashAndBankAccounts,
      unused_liability_accounts: unusedLiabilityAccounts,
      summary: {
        mapped_authorities: mappedAuthorities.length,
        unmapped_authorities: unmappedAuthorities.length,
        invalid_authorities: invalidAuthorities.length,
        cash_and_bank_accounts: cashAndBankAccounts.length,
        unused_liability_accounts: unusedLiabilityAccounts.length,
      },
      recommended_next_actions: recommendedNextActions,
    };
  },
});
