import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { computeInvoiceTotals } from "../../../../src/domain/invoice-templating/compute-totals.js";
import { ToolError } from "../../../../src/lib/errors.js";

function thrownBy(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error("Expected function to throw");
}

describe("computeInvoiceTotals", () => {
  it("single line, no tax", () => {
    const r = computeInvoiceTotals({
      lines: [{ quantity: 10, unit_price: 100, tax_codes: [] }],
      taxes: [],
      currency: "CAD",
    });
    expect(r.subtotal).toBe(1000);
    expect(r.taxes_breakdown).toEqual([]);
    expect(r.total).toBe(1000);
  });

  it("single line with GST + QST", () => {
    const r = computeInvoiceTotals({
      lines: [{ quantity: 10, unit_price: 100, tax_codes: ["GST", "QST"] }],
      taxes: [
        { code: "GST", rate: 0.05 },
        { code: "QST", rate: 0.09975 },
      ],
      currency: "CAD",
    });
    expect(r.subtotal).toBe(1000);
    expect(r.taxes_breakdown).toEqual([
      { code: "GST", amount: 50 },
      { code: "QST", amount: 99.75 },
    ]);
    expect(r.total).toBeCloseTo(1149.75, 2);
  });

  it("multiple lines", () => {
    const r = computeInvoiceTotals({
      lines: [
        { quantity: 23, unit_price: 95, tax_codes: ["GST", "QST"] },
        { quantity: 1, unit_price: 100, tax_codes: ["GST", "QST"] },
      ],
      taxes: [
        { code: "GST", rate: 0.05 },
        { code: "QST", rate: 0.09975 },
      ],
      currency: "CAD",
    });
    expect(r.subtotal).toBe(2285);
    expect(r.total).toBeCloseTo(2285 * 1.14975, 2);
  });

  it("rounds tax amounts to 2 decimals (banker-style not required)", () => {
    const r = computeInvoiceTotals({
      lines: [{ quantity: 1, unit_price: 33.33, tax_codes: ["X"] }],
      taxes: [{ code: "X", rate: 0.13 }],
      currency: "USD",
    });
    expect(r.taxes_breakdown[0]?.amount).toBeCloseTo(4.33, 2);
  });

  it("rejects unresolved tax codes with details", () => {
    const error = thrownBy(() =>
      computeInvoiceTotals({
        lines: [{ quantity: 1, unit_price: 100, tax_codes: ["GST"] }],
        taxes: [{ code: "QST", rate: 0.09975 }],
        currency: "CAD",
      }),
    );
    expect(error).toBeInstanceOf(ToolError);
    expect(error).toMatchObject({
      code: "TAX_CODE_NOT_RESOLVED",
      details: { code: "GST", available: ["QST"] },
    });
  });

  it("property: total >= subtotal when all rates >= 0", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            quantity: fc.integer({ min: 1, max: 100 }),
            unit_price: fc.double({ min: 0.01, max: 10000, noNaN: true }),
          }),
          { minLength: 1, maxLength: 5 },
        ),
        fc.double({ min: 0, max: 0.5, noNaN: true }),
        (lines, rate) => {
          const r = computeInvoiceTotals({
            lines: lines.map((l) => ({ ...l, tax_codes: ["X"] })),
            taxes: [{ code: "X", rate }],
            currency: "USD",
          });
          expect(r.total).toBeGreaterThanOrEqual(r.subtotal);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("rejects negative quantity or price", () => {
    const negativeQuantity = thrownBy(() =>
      computeInvoiceTotals({
        lines: [{ quantity: -1, unit_price: 10, tax_codes: [] }],
        taxes: [],
        currency: "USD",
      }),
    );
    expect(negativeQuantity).toBeInstanceOf(ToolError);
    expect(negativeQuantity).toMatchObject({
      code: "INVALID_LINE",
      details: { index: 0, reason: "negative quantity" },
    });

    const negativeUnitPrice = thrownBy(() =>
      computeInvoiceTotals({
        lines: [{ quantity: 1, unit_price: -10, tax_codes: [] }],
        taxes: [],
        currency: "USD",
      }),
    );
    expect(negativeUnitPrice).toBeInstanceOf(ToolError);
    expect(negativeUnitPrice).toMatchObject({
      code: "INVALID_LINE",
      details: { index: 0, reason: "negative unit_price" },
    });
  });
});
