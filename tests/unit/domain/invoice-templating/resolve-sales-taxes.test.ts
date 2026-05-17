import { describe, expect, it } from "vitest";
import { resolveSalesTaxes } from "../../../../src/domain/invoice-templating/resolve-sales-taxes.js";

const TAXES = [
  { id: "tax_gst", name: "Goods and Services Tax", abbreviation: "GST", rate: 0.05 },
  { id: "tax_qst", name: "Quebec Sales Tax", abbreviation: "QST", rate: 0.09975 },
  { id: "tax_pst", name: "Provincial Sales Tax", abbreviation: null, rate: 0.07 },
];

describe("resolveSalesTaxes", () => {
  it("matches by abbreviation case-insensitively", () => {
    const r = resolveSalesTaxes(["gst", "QST"], TAXES);
    expect(r.matched.map((t) => t.id)).toEqual(["tax_gst", "tax_qst"]);
    expect(r.unresolved).toEqual([]);
  });

  it("matches by name when abbreviation absent", () => {
    const r = resolveSalesTaxes(["Goods and Services Tax"], TAXES);
    expect(r.matched[0]?.id).toBe("tax_gst");
  });

  it("matches a tax with a null abbreviation by name", () => {
    const r = resolveSalesTaxes(["provincial sales tax"], TAXES);
    expect(r.matched[0]?.id).toBe("tax_pst");
  });

  it("reports unresolved codes preserving original casing", () => {
    const r = resolveSalesTaxes(["GST", "VAT"], TAXES);
    expect(r.unresolved).toEqual(["VAT"]);
  });

  it("returns empty when codes empty", () => {
    expect(resolveSalesTaxes([], TAXES)).toEqual({ matched: [], unresolved: [] });
  });
});
