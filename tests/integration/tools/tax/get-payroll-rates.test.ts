import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { TaxRatesLoader } from "../../../../src/domain/tax/rates-loader.js";
import type { ToolContext } from "../../../../src/server/tool-context.js";
import { getPayrollRatesTool } from "../../../../src/tools/tax/get-payroll-rates.js";

const FIXTURE = `
jurisdiction: CA-QC
year: 2026
effective_from: 2026-01-01
effective_to: 2026-12-31
remittance_authorities:
  - { code: CRA, name: X, level: federal }
payroll_taxes: []
sales_taxes: []
`;

function makeCtx(): ToolContext {
  const dir = mkdtempSync(join(tmpdir(), "rates-"));
  writeFileSync(join(dir, "ca-qc-2026.yaml"), FIXTURE);
  return {
    req: { headers: null, request_id: "t" },
    wave: {} as never,
    taxRates: new TaxRatesLoader(dir),
    accountMapping: {} as never,
    env: {} as never,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never,
    identity: "mock",
  };
}

describe("get_payroll_rates", () => {
  it("returns the table for jurisdiction+year", async () => {
    const r = (await getPayrollRatesTool.handler(
      { jurisdiction: "CA-QC", year: 2026 },
      makeCtx(),
    )) as { jurisdiction: string };
    expect(r.jurisdiction).toBe("CA-QC");
  });

  it("returns the table covering a specific date when year omitted", async () => {
    const r = (await getPayrollRatesTool.handler(
      { jurisdiction: "CA-QC", on_date: "2026-06-15" },
      makeCtx(),
    )) as { year: number };
    expect(r.year).toBe(2026);
  });

  it("rejects when neither year nor on_date is provided", async () => {
    await expect(
      getPayrollRatesTool.handler({ jurisdiction: "CA-QC" }, makeCtx()),
    ).rejects.toThrow();
  });
});
