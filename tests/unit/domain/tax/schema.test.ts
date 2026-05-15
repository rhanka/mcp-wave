import { describe, expect, it } from "vitest";
import { TaxRatesSchema } from "../../../../src/domain/tax/schema.js";

const valid = {
  jurisdiction: "CA-QC",
  year: 2026,
  effective_from: "2026-01-01",
  effective_to: "2026-12-31",
  remittance_authorities: [
    { code: "CRA", name: "Receiver General", level: "federal" },
    { code: "RQ", name: "Revenu Québec", level: "regional" },
  ],
  payroll_taxes: [{ code: "CIT", name: "Federal income tax", remits_to: "CRA", type: "withheld" }],
  sales_taxes: [{ code: "GST", name: "GST", rate: 0.05, remits_to: "CRA" }],
};

describe("TaxRatesSchema", () => {
  it("accepts a valid table", () => {
    const r = TaxRatesSchema.safeParse(valid);
    expect(r.success).toBe(true);
  });

  it("rejects payroll_taxes referencing an unknown remits_to", () => {
    const bad = { ...valid, payroll_taxes: [{ ...valid.payroll_taxes[0], remits_to: "NOPE" }] };
    const r = TaxRatesSchema.safeParse(bad);
    expect(r.success).toBe(false);
  });

  it("rejects sales_taxes referencing an unknown remits_to", () => {
    const bad = { ...valid, sales_taxes: [{ ...valid.sales_taxes[0], remits_to: "NOPE" }] };
    const r = TaxRatesSchema.safeParse(bad);
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(
        r.error.issues.some(
          (i) => i.path.join(".") === "sales_taxes.0.remits_to" && i.message.includes("NOPE"),
        ),
      ).toBe(true);
    }
  });

  it("rejects sales_taxes with negative rate", () => {
    const bad = { ...valid, sales_taxes: [{ ...valid.sales_taxes[0], rate: -0.05 }] };
    const r = TaxRatesSchema.safeParse(bad);
    expect(r.success).toBe(false);
  });

  it("requires effective_from <= effective_to", () => {
    const bad = { ...valid, effective_from: "2027-01-01", effective_to: "2026-01-01" };
    const r = TaxRatesSchema.safeParse(bad);
    expect(r.success).toBe(false);
  });
});
