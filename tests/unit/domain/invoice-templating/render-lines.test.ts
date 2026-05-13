import { describe, expect, it } from "vitest";
import type { ClientProfile } from "../../../../src/domain/client-profiles/schema.js";
import { renderLines } from "../../../../src/domain/invoice-templating/render-lines.js";

const baseProfile: ClientProfile = {
  alias: "acme",
  unit: "hours",
  hourly_rate: 95,
  currency: "CAD",
  default_product_id: "prod_x",
  default_description: "Consulting — development hours",
  send_to: ["billing@example.com"],
  cc: [],
  payment_terms_days: 30,
  language: "en",
  default_taxes: ["GST", "QST"],
};

describe("renderLines", () => {
  it("renders a single line from profile defaults", () => {
    const lines = renderLines({ profile: baseProfile, quantity: 23 });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      quantity: 23,
      unit_price: 95,
      product_id: "prod_x",
      tax_codes: ["GST", "QST"],
    });
    expect(lines[0]?.description).toContain("Consulting — development hours");
  });

  it("appends period_label to the description when provided", () => {
    const lines = renderLines({
      profile: baseProfile,
      quantity: 10,
      period_label: "November 2026",
    });
    expect(lines[0]?.description).toContain("November 2026");
  });

  it("override_unit_price wins over profile hourly_rate", () => {
    const lines = renderLines({ profile: baseProfile, quantity: 10, override_unit_price: 120 });
    expect(lines[0]?.unit_price).toBe(120);
  });

  it("throws MISSING_RATE when neither profile rate nor override is set", () => {
    const profile = { ...baseProfile, hourly_rate: undefined } as ClientProfile;
    expect(() => renderLines({ profile, quantity: 10 })).toThrow(/MISSING_RATE/);
  });
});
