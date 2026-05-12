import { describe, expect, it } from "vitest";
import { ClientProfileSchema } from "../../../../src/domain/client-profiles/schema.js";

const valid = {
  alias: "acme",
  unit: "hours",
  hourly_rate: 95,
  currency: "CAD",
  send_to: ["billing@example.com"],
};

describe("ClientProfileSchema", () => {
  it("accepts a minimal valid profile and applies defaults", () => {
    const r = ClientProfileSchema.safeParse(valid);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.payment_terms_days).toBe(30);
      expect(r.data.language).toBe("en");
      expect(r.data.cc).toEqual([]);
      expect(r.data.default_taxes).toEqual([]);
    }
  });

  it("rejects an alias with uppercase letters", () => {
    const r = ClientProfileSchema.safeParse({ ...valid, alias: "Acme" });
    expect(r.success).toBe(false);
  });

  it("rejects an invalid email in send_to", () => {
    const r = ClientProfileSchema.safeParse({ ...valid, send_to: ["not-an-email"] });
    expect(r.success).toBe(false);
  });

  it("rejects a 4-letter currency", () => {
    const r = ClientProfileSchema.safeParse({ ...valid, currency: "CADX" });
    expect(r.success).toBe(false);
  });

  it("rejects empty send_to", () => {
    const r = ClientProfileSchema.safeParse({ ...valid, send_to: [] });
    expect(r.success).toBe(false);
  });
});
