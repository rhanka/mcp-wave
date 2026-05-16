import { graphql, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { ToolContext } from "../../../../src/server/tool-context.js";
import { createInvoiceTool } from "../../../../src/tools/invoices/create-invoice.js";
import { MockProvider } from "../../../../src/wave/auth/mock.js";
import { WaveClient } from "../../../../src/wave/client.js";

const ENDPOINT = "https://gql.waveapps.com/graphql/public";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function makeCtx(): ToolContext {
  return {
    req: { headers: null, request_id: "test" },
    wave: new WaveClient({ endpoint: ENDPOINT, provider: new MockProvider("x") }),
    taxRates: {} as never,
    accountMapping: {} as never,
    env: { WAVE_DEFAULT_BUSINESS_ID: "biz_x" } as never,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never,
    identity: "mock",
  };
}

const VALID_INPUT = {
  customer_id: "cust_1",
  currency: "CAD",
  invoice_date: "2026-05-15",
  items: [
    {
      product_id: "prod_1",
      description: "Consulting",
      quantity: 2,
      unit_price: 100,
      tax_ids: ["tax_1"],
    },
  ],
};

describe("create_invoice", () => {
  it("creates a DRAFT invoice and returns id, status, pdf_url and totals", async () => {
    let received: Record<string, unknown> | null = null;
    server.use(
      graphql.mutation("InvoiceCreate", ({ variables }) => {
        received = variables as Record<string, unknown>;
        return HttpResponse.json({
          data: {
            invoiceCreate: {
              didSucceed: true,
              inputErrors: [],
              invoice: {
                id: "inv_new",
                invoiceNumber: "INV-100",
                status: "DRAFT",
                pdfUrl: "https://wave.test/pdf/inv_new",
                total: { value: "210.00" },
                subtotal: { value: "200.00" },
                taxTotal: { value: "10.00" },
              },
            },
          },
        });
      }),
    );

    const r = (await createInvoiceTool.handler(VALID_INPUT, makeCtx())) as {
      invoice_id: string;
      status: string;
      pdf_url: string;
      totals: { subtotal: number; tax_total: number; total: number; currency: string };
    };

    expect(r).toEqual({
      invoice_id: "inv_new",
      invoice_number: "INV-100",
      status: "DRAFT",
      pdf_url: "https://wave.test/pdf/inv_new",
      totals: {
        subtotal: 200,
        tax_total: 10,
        total: 210,
        currency: "CAD",
      },
    });

    const input = (received as { input: Record<string, unknown> } | null)?.input;
    expect(input).toMatchObject({
      businessId: "biz_x",
      customerId: "cust_1",
      currency: "CAD",
      invoiceDate: "2026-05-15",
    });
    const items = input?.items as Array<Record<string, unknown>>;
    expect(items[0]).toMatchObject({
      productId: "prod_1",
      description: "Consulting",
      quantity: "2",
      unitPrice: "100",
      taxes: [{ salesTaxId: "tax_1" }],
    });
  });

  it("throws WAVE_VALIDATION_ERROR when InvoiceCreate did not succeed", async () => {
    server.use(
      graphql.mutation("InvoiceCreate", () =>
        HttpResponse.json({
          data: {
            invoiceCreate: {
              didSucceed: false,
              inputErrors: [
                { code: "REQUIRED", message: "Customer required", path: ["customerId"] },
              ],
              invoice: null,
            },
          },
        }),
      ),
    );

    await expect(createInvoiceTool.handler(VALID_INPUT, makeCtx())).rejects.toMatchObject({
      code: "WAVE_VALIDATION_ERROR",
    });
  });
});
