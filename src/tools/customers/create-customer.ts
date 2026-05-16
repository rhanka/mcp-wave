import { z } from "zod";
import { ToolError } from "../../lib/errors.js";
import { defineTool } from "../../server/define-tool.js";
import type {
  AddressInput,
  CountryCode,
  CurrencyCode,
  CustomerCreateInput,
} from "../../wave/generated/sdk.js";
import { throwIfInputErrors } from "../../wave/payload-errors.js";

const addressSchema = z
  .object({
    address_line1: z.string().optional(),
    city: z.string().optional(),
    province: z.string().optional(),
    postal_code: z.string().optional(),
    country_code: z.string().length(2).optional(),
  })
  .strict();

export const createCustomerTool = defineTool({
  name: "create_customer",
  description:
    "Create a customer in Wave for a business. Optionally seed an mcp-wave profile in `internalNotes` via `notes_yaml` — the YAML body is wrapped between `---mcp-wave---` markers and becomes parseable by `list_client_profiles`.",
  inputSchema: z.object({
    business_id: z.string().optional(),
    name: z.string().min(1),
    email: z.string().email().optional(),
    currency: z.string().length(3).optional(),
    first_name: z.string().optional(),
    last_name: z.string().optional(),
    address: addressSchema.optional(),
    notes_yaml: z.string().optional(),
  }),
  async execute(input, ctx) {
    const businessId = input.business_id ?? ctx.env.WAVE_DEFAULT_BUSINESS_ID;
    if (!businessId) throw new ToolError("BUSINESS_ID_REQUIRED", {});

    const createInput: CustomerCreateInput = {
      businessId,
      name: input.name,
    };

    if (input.email !== undefined) createInput.email = input.email;
    if (input.currency !== undefined) {
      createInput.currency = input.currency as CurrencyCode;
    }
    if (input.first_name !== undefined) createInput.firstName = input.first_name;
    if (input.last_name !== undefined) createInput.lastName = input.last_name;

    if (input.address) {
      const a = input.address;
      const address: AddressInput = {};
      if (a.address_line1 !== undefined) address.addressLine1 = a.address_line1;
      if (a.city !== undefined) address.city = a.city;
      if (a.province !== undefined) address.provinceCode = a.province;
      if (a.postal_code !== undefined) address.postalCode = a.postal_code;
      if (a.country_code !== undefined) {
        address.countryCode = a.country_code as CountryCode;
      }
      createInput.address = address;
    }

    if (input.notes_yaml !== undefined) {
      const trimmed = input.notes_yaml.trim();
      createInput.internalNotes = `---mcp-wave---\n${trimmed}\n---mcp-wave---`;
    }

    const r = await ctx.wave.customerCreate(ctx.req, { input: createInput });
    throwIfInputErrors(r.customerCreate, "CustomerCreate");

    const customer = r.customerCreate?.customer;
    if (!customer) {
      throw new ToolError("WAVE_EMPTY_CUSTOMER", { operation: "CustomerCreate" });
    }

    return {
      customer_id: customer.id,
      name: customer.name,
      email: customer.email,
      currency: customer.currency?.code ?? null,
      internal_notes_raw: customer.internalNotes,
    };
  },
});
