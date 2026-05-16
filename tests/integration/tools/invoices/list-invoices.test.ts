import { graphql, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { ToolContext } from "../../../../src/server/tool-context.js";
import { listInvoicesTool } from "../../../../src/tools/invoices/list-invoices.js";
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

describe("list_invoices", () => {
  it("returns invoices with snake_case keys and flattened Money values", async () => {
    server.use(
      graphql.query("ListInvoices", () =>
        HttpResponse.json({
          data: {
            business: {
              invoices: {
                pageInfo: { currentPage: 1, totalPages: 1, totalCount: 1 },
                edges: [
                  {
                    node: {
                      id: "inv_1",
                      invoiceNumber: "INV-001",
                      status: "SENT",
                      invoiceDate: "2026-05-01",
                      dueDate: "2026-05-31",
                      customer: { id: "cust_1", name: "Acme Corp" },
                      currency: { code: "CAD" },
                      total: { value: "123.45" },
                      amountDue: { value: "100.00" },
                    },
                  },
                ],
              },
            },
          },
        }),
      ),
    );

    const result = await listInvoicesTool.handler({}, makeCtx());

    expect(result).toMatchObject({
      invoices: [
        {
          id: "inv_1",
          number: "INV-001",
          status: "SENT",
          customer: { id: "cust_1", name: "Acme Corp" },
          currency: "CAD",
          total: "123.45",
          amount_due: "100.00",
          invoice_date: "2026-05-01",
          due_date: "2026-05-31",
        },
      ],
      page_info: { current_page: 1, total_pages: 1, total_count: 1 },
    });
  });

  it("forwards filter arguments to the Wave query", async () => {
    let received: Record<string, unknown> | null = null;
    server.use(
      graphql.query("ListInvoices", ({ variables }) => {
        received = variables as Record<string, unknown>;
        return HttpResponse.json({
          data: {
            business: {
              invoices: {
                pageInfo: { currentPage: 2, totalPages: 5, totalCount: 99 },
                edges: [],
              },
            },
          },
        });
      }),
    );

    await listInvoicesTool.handler(
      {
        business_id: "biz_other",
        status: "PAID",
        customer_id: "cust_42",
        date_from: "2026-01-01",
        date_to: "2026-03-31",
        currency: "USD",
        page: 2,
        page_size: 25,
      },
      makeCtx(),
    );

    expect(received).toMatchObject({
      businessId: "biz_other",
      status: "PAID",
      customerId: "cust_42",
      currency: "USD",
      invoiceDateStart: "2026-01-01",
      invoiceDateEnd: "2026-03-31",
      page: 2,
      pageSize: 25,
    });
  });

  it("throws BUSINESS_ID_REQUIRED when no business_id is available", async () => {
    const ctx: ToolContext = {
      req: { headers: null, request_id: "test" },
      wave: new WaveClient({ endpoint: ENDPOINT, provider: new MockProvider("x") }),
      taxRates: {} as never,
      accountMapping: {} as never,
      env: {} as never,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never,
      identity: "mock",
    };
    await expect(listInvoicesTool.handler({}, ctx)).rejects.toMatchObject({
      code: "BUSINESS_ID_REQUIRED",
    });
  });
});
