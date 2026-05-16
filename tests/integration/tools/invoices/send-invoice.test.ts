import { graphql, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { ToolContext } from "../../../../src/server/tool-context.js";
import { sendInvoiceTool } from "../../../../src/tools/invoices/send-invoice.js";
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

describe("send_invoice", () => {
  it("forwards to/attachPDF and returns invoice_id with sent_at", async () => {
    let received: Record<string, unknown> | null = null;
    server.use(
      graphql.mutation("InvoiceSend", ({ variables }) => {
        received = variables as Record<string, unknown>;
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

    const r = (await sendInvoiceTool.handler(
      {
        invoice_id: "inv_1",
        to_email: ["billing@example.com", "ap@example.com"],
        subject: "Your invoice",
        message: "Please pay",
        cc_myself: true,
      },
      makeCtx(),
    )) as { invoice_id: string; sent_to: string[]; sent_at: string };

    expect(r.invoice_id).toBe("inv_1");
    expect(r.sent_to).toEqual(["billing@example.com", "ap@example.com"]);
    expect(typeof r.sent_at).toBe("string");
    expect(new Date(r.sent_at).toString()).not.toBe("Invalid Date");

    const input = (received as { input: Record<string, unknown> } | null)?.input;
    expect(input).toMatchObject({
      invoiceId: "inv_1",
      to: ["billing@example.com", "ap@example.com"],
      attachPDF: true,
      subject: "Your invoice",
      message: "Please pay",
      ccMyself: true,
    });
  });

  it("attach_pdf can be overridden to false", async () => {
    let received: Record<string, unknown> | null = null;
    server.use(
      graphql.mutation("InvoiceSend", ({ variables }) => {
        received = variables as Record<string, unknown>;
        return HttpResponse.json({
          data: { invoiceSend: { didSucceed: true, inputErrors: [] } },
        });
      }),
    );

    await sendInvoiceTool.handler(
      {
        invoice_id: "inv_2",
        to_email: ["x@y.com"],
        attach_pdf: false,
      },
      makeCtx(),
    );

    const input = (received as { input: Record<string, unknown> } | null)?.input;
    expect(input?.attachPDF).toBe(false);
  });
});
