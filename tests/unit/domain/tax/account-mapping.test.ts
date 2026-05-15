import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AccountMappingLoader } from "../../../../src/domain/tax/account-mapping-loader.js";

function fixture(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "amap-"));
  writeFileSync(join(dir, "default.yaml"), content);
  return dir;
}

const TWO_BUCKETS = `
business_id_env: WAVE_DEFAULT_BUSINESS_ID
jurisdiction: CA-QC
remittance_buckets:
  CRA: { payable_account_id: "acct_fed" }
  RQ:  { payable_account_id: "acct_qc" }
`;

describe("AccountMappingLoader", () => {
  it("loads two-bucket mode", async () => {
    const loader = new AccountMappingLoader(fixture(TWO_BUCKETS));
    const m = await loader.load();
    expect(m.remittance_buckets.CRA?.payable_account_id).toBe("acct_fed");
    expect(m.tax_code_to_account).toBeUndefined();
  });

  it("throws ACCOUNT_MAPPING_MISSING when file absent", async () => {
    const loader = new AccountMappingLoader("/nonexistent");
    await expect(loader.load()).rejects.toMatchObject({ code: "ACCOUNT_MAPPING_MISSING" });
  });
});
