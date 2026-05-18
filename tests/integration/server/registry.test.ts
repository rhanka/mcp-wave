import { describe, expect, it } from "vitest";
import { allTools } from "../../../src/server/tool-registry.js";

describe("tool registry v1 catalog", () => {
  it("registers the v1 tools supported by the confirmed Wave public schema", () => {
    const names = allTools()
      .map((tool) => tool.name)
      .sort();

    expect(names).toEqual(
      [
        "create_customer",
        "create_invoice",
        "create_invoice_for_client",
        "delete_invoice",
        "download_invoice_pdf",
        "get_account",
        "get_customer",
        "get_invoice",
        "get_payroll_rates",
        "list_accounts",
        "list_businesses",
        "list_client_profiles",
        "list_customers",
        "list_invoices",
        "list_products",
        "list_vendors",
        "mark_invoice_paid",
        "send_invoice",
        "setup_account_mapping",
        "split_payroll_remittance",
        "upsert_product",
      ].sort(),
    );
  });

  it("serves non-trivial descriptions for every tool", () => {
    for (const tool of allTools()) {
      expect(tool.description.length, tool.name).toBeGreaterThan(20);
    }
  });
});
