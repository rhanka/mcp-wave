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

  it("throws ACCOUNT_MAPPING_INVALID on schema violations", async () => {
    const loader = new AccountMappingLoader(fixture("jurisdiction: CA-QC\n"));
    await expect(loader.load()).rejects.toMatchObject({
      code: "ACCOUNT_MAPPING_INVALID",
      details: { reason: "SCHEMA_VALIDATION_FAILED" },
    });
  });

  it("throws ACCOUNT_MAPPING_INVALID on malformed YAML", async () => {
    const loader = new AccountMappingLoader(fixture("jurisdiction: [\n"));
    await expect(loader.load()).rejects.toMatchObject({
      code: "ACCOUNT_MAPPING_INVALID",
      details: { reason: "YAML_PARSE_ERROR" },
    });
  });

  it("caches the mapping across calls", async () => {
    const loader = new AccountMappingLoader(fixture(TWO_BUCKETS));
    const first = await loader.load();
    const second = await loader.load();
    expect(second).toBe(first);
  });
});
