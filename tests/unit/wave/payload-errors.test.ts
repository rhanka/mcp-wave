import { describe, expect, it } from "vitest";
import { WaveApiError } from "../../../src/lib/errors.js";
import { throwIfInputErrors } from "../../../src/wave/payload-errors.js";

describe("throwIfInputErrors", () => {
  it("returns silently when didSucceed is true", () => {
    expect(() => throwIfInputErrors({ didSucceed: true, inputErrors: [] }, "X")).not.toThrow();
  });

  it("throws WaveApiError with VALIDATION_ERROR when didSucceed is false", () => {
    try {
      throwIfInputErrors(
        {
          didSucceed: false,
          inputErrors: [{ code: "FOO", message: "bad", path: ["x"] }],
        },
        "InvoiceCreate",
      );
      expect.fail("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(WaveApiError);
      const err = e as WaveApiError;
      expect(err.waveCode).toBe("VALIDATION_ERROR");
      expect(err.httpStatus).toBe(400);
      const details = err.waveDetails as { operation: string; inputErrors: unknown[] };
      expect(details.operation).toBe("InvoiceCreate");
      expect(details.inputErrors).toHaveLength(1);
    }
  });

  it("throws EMPTY_PAYLOAD when payload is null/undefined", () => {
    expect(() => throwIfInputErrors(null, "X")).toThrowError(/EMPTY_PAYLOAD/);
    expect(() => throwIfInputErrors(undefined, "X")).toThrowError(/EMPTY_PAYLOAD/);
  });

  it("treats missing inputErrors as an empty list when didSucceed is false", () => {
    try {
      throwIfInputErrors({ didSucceed: false }, "X");
      expect.fail("should have thrown");
    } catch (e) {
      const err = e as WaveApiError;
      expect(err.waveCode).toBe("VALIDATION_ERROR");
      const details = err.waveDetails as { inputErrors: unknown[] };
      expect(details.inputErrors).toEqual([]);
    }
  });
});
