import { describe, expect, it } from "vitest";
import type { ClientProfile } from "../../../../src/domain/client-profiles/schema.js";
import { renderLines } from "../../../../src/domain/invoice-templating/render-lines.js";
import { ToolError } from "../../../../src/lib/errors.js";

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

function thrownBy(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error("Expected function to throw");
}

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
    const { hourly_rate: _hourlyRate, ...profile } = baseProfile;
    expect(_hourlyRate).toBe(95);

    const error = thrownBy(() => renderLines({ profile, quantity: 10 }));

    expect(error).toBeInstanceOf(ToolError);
    if (!(error instanceof ToolError)) {
      throw new Error("Expected ToolError");
    }
    expect(error.code).toBe("MISSING_RATE");
    expect(error.details.alias).toBe("acme");
  });

  it("omits product_id when profile default_product_id is omitted", () => {
    const { default_product_id: _defaultProductId, ...profile } = baseProfile;
    expect(_defaultProductId).toBe("prod_x");

    const [line] = renderLines({ profile, quantity: 10 });

    expect(line).toBeDefined();
    expect(line).not.toHaveProperty("product_id");
  });

  it("copies tax_codes from profile defaults", () => {
    const [line] = renderLines({ profile: baseProfile, quantity: 10 });

    expect(line).toBeDefined();
    if (line === undefined) {
      throw new Error("Expected one rendered line");
    }

    expect(line.tax_codes).toEqual(baseProfile.default_taxes);
    expect(line.tax_codes).not.toBe(baseProfile.default_taxes);

    line.tax_codes.push("HST");

    expect(line.tax_codes).toEqual(["GST", "QST", "HST"]);
    expect(baseProfile.default_taxes).toEqual(["GST", "QST"]);
  });
});
