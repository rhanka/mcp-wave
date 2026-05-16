import { z } from "zod";
import { ToolError } from "../../lib/errors.js";
import { defineTool } from "../../server/define-tool.js";
import type { ProductCreateInput, ProductPatchInput } from "../../wave/generated/sdk.js";
import { throwIfInputErrors } from "../../wave/payload-errors.js";

export const upsertProductTool = defineTool({
  name: "upsert_product",
  description:
    "Create a new product (when `product_id` is omitted) or patch an existing one. unit_price is decimal; tax IDs apply default taxes for invoices using this product.",
  inputSchema: z.object({
    business_id: z.string().min(1).optional(),
    product_id: z.string().min(1).optional(),
    name: z.string().min(1).optional(),
    unit_price: z.number().nonnegative().optional(),
    description: z.string().optional(),
    income_account_id: z.string().min(1).optional(),
    expense_account_id: z.string().min(1).optional(),
    default_sales_tax_ids: z.array(z.string().min(1)).optional(),
  }),
  async execute(input, ctx) {
    if (input.product_id) {
      const patchInput: ProductPatchInput = { id: input.product_id };
      if (input.name !== undefined) patchInput.name = input.name;
      if (input.unit_price !== undefined) patchInput.unitPrice = String(input.unit_price);
      if (input.description !== undefined) patchInput.description = input.description;
      if (input.income_account_id !== undefined)
        patchInput.incomeAccountId = input.income_account_id;
      if (input.expense_account_id !== undefined)
        patchInput.expenseAccountId = input.expense_account_id;
      if (input.default_sales_tax_ids !== undefined)
        patchInput.defaultSalesTaxIds = input.default_sales_tax_ids;

      const r = await ctx.wave.productPatch(ctx.req, { input: patchInput });
      throwIfInputErrors(r.productPatch, "ProductPatch");

      const product = r.productPatch.product as
        | { id: string; name: string; unitPrice: string }
        | null
        | undefined;
      if (!product) {
        throw new ToolError(
          "PRODUCT_NOT_RETURNED",
          { operation: "ProductPatch" },
          "Wave reported success but did not return the product.",
        );
      }
      return {
        product_id: product.id,
        name: product.name,
        unit_price: product.unitPrice,
        action: "patched" as const,
      };
    }

    const businessId = input.business_id ?? ctx.env.WAVE_DEFAULT_BUSINESS_ID;
    if (!businessId) {
      throw new ToolError(
        "BUSINESS_ID_REQUIRED",
        {},
        "Pass business_id or set WAVE_DEFAULT_BUSINESS_ID in the environment.",
      );
    }

    if (input.name === undefined || input.unit_price === undefined) {
      throw new ToolError(
        "INVALID_INPUT",
        { reason: "name and unit_price required when creating" },
        "Provide both `name` and `unit_price` to create a new product.",
      );
    }

    const createInput: ProductCreateInput = {
      businessId,
      name: input.name,
      unitPrice: String(input.unit_price),
    };
    if (input.description !== undefined) createInput.description = input.description;
    if (input.income_account_id !== undefined)
      createInput.incomeAccountId = input.income_account_id;
    if (input.expense_account_id !== undefined)
      createInput.expenseAccountId = input.expense_account_id;
    if (input.default_sales_tax_ids !== undefined)
      createInput.defaultSalesTaxIds = input.default_sales_tax_ids;

    const r = await ctx.wave.productCreate(ctx.req, { input: createInput });
    throwIfInputErrors(r.productCreate, "ProductCreate");

    const product = r.productCreate.product as
      | { id: string; name: string; unitPrice: string }
      | null
      | undefined;
    if (!product) {
      throw new ToolError(
        "PRODUCT_NOT_RETURNED",
        { operation: "ProductCreate" },
        "Wave reported success but did not return the product.",
      );
    }
    return {
      product_id: product.id,
      name: product.name,
      unit_price: product.unitPrice,
      action: "created" as const,
    };
  },
});
