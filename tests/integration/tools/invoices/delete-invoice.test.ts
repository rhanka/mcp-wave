import { graphql, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { ToolContext } from "../../../../src/server/tool-context.js";
import { deleteInvoiceTool } from "../../../../src/tools/invoices/delete-invoice.js";
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

describe("delete_invoice", () => {
  it("deletes a draft invoice and returns deleted=true", async () => {
    let received: Record<string, unknown> | null = null;
    server.use(
      graphql.mutation("InvoiceDelete", ({ variables }) => {
        received = variables as Record<string, unknown>;
        return HttpResponse.json({
          data: {
            invoiceDelete: {
              didSucceed: true,
              inputErrors: [],
            },
          },
        });
      }),
    );

    const r = await deleteInvoiceTool.handler({ invoice_id: "inv_draft" }, makeCtx());

    expect(r).toEqual({ invoice_id: "inv_draft", deleted: true });
    const input = (received as { input: Record<string, unknown> } | null)?.input;
    expect(input).toEqual({ invoiceId: "inv_draft" });
  });

  it("throws WAVE_VALIDATION_ERROR when Wave rejects deletion of a sent invoice", async () => {
    server.use(
      graphql.mutation("InvoiceDelete", () =>
        HttpResponse.json({
          data: {
            invoiceDelete: {
              didSucceed: false,
              inputErrors: [
                {
                  code: "INVALID_STATE",
                  message: "Cannot delete a sent invoice",
                  path: ["invoiceId"],
                },
              ],
            },
          },
        }),
      ),
    );

    await expect(
      deleteInvoiceTool.handler({ invoice_id: "inv_sent" }, makeCtx()),
    ).rejects.toMatchObject({ code: "WAVE_VALIDATION_ERROR" });
  });
});
