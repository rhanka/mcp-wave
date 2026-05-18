import { graphql, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { ToolContext } from "../../../../src/server/tool-context.js";
import { createInvoiceForClientTool } from "../../../../src/tools/workflows/create-invoice-for-client.js";
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

function customerProfileNotes(profile: string): string {
  return `---mcp-wave---
${profile}
---mcp-wave---`;
}

describe("create_invoice_for_client", () => {
  it("creates a draft invoice from a customer alias and profile defaults", async () => {
    let invoiceCreateInput: Record<string, unknown> | null = null;

    server.use(
      graphql.query("ListCustomers", () =>
        HttpResponse.json({
          data: {
            business: {
              customers: {
                pageInfo: { currentPage: 1, totalPages: 1, totalCount: 1 },
                edges: [
                  {
                    node: {
                      id: "cust_acme",
                      name: "Acme Inc.",
                      email: "billing@acme.com",
                      currency: { code: "CAD" },
                      internalNotes: customerProfileNotes(`alias: acme
unit: hours
hourly_rate: 95
currency: CAD
default_product_id: prod_consulting
default_description: Consulting hours
default_taxes: [GST, QST]
send_to: [billing@acme.com]
payment_terms_days: 30`),
                    },
                  },
                ],
              },
            },
          },
        }),
      ),
      graphql.query("ListSalesTaxes", () =>
        HttpResponse.json({
          data: {
            business: {
              salesTaxes: {
                edges: [
                  {
                    node: {
                      id: "tax_gst",
                      name: "Goods and Services Tax",
                      abbreviation: "GST",
                      rate: "0.05",
                    },
                  },
                  {
                    node: {
                      id: "tax_qst",
                      name: "Quebec Sales Tax",
                      abbreviation: "QST",
                      rate: "0.09975",
                    },
                  },
                ],
              },
            },
          },
        }),
      ),
      graphql.mutation("InvoiceCreate", ({ variables }) => {
        invoiceCreateInput = (variables as { input: Record<string, unknown> }).input;
        return HttpResponse.json({
          data: {
            invoiceCreate: {
              didSucceed: true,
              inputErrors: [],
              invoice: {
                id: "inv_1",
                invoiceNumber: "0001",
                status: "DRAFT",
                pdfUrl: "https://wave.example/pdf",
                subtotal: { value: "2185.00" },
                taxTotal: { value: "327.20" },
                total: { value: "2512.20" },
              },
            },
          },
        });
      }),
    );

    const result = (await createInvoiceForClientTool.handler(
      {
        alias: "acme",
        quantity: 23,
        period_label: "November 2026",
        invoice_date: "2026-11-30",
      },
      makeCtx(),
    )) as {
      invoice_id: string;
      invoice_number: string;
      status: string;
      customer: { id: string; name: string };
      totals: { subtotal: number; total: number; currency: string };
      pdf_url: string;
    };

    expect(result).toMatchObject({
      invoice_id: "inv_1",
      invoice_number: "0001",
      status: "DRAFT",
      customer: { id: "cust_acme", name: "Acme Inc." },
      pdf_url: "https://wave.example/pdf",
      totals: {
        subtotal: 2185,
        total: 2512.2,
        currency: "CAD",
      },
    });

    const capturedInvoiceCreateInput = invoiceCreateInput as Record<string, unknown> | null;
    if (capturedInvoiceCreateInput === null) {
      throw new Error("Expected InvoiceCreate variables to be captured");
    }

    expect(capturedInvoiceCreateInput).toMatchObject({
      businessId: "biz_x",
      customerId: "cust_acme",
      currency: "CAD",
      invoiceDate: "2026-11-30",
      dueDate: "2026-12-30",
    });
    const items = capturedInvoiceCreateInput.items as Array<Record<string, unknown>>;
    expect(items[0]).toMatchObject({
      productId: "prod_consulting",
      description: "Consulting hours — November 2026",
      quantity: "23",
      unitPrice: "95",
      taxes: [{ salesTaxId: "tax_gst" }, { salesTaxId: "tax_qst" }],
    });
  });

  it("reports available aliases when the requested alias is unknown", async () => {
    server.use(
      graphql.query("ListCustomers", () =>
        HttpResponse.json({
          data: {
            business: {
              customers: {
                pageInfo: { currentPage: 1, totalPages: 1, totalCount: 1 },
                edges: [
                  {
                    node: {
                      id: "cust_acme",
                      name: "Acme Inc.",
                      email: "billing@acme.com",
                      currency: { code: "CAD" },
                      internalNotes: customerProfileNotes(`alias: acme
currency: CAD
send_to: [billing@acme.com]`),
                    },
                  },
                ],
              },
            },
          },
        }),
      ),
    );

    await expect(
      createInvoiceForClientTool.handler({ alias: "missing", quantity: 10 }, makeCtx()),
    ).rejects.toMatchObject({
      code: "ALIAS_NOT_FOUND",
      details: { alias: "missing", available_aliases: ["acme"] },
    });
  });

  it("rejects profile tax codes that do not exist in Wave sales taxes", async () => {
    server.use(
      graphql.query("ListCustomers", () =>
        HttpResponse.json({
          data: {
            business: {
              customers: {
                pageInfo: { currentPage: 1, totalPages: 1, totalCount: 1 },
                edges: [
                  {
                    node: {
                      id: "cust_acme",
                      name: "Acme Inc.",
                      email: "billing@acme.com",
                      currency: { code: "CAD" },
                      internalNotes: customerProfileNotes(`alias: acme
hourly_rate: 95
currency: CAD
default_product_id: prod_consulting
default_taxes: [GST, VAT]
send_to: [billing@acme.com]`),
                    },
                  },
                ],
              },
            },
          },
        }),
      ),
      graphql.query("ListSalesTaxes", () =>
        HttpResponse.json({
          data: {
            business: {
              salesTaxes: {
                edges: [
                  {
                    node: {
                      id: "tax_gst",
                      name: "Goods and Services Tax",
                      abbreviation: "GST",
                      rate: "0.05",
                    },
                  },
                ],
              },
            },
          },
        }),
      ),
    );

    await expect(
      createInvoiceForClientTool.handler({ alias: "acme", quantity: 10 }, makeCtx()),
    ).rejects.toMatchObject({
      code: "TAX_CODE_NOT_RESOLVED",
      details: { unresolved: ["VAT"], available: ["GST"] },
    });
  });

  it("sends immediately and forwards optional invoice fields", async () => {
    let invoiceCreateInput: Record<string, unknown> | null = null;
    let invoiceSendInput: Record<string, unknown> | null = null;

    server.use(
      graphql.query("ListCustomers", () =>
        HttpResponse.json({
          data: {
            business: {
              customers: {
                pageInfo: { currentPage: 1, totalPages: 1, totalCount: 1 },
                edges: [
                  {
                    node: {
                      id: "cust_acme",
                      name: "Acme Inc.",
                      email: "billing@acme.com",
                      currency: { code: "CAD" },
                      internalNotes: customerProfileNotes(`alias: acme
unit: hours
hourly_rate: 95
currency: CAD
default_product_id: prod_consulting
default_description: Consulting hours
default_taxes: [Goods and Services Tax]
send_to: [billing@acme.com]
payment_terms_days: 15
invoice_notes: Thank you for your business.`),
                    },
                  },
                ],
              },
            },
          },
        }),
      ),
      graphql.query("ListSalesTaxes", () =>
        HttpResponse.json({
          data: {
            business: {
              salesTaxes: {
                edges: [
                  {
                    node: {
                      id: "tax_gst",
                      name: "Goods and Services Tax",
                      abbreviation: null,
                      rate: "0.05",
                    },
                  },
                ],
              },
            },
          },
        }),
      ),
      graphql.mutation("InvoiceCreate", ({ variables }) => {
        invoiceCreateInput = (variables as { input: Record<string, unknown> }).input;
        return HttpResponse.json({
          data: {
            invoiceCreate: {
              didSucceed: true,
              inputErrors: [],
              invoice: {
                id: "inv_sent",
                invoiceNumber: "0002",
                status: "DRAFT",
                pdfUrl: "https://wave.example/sent.pdf",
                subtotal: { value: "240.00" },
                taxTotal: { value: "12.00" },
                total: { value: "252.00" },
              },
            },
          },
        });
      }),
      graphql.mutation("InvoiceSend", ({ variables }) => {
        invoiceSendInput = (variables as { input: Record<string, unknown> }).input;
        return HttpResponse.json({
          data: {
            invoiceSend: {
              didSucceed: true,
              inputErrors: [],
            },
          },
        });
      }),
    );

    const result = (await createInvoiceForClientTool.handler(
      {
        alias: "acme",
        quantity: 2,
        invoice_date: "2026-12-01",
        due_date: "2026-12-20",
        override_unit_price: 120,
        send_immediately: true,
      },
      makeCtx(),
    )) as { status: string };

    expect(result.status).toBe("SENT");
    const capturedInvoiceCreateInput = invoiceCreateInput as Record<string, unknown> | null;
    expect(capturedInvoiceCreateInput).toMatchObject({
      invoiceDate: "2026-12-01",
      dueDate: "2026-12-20",
      memo: "Thank you for your business.",
    });
    if (capturedInvoiceCreateInput === null) {
      throw new Error("Expected InvoiceCreate variables to be captured");
    }
    const items = capturedInvoiceCreateInput.items as Array<Record<string, unknown>>;
    expect(items[0]).toMatchObject({
      unitPrice: "120",
      taxes: [{ salesTaxId: "tax_gst" }],
    });
    expect(invoiceSendInput).toEqual({
      invoiceId: "inv_sent",
      to: ["billing@acme.com"],
      attachPDF: true,
    });
  });

  it("returns partial invoice state when immediate send fails", async () => {
    server.use(
      graphql.query("ListCustomers", () =>
        HttpResponse.json({
          data: {
            business: {
              customers: {
                pageInfo: { currentPage: 1, totalPages: 1, totalCount: 1 },
                edges: [
                  {
                    node: {
                      id: "cust_acme",
                      name: "Acme Inc.",
                      email: "billing@acme.com",
                      currency: { code: "CAD" },
                      internalNotes: customerProfileNotes(`alias: acme
hourly_rate: 95
currency: CAD
default_product_id: prod_consulting
send_to: [billing@acme.com]`),
                    },
                  },
                ],
              },
            },
          },
        }),
      ),
      graphql.query("ListSalesTaxes", () =>
        HttpResponse.json({
          data: {
            business: {
              salesTaxes: { edges: [] },
            },
          },
        }),
      ),
      graphql.mutation("InvoiceCreate", () =>
        HttpResponse.json({
          data: {
            invoiceCreate: {
              didSucceed: true,
              inputErrors: [],
              invoice: {
                id: "inv_draft",
                invoiceNumber: "0003",
                status: "DRAFT",
                pdfUrl: "https://wave.example/draft.pdf",
                subtotal: { value: "95.00" },
                taxTotal: { value: "0.00" },
                total: { value: "95.00" },
              },
            },
          },
        }),
      ),
      graphql.mutation("InvoiceSend", () =>
        HttpResponse.json({
          data: {
            invoiceSend: {
              didSucceed: false,
              inputErrors: [{ code: "INVALID_EMAIL", message: "bad recipient", path: ["to"] }],
            },
          },
        }),
      ),
    );

    await expect(
      createInvoiceForClientTool.handler(
        { alias: "acme", quantity: 1, send_immediately: true },
        makeCtx(),
      ),
    ).rejects.toMatchObject({
      code: "WAVE_VALIDATION_ERROR",
      details: {
        step_failed: "send_invoice",
        completed_steps: ["create_invoice"],
        partial_state: { invoice_id: "inv_draft", status: "DRAFT" },
      },
    });
  });

  it("rejects a profile currency that differs from the Wave customer currency", async () => {
    server.use(
      graphql.query("ListCustomers", () =>
        HttpResponse.json({
          data: {
            business: {
              customers: {
                pageInfo: { currentPage: 1, totalPages: 1, totalCount: 1 },
                edges: [
                  {
                    node: {
                      id: "cust_acme",
                      name: "Acme Inc.",
                      email: "billing@acme.com",
                      currency: { code: "CAD" },
                      internalNotes: customerProfileNotes(`alias: acme
hourly_rate: 95
currency: USD
default_product_id: prod_consulting
send_to: [billing@acme.com]`),
                    },
                  },
                ],
              },
            },
          },
        }),
      ),
    );

    await expect(
      createInvoiceForClientTool.handler({ alias: "acme", quantity: 1 }, makeCtx()),
    ).rejects.toMatchObject({
      code: "CURRENCY_MISMATCH",
      details: { profile_currency: "USD", customer_currency: "CAD" },
    });
  });

  it("rejects profiles that do not define a default product", async () => {
    server.use(
      graphql.query("ListCustomers", () =>
        HttpResponse.json({
          data: {
            business: {
              customers: {
                pageInfo: { currentPage: 1, totalPages: 1, totalCount: 1 },
                edges: [
                  {
                    node: {
                      id: "cust_acme",
                      name: "Acme Inc.",
                      email: "billing@acme.com",
                      currency: { code: "CAD" },
                      internalNotes: customerProfileNotes(`alias: acme
hourly_rate: 95
currency: CAD
send_to: [billing@acme.com]`),
                    },
                  },
                ],
              },
            },
          },
        }),
      ),
      graphql.query("ListSalesTaxes", () =>
        HttpResponse.json({
          data: {
            business: {
              salesTaxes: { edges: [] },
            },
          },
        }),
      ),
    );

    await expect(
      createInvoiceForClientTool.handler({ alias: "acme", quantity: 1 }, makeCtx()),
    ).rejects.toMatchObject({
      code: "MISSING_PRODUCT_ID",
      details: { alias: "acme", line_index: 0 },
    });
  });
});
