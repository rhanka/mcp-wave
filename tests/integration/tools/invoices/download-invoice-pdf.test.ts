import { graphql, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { ToolContext } from "../../../../src/server/tool-context.js";
import { downloadInvoicePdfTool } from "../../../../src/tools/invoices/download-invoice-pdf.js";
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

function invoicePayload(overrides: { pdfUrl: string | null }) {
  return {
    data: {
      business: {
        invoice: {
          id: "inv_1",
          invoiceNumber: "INV-001",
          status: "SENT",
          invoiceDate: "2026-05-01",
          dueDate: "2026-05-31",
          memo: null,
          customer: { id: "cust_1", name: "Acme", email: null },
          currency: { code: "CAD" },
          items: [],
          subtotal: { value: "0.00" },
          taxTotal: { value: "0.00" },
          total: { value: "0.00" },
          amountDue: { value: "0.00" },
          amountPaid: { value: "0.00" },
          pdfUrl: overrides.pdfUrl,
        },
      },
    },
  };
}

describe("download_invoice_pdf", () => {
  it("returns the pdf_url for an existing invoice", async () => {
    server.use(
      graphql.query("GetInvoice", () =>
        HttpResponse.json(invoicePayload({ pdfUrl: "https://wave.test/pdf/inv_1" })),
      ),
    );

    const result = await downloadInvoicePdfTool.handler({ invoice_id: "inv_1" }, makeCtx());

    expect(result).toEqual({
      invoice_id: "inv_1",
      invoice_number: "INV-001",
      pdf_url: "https://wave.test/pdf/inv_1",
    });
  });

  it("throws PDF_UNAVAILABLE when pdfUrl is null", async () => {
    server.use(
      graphql.query("GetInvoice", () => HttpResponse.json(invoicePayload({ pdfUrl: null }))),
    );

    await expect(
      downloadInvoicePdfTool.handler({ invoice_id: "inv_1" }, makeCtx()),
    ).rejects.toMatchObject({ code: "PDF_UNAVAILABLE" });
  });
});
