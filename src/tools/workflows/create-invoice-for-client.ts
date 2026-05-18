import { z } from "zod";
import { parseProfileFromNotes } from "../../domain/client-profiles/parse-from-notes.js";
import type { ClientProfile } from "../../domain/client-profiles/schema.js";
import { computeInvoiceTotals } from "../../domain/invoice-templating/compute-totals.js";
import { renderLines } from "../../domain/invoice-templating/render-lines.js";
import { resolveSalesTaxes } from "../../domain/invoice-templating/resolve-sales-taxes.js";
import { ToolError } from "../../lib/errors.js";
import { isoToday, plusDays } from "../../lib/time.js";
import { defineTool } from "../../server/define-tool.js";
import type { ToolContext } from "../../server/tool-context.js";
import { throwIfInputErrors } from "../../wave/payload-errors.js";

const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");

export const createInvoiceForClientTool = defineTool({
  name: "create_invoice_for_client",
  description:
    "Create a DRAFT invoice for a customer selected by mcp-wave alias. Resolves profile defaults and Wave sales taxes, computes totals deterministically, then creates one invoice. Not idempotent.",
  inputSchema: z.object({
    business_id: z.string().optional(),
    alias: z.string().min(1),
    quantity: z.number().positive(),
    period_label: z.string().optional(),
    invoice_date: isoDateSchema.optional(),
    due_date: isoDateSchema.optional(),
    override_unit_price: z.number().positive().optional(),
    send_immediately: z.boolean().default(false),
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

    const found = await findCustomerProfileByAlias(businessId, input.alias, ctx);
    if (found === null) {
      throw new ToolError("BUSINESS_NOT_FOUND", { business_id: businessId });
    }
    if (found.profile === null) {
      throw new ToolError(
        "ALIAS_NOT_FOUND",
        { alias: input.alias, available_aliases: found.availableAliases },
        "Use list_client_profiles to see available aliases.",
      );
    }

    const { customer, profile } = found.profile;
    if (profile.currency !== customer.currency) {
      throw new ToolError("CURRENCY_MISMATCH", {
        alias: input.alias,
        profile_currency: profile.currency,
        customer_currency: customer.currency,
      });
    }

    const taxList = await ctx.wave.listSalesTaxes(ctx.req, { businessId });
    if (!taxList.business) {
      throw new ToolError("BUSINESS_NOT_FOUND", { business_id: businessId });
    }
    const taxes = (taxList.business.salesTaxes?.edges ?? [])
      .map((edge) => edge.node)
      .filter((tax): tax is NonNullable<typeof tax> => tax !== null)
      .map((tax) => ({
        id: tax.id,
        name: tax.name,
        abbreviation: tax.abbreviation,
        rate: Number(tax.rate),
      }));
    const resolved = resolveSalesTaxes(profile.default_taxes, taxes);
    if (resolved.unresolved.length > 0) {
      throw new ToolError("TAX_CODE_NOT_RESOLVED", {
        unresolved: resolved.unresolved,
        available: taxes.map((tax) => tax.abbreviation ?? tax.name),
      });
    }

    const renderInput: Parameters<typeof renderLines>[0] = {
      profile,
      quantity: input.quantity,
    };
    if (input.period_label !== undefined) renderInput.period_label = input.period_label;
    if (input.override_unit_price !== undefined) {
      renderInput.override_unit_price = input.override_unit_price;
    }
    const renderedLines = renderLines(renderInput);

    const missingProductLine = renderedLines.findIndex((line) => line.product_id === undefined);
    if (missingProductLine !== -1) {
      throw new ToolError(
        "MISSING_PRODUCT_ID",
        { alias: input.alias, line_index: missingProductLine },
        "Set default_product_id in the client profile before creating invoices from an alias.",
      );
    }

    const taxCodeToId = new Map<string, string>();
    const totalsTaxRefs = [];
    for (const tax of resolved.matched) {
      if (tax.abbreviation !== null) {
        taxCodeToId.set(tax.abbreviation.toLowerCase(), tax.id);
        totalsTaxRefs.push({ code: tax.abbreviation, rate: tax.rate });
      }
      taxCodeToId.set(tax.name.toLowerCase(), tax.id);
      totalsTaxRefs.push({ code: tax.name, rate: tax.rate });
    }

    const totals = computeInvoiceTotals({
      lines: renderedLines.map((line) => ({
        quantity: line.quantity,
        unit_price: line.unit_price,
        tax_codes: line.tax_codes,
      })),
      taxes: totalsTaxRefs,
      currency: customer.currency,
    });

    const invoiceDate = input.invoice_date ?? isoToday();
    const dueDate = input.due_date ?? plusDays(invoiceDate, profile.payment_terms_days);
    const invoiceInput: Record<string, unknown> = {
      businessId,
      customerId: customer.id,
      currency: customer.currency,
      invoiceDate,
      dueDate,
      items: renderedLines.map((line) => ({
        productId: line.product_id,
        description: line.description,
        quantity: String(line.quantity),
        unitPrice: String(line.unit_price),
        taxes: line.tax_codes.map((code) => {
          const salesTaxId = taxCodeToId.get(code.toLowerCase());
          if (salesTaxId === undefined) {
            throw new ToolError("TAX_CODE_NOT_RESOLVED", {
              unresolved: [code],
              available: taxes.map((tax) => tax.abbreviation ?? tax.name),
            });
          }
          return { salesTaxId };
        }),
      })),
    };
    if (profile.invoice_notes !== undefined) {
      invoiceInput.memo = profile.invoice_notes;
    }

    const created = await ctx.wave.invoiceCreate(ctx.req, { input: invoiceInput as never });
    throwIfInputErrors(created.invoiceCreate ?? undefined, "InvoiceCreate");
    const invoice = created.invoiceCreate?.invoice;
    if (!invoice) {
      throw new ToolError("WAVE_NO_INVOICE", { op: "InvoiceCreate" });
    }

    const result = {
      invoice_id: invoice.id,
      invoice_number: invoice.invoiceNumber,
      status: invoice.status,
      customer: { id: customer.id, name: customer.name },
      totals,
      pdf_url: invoice.pdfUrl,
    };

    if (!input.send_immediately) {
      return result;
    }

    try {
      const sent = await ctx.wave.invoiceSend(ctx.req, {
        input: {
          invoiceId: invoice.id,
          to: profile.send_to,
          attachPDF: true,
        },
      });
      throwIfInputErrors(sent.invoiceSend ?? undefined, "InvoiceSend");
      return { ...result, status: "SENT" };
    } catch (error) {
      if (error instanceof ToolError) {
        throw new ToolError(
          error.code,
          {
            ...error.details,
            step_failed: "send_invoice",
            completed_steps: ["create_invoice"],
            partial_state: { invoice_id: invoice.id, status: "DRAFT" },
          },
          "DRAFT was created. Fix recipients and call send_invoice, or delete_invoice to abandon it.",
        );
      }
      throw error;
    }
  },
});

interface FoundCustomerProfile {
  customer: {
    id: string;
    name: string;
    currency: string;
  };
  profile: ClientProfile;
}

async function findCustomerProfileByAlias(
  businessId: string,
  alias: string,
  ctx: ToolContext,
): Promise<{ availableAliases: string[]; profile: FoundCustomerProfile | null } | null> {
  const availableAliases: string[] = [];
  let page = 1;

  while (true) {
    const result = await ctx.wave.listCustomers(ctx.req, { businessId, page, pageSize: 100 });
    if (!result.business) return null;

    const connection = result.business.customers;
    if (!connection) break;

    for (const edge of connection.edges) {
      if (!edge.node) continue;
      const parsed = parseProfileFromNotes(edge.node.internalNotes);
      if (parsed.kind !== "ok") continue;

      availableAliases.push(parsed.profile.alias);
      if (parsed.profile.alias === alias) {
        const currency = edge.node.currency?.code;
        if (currency === undefined) {
          continue;
        }
        return {
          availableAliases,
          profile: {
            customer: {
              id: edge.node.id,
              name: edge.node.name,
              currency,
            },
            profile: parsed.profile,
          },
        };
      }
    }

    const totalPages = connection.pageInfo.totalPages ?? page;
    if (page >= totalPages) break;
    page += 1;
  }

  return { availableAliases, profile: null };
}
