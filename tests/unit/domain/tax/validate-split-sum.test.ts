import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { validateSplitSum } from "../../../../src/domain/tax/validate-split-sum.js";

describe("validateSplitSum", () => {
  it("accepts exact match", () => {
    expect(validateSplitSum([3200, 1620], 4820, 0.01)).toEqual({ ok: true });
  });

  it("accepts within tolerance", () => {
    expect(validateSplitSum([3200, 1620.01], 4820, 0.02)).toEqual({ ok: true });
  });

  it("rejects beyond tolerance", () => {
    const r = validateSplitSum([3200, 1620.05], 4820, 0.01);

    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.delta).toBeCloseTo(0.05, 2);
    }
  });

  it("property: tolerance >= |delta| -> ok", () => {
    fc.assert(
      fc.property(
        fc.array(fc.double({ min: 0, max: 1000, noNaN: true }), {
          minLength: 1,
          maxLength: 5,
        }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (parts, tolerance) => {
          const sum = parts.reduce((acc, part) => acc + part, 0);

          const r = validateSplitSum(parts, sum, tolerance);

          expect(r.ok).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });
});
