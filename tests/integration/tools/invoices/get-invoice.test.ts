import { graphql, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { ToolContext } from "../../../../src/server/tool-context.js";
import { getInvoiceTool } from "../../../../src/tools/invoices/get-invoice.js";
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

describe("get_invoice", () => {
  it("returns the invoice flattened to snake_case with line items", async () => {
    server.use(
      graphql.query("GetInvoice", () =>
        HttpResponse.json({
          data: {
            business: {
              invoice: {
                id: "inv_1",
                invoiceNumber: "INV-001",
                status: "SENT",
                invoiceDate: "2026-05-01",
                dueDate: "2026-05-31",
                memo: "Thanks for your business",
                customer: { id: "cust_1", name: "Acme", email: "ap@acme.test" },
                currency: { code: "CAD" },
                items: [
                  {
                    product: { id: "prod_1", name: "Consulting" },
                    description: "Hourly work",
                    quantity: "2",
                    unitPrice: "100.00",
                    taxes: [
                      {
                        salesTax: { id: "tax_1", name: "GST", rate: "0.05" },
                        amount: { value: "10.00" },
                      },
                    ],
                    subtotal: { value: "200.00" },
                    total: { value: "210.00" },
                  },
                ],
                subtotal: { value: "200.00" },
                taxTotal: { value: "10.00" },
                total: { value: "210.00" },
                amountDue: { value: "210.00" },
                amountPaid: { value: "0.00" },
                pdfUrl: "https://wave.test/pdf/inv_1",
              },
            },
          },
        }),
      ),
    );

    const result = await getInvoiceTool.handler({ invoice_id: "inv_1" }, makeCtx());

    expect(result).toMatchObject({
      id: "inv_1",
      number: "INV-001",
      status: "SENT",
      invoice_date: "2026-05-01",
      due_date: "2026-05-31",
      memo: "Thanks for your business",
      customer: { id: "cust_1", name: "Acme", email: "ap@acme.test" },
      currency: "CAD",
      items: [
        {
          product: { id: "prod_1", name: "Consulting" },
          description: "Hourly work",
          quantity: "2",
          unit_price: "100.00",
          taxes: [
            {
              sales_tax: { id: "tax_1", name: "GST", rate: "0.05" },
              amount: "10.00",
            },
          ],
          subtotal: "200.00",
          total: "210.00",
        },
      ],
      subtotal: "200.00",
      tax_total: "10.00",
      total: "210.00",
      amount_due: "210.00",
      amount_paid: "0.00",
      pdf_url: "https://wave.test/pdf/inv_1",
    });
  });

  it("throws INVOICE_NOT_FOUND when business.invoice is null", async () => {
    server.use(
      graphql.query("GetInvoice", () =>
        HttpResponse.json({
          data: { business: { invoice: null } },
        }),
      ),
    );

    await expect(
      getInvoiceTool.handler({ invoice_id: "missing" }, makeCtx()),
    ).rejects.toMatchObject({ code: "INVOICE_NOT_FOUND" });
  });
});
