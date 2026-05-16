import { graphql, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { ToolContext } from "../../../../src/server/tool-context.js";
import { markInvoicePaidTool } from "../../../../src/tools/invoices/mark-invoice-paid.js";
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

describe("mark_invoice_paid", () => {
  it("records the payment and defaults exchange_rate to 1", async () => {
    let received: Record<string, unknown> | null = null;
    server.use(
      graphql.mutation("InvoicePaymentCreateManual", ({ variables }) => {
        received = variables as Record<string, unknown>;
        return HttpResponse.json({
          data: {
            invoicePaymentCreateManual: {
              didSucceed: true,
              inputErrors: [],
              invoicePayment: {
                id: "pay_1",
                amount: "210.00",
                paymentDate: "2026-05-15",
                paymentMethod: "BANK_TRANSFER",
                memo: "Wire from Acme",
              },
            },
          },
        });
      }),
    );

    const r = (await markInvoicePaidTool.handler(
      {
        invoice_id: "inv_1",
        amount: 210,
        paid_at: "2026-05-15",
        payment_account_id: "acct_bank",
        payment_method: "BANK_TRANSFER",
        memo: "Wire from Acme",
      },
      makeCtx(),
    )) as {
      payment_id: string;
      amount: number;
      payment_date: string;
      payment_method: string;
      memo: string | null;
    };

    expect(r).toEqual({
      payment_id: "pay_1",
      amount: 210,
      payment_date: "2026-05-15",
      payment_method: "BANK_TRANSFER",
      memo: "Wire from Acme",
    });

    const input = (received as { input: Record<string, unknown> } | null)?.input;
    expect(input).toMatchObject({
      invoiceId: "inv_1",
      amount: "210",
      exchangeRate: "1",
      paymentAccountId: "acct_bank",
      paymentDate: "2026-05-15",
      paymentMethod: "BANK_TRANSFER",
      memo: "Wire from Acme",
    });
  });

  it("forwards a custom exchange_rate as a string", async () => {
    let received: Record<string, unknown> | null = null;
    server.use(
      graphql.mutation("InvoicePaymentCreateManual", ({ variables }) => {
        received = variables as Record<string, unknown>;
        return HttpResponse.json({
          data: {
            invoicePaymentCreateManual: {
              didSucceed: true,
              inputErrors: [],
              invoicePayment: {
                id: "pay_2",
                amount: "100.00",
                paymentDate: "2026-05-15",
                paymentMethod: "CASH",
                memo: null,
              },
            },
          },
        });
      }),
    );

    await markInvoicePaidTool.handler(
      {
        invoice_id: "inv_2",
        amount: 100,
        paid_at: "2026-05-15",
        payment_account_id: "acct_cash",
        payment_method: "CASH",
        exchange_rate: 1.35,
      },
      makeCtx(),
    );

    const input = (received as { input: Record<string, unknown> } | null)?.input;
    expect(input?.exchangeRate).toBe("1.35");
  });
});
