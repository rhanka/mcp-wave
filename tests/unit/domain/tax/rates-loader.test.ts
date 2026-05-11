import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TaxRatesLoader } from "../../../../src/domain/tax/rates-loader.js";
import { ToolError } from "../../../../src/lib/errors.js";

function fixtureDir(content: string, name = "ca-qc-2026.yaml"): string {
  const dir = mkdtempSync(join(tmpdir(), "tax-rates-"));
  writeFileSync(join(dir, name), content);
  return dir;
}

const VALID = `
jurisdiction: CA-QC
year: 2026
effective_from: 2026-01-01
effective_to: 2026-12-31
remittance_authorities:
  - { code: CRA, name: "X", level: federal }
payroll_taxes: []
sales_taxes: []
`;

describe("TaxRatesLoader", () => {
  it("loads a valid file by jurisdiction+year", async () => {
    const loader = new TaxRatesLoader(fixtureDir(VALID));
    const r = await loader.load("CA-QC", 2026);
    expect(r.jurisdiction).toBe("CA-QC");
  });

  it("throws TAX_RATES_NOT_FOUND when file is missing", async () => {
    const loader = new TaxRatesLoader(fixtureDir(VALID));
    await expect(loader.load("US-CA", 2026)).rejects.toMatchObject({ code: "TAX_RATES_NOT_FOUND" });
  });

  it("throws TAX_RATES_INVALID on schema violations", async () => {
    const loader = new TaxRatesLoader(fixtureDir("jurisdiction: CA-QC\n"));
    await expect(loader.load("CA-QC", 2026)).rejects.toBeInstanceOf(ToolError);
  });

  it("loadForDate finds the table whose period covers the given date", async () => {
    const loader = new TaxRatesLoader(fixtureDir(VALID));
    const r = await loader.loadForDate("CA-QC", "2026-06-15");
    expect(r.year).toBe(2026);
  });
});
