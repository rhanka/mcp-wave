import { describe, expect, it, vi } from "vitest";
import { WaveApiError } from "../../../../src/lib/errors.js";
import type { ToolContext } from "../../../../src/server/tool-context.js";
import { approveInvoiceTool } from "../../../../src/tools/invoices/approve-invoice.js";

function makeCtx(invoiceApprove: ReturnType<typeof vi.fn>): ToolContext {
  return {
    req: { headers: null, request_id: "req_test" },
    wave: { invoiceApprove } as never,
    taxRates: {} as never,
    accountMapping: {} as never,
    env: {} as never,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never,
    identity: "mock",
  };
}

describe("approve_invoice tool", () => {
  it("happy path: returns invoice_id and status", async () => {
    const invoiceApprove = vi.fn().mockResolvedValue({
      invoiceApprove: {
        didSucceed: true,
        inputErrors: [],
        invoice: { id: "inv_1", status: "SAVED" },
      },
    });
    const ctx = makeCtx(invoiceApprove);

    const result = await approveInvoiceTool.handler({ invoice_id: "inv_1" }, ctx);

    expect(result).toEqual({ invoice_id: "inv_1", status: "SAVED" });
    expect(invoiceApprove).toHaveBeenCalledWith(ctx.req, {
      input: { invoiceId: "inv_1" },
    });
  });

  it("Wave returns inputErrors → throws WaveApiError VALIDATION_ERROR", async () => {
    const invoiceApprove = vi.fn().mockResolvedValue({
      invoiceApprove: {
        didSucceed: false,
        inputErrors: [{ code: "INVOICE_NOT_FOUND", message: "Invoice not found", path: [] }],
      },
    });
    const ctx = makeCtx(invoiceApprove);

    const err = await approveInvoiceTool.handler({ invoice_id: "inv_bad" }, ctx).catch((e) => e);
    expect(err).toBeInstanceOf(WaveApiError);
    expect((err as WaveApiError).waveCode).toBe("VALIDATION_ERROR");
  });

  it("didSucceed false without inputErrors → throwIfInputErrors raises VALIDATION_ERROR", async () => {
    // throwIfInputErrors always throws VALIDATION_ERROR when didSucceed is false,
    // even with an empty inputErrors list. The INVOICE_APPROVE_FAILED guard in the
    // tool is defensive dead code for this Wave API version.
    const invoiceApprove = vi.fn().mockResolvedValue({
      invoiceApprove: {
        didSucceed: false,
        inputErrors: [],
      },
    });
    const ctx = makeCtx(invoiceApprove);

    const err = await approveInvoiceTool.handler({ invoice_id: "inv_2" }, ctx).catch((e) => e);
    expect(err).toBeInstanceOf(WaveApiError);
    expect((err as WaveApiError).waveCode).toBe("VALIDATION_ERROR");
  });
});
