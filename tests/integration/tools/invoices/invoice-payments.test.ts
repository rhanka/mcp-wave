import { graphql, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { ToolContext } from "../../../../src/server/tool-context.js";
import { findTool } from "../../../../src/server/tool-registry.js";
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

describe("invoice payment tools", () => {
  it("get_invoice_payment returns a flattened payment record with receipt metadata", async () => {
    server.use(
      graphql.query("GetInvoicePayment", () =>
        HttpResponse.json({
          data: {
            business: {
              invoicePayment: {
                id: "pay_1",
                amount: "210.00",
                paymentDate: "2026-05-15",
                paymentMethod: "BANK_TRANSFER",
                memo: "Wire from Acme",
                exchangeRate: "1.0",
                accountingTransactionId: "acct_txn_1",
                transactionId: "bank_txn_1",
                state: "PAID",
                readonlyUrl: "https://wave.test/receipts/pay_1",
                createdAt: "2026-05-15T12:00:00.000Z",
                modifiedAt: "2026-05-15T12:05:00.000Z",
                accountNumberLast3: "123",
                account: { id: "acct_bank", name: "Checking" },
                customer: { id: "cust_1", name: "Acme", email: "ap@acme.test" },
                businessCurrency: { code: "CAD" },
                invoiceCurrency: { code: "CAD" },
                paymentCurrency: { code: "CAD" },
                invoice: {
                  id: "inv_1",
                  invoiceNumber: "INV-001",
                },
              },
            },
          },
        }),
      ),
    );

    const tool = findTool("get_invoice_payment");
    expect(tool).toBeDefined();
    if (!tool) return;

    const result = await tool.handler({ invoice_payment_id: "pay_1" }, makeCtx());

    expect(result).toEqual({
      id: "pay_1",
      amount: "210.00",
      payment_date: "2026-05-15",
      payment_method: "BANK_TRANSFER",
      memo: "Wire from Acme",
      exchange_rate: "1.0",
      state: "PAID",
      receipt_url: "https://wave.test/receipts/pay_1",
      accounting_transaction_id: "acct_txn_1",
      transaction_id: "bank_txn_1",
      created_at: "2026-05-15T12:00:00.000Z",
      modified_at: "2026-05-15T12:05:00.000Z",
      account: { id: "acct_bank", name: "Checking", last3: "123" },
      customer: { id: "cust_1", name: "Acme", email: "ap@acme.test" },
      currencies: {
        business: "CAD",
        invoice: "CAD",
        payment: "CAD",
      },
      invoice: { id: "inv_1", number: "INV-001" },
    });
  });

  it("update_invoice_payment patches a recorded payment", async () => {
    let received: Record<string, unknown> | null = null;
    server.use(
      graphql.mutation("InvoicePaymentPatch", ({ variables }) => {
        received = variables as Record<string, unknown>;
        return HttpResponse.json({
          data: {
            invoicePaymentPatch: {
              didSucceed: true,
              inputErrors: [],
              invoicePayment: {
                id: "pay_1",
                amount: "200.00",
                paymentDate: "2026-05-16",
                paymentMethod: "CHEQUE",
                memo: "Corrected amount",
              },
            },
          },
        });
      }),
    );

    const tool = findTool("update_invoice_payment");
    expect(tool).toBeDefined();
    if (!tool) return;

    const result = await tool.handler(
      {
        invoice_payment_id: "pay_1",
        amount: 200,
        paid_at: "2026-05-16",
        payment_method: "CHEQUE",
        memo: "Corrected amount",
        payment_account_id: "acct_chequing",
        exchange_rate: 1.25,
      },
      makeCtx(),
    );

    expect(result).toEqual({
      payment_id: "pay_1",
      amount: 200,
      payment_date: "2026-05-16",
      payment_method: "CHEQUE",
      memo: "Corrected amount",
    });

    const input = (received as { input: Record<string, unknown> } | null)?.input;
    expect(input).toMatchObject({
      id: "pay_1",
      amount: "200",
      paymentDate: "2026-05-16",
      paymentMethod: "CHEQUE",
      memo: "Corrected amount",
      paymentAccountId: "acct_chequing",
      exchangeRate: "1.25",
    });
  });

  it("delete_invoice_payment removes a manual payment record", async () => {
    let received: Record<string, unknown> | null = null;
    server.use(
      graphql.mutation("InvoicePaymentDelete", ({ variables }) => {
        received = variables as Record<string, unknown>;
        return HttpResponse.json({
          data: {
            invoicePaymentDelete: {
              didSucceed: true,
              inputErrors: [],
            },
          },
        });
      }),
    );

    const tool = findTool("delete_invoice_payment");
    expect(tool).toBeDefined();
    if (!tool) return;

    const result = await tool.handler({ invoice_payment_id: "pay_1" }, makeCtx());

    expect(result).toEqual({ invoice_payment_id: "pay_1", deleted: true });
    expect((received as { input: Record<string, unknown> } | null)?.input).toEqual({
      id: "pay_1",
    });
  });

  it("send_invoice_payment_receipt emails the receipt and defaults attach_pdf to true", async () => {
    let received: Record<string, unknown> | null = null;
    server.use(
      graphql.mutation("InvoicePaymentReceiptSend", ({ variables }) => {
        received = variables as Record<string, unknown>;
        return HttpResponse.json({
          data: {
            invoicePaymentReceiptSend: {
              didSucceed: true,
              inputErrors: [],
            },
          },
        });
      }),
    );

    const tool = findTool("send_invoice_payment_receipt");
    expect(tool).toBeDefined();
    if (!tool) return;

    const result = await tool.handler(
      {
        invoice_id: "inv_1",
        invoice_payment_id: "pay_1",
        to_email: ["billing@acme.test"],
        subject: "Receipt for payment INV-001",
        message: "Payment received.",
        cc_myself: true,
      },
      makeCtx(),
    );

    expect(result).toMatchObject({
      invoice_id: "inv_1",
      invoice_payment_id: "pay_1",
      sent_to: ["billing@acme.test"],
    });
    expect(typeof (result as { sent_at: string }).sent_at).toBe("string");

    const input = (received as { input: Record<string, unknown> } | null)?.input;
    expect(input).toMatchObject({
      invoiceId: "inv_1",
      invoicePaymentId: "pay_1",
      to: ["billing@acme.test"],
      attachPdf: true,
      subject: "Receipt for payment INV-001",
      message: "Payment received.",
      ccMyself: true,
    });
  });
});
