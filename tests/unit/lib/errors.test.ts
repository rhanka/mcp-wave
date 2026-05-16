import { describe, expect, it } from "vitest";
import { normalizeError, ToolError, WaveApiError } from "../../../src/lib/errors.js";

describe("ToolError", () => {
  it("captures code, details, hint", () => {
    const e = new ToolError("ALIAS_NOT_FOUND", { alias: "x" }, "Try list_client_profiles");
    expect(e.code).toBe("ALIAS_NOT_FOUND");
    expect(e.details).toEqual({ alias: "x" });
    expect(e.hint).toBe("Try list_client_profiles");
    expect(e.message).toContain("ALIAS_NOT_FOUND");
  });

  it("serializes to a plain object", () => {
    const e = new ToolError("X", { a: 1 }, "h");
    expect(e.toJSON()).toEqual({ code: "X", details: { a: 1 }, hint: "h" });
  });
});

describe("WaveApiError", () => {
  it("extends ToolError with WAVE_-prefixed code", () => {
    const e = new WaveApiError("AUTHENTICATION_ERROR", 401, { foo: "bar" });
    expect(e).toBeInstanceOf(ToolError);
    expect(e.code).toBe("WAVE_AUTHENTICATION_ERROR");
    expect(e.httpStatus).toBe(401);
    expect(e.waveDetails).toEqual({ foo: "bar" });
  });
});

describe("normalizeError", () => {
  it("returns ToolError as-is", () => {
    const e = new ToolError("X");
    expect(normalizeError(e)).toBe(e);
  });

  it("wraps generic Error as INTERNAL_ERROR", () => {
    const e = normalizeError(new Error("oops"));
    expect(e).toBeInstanceOf(ToolError);
    expect(e.code).toBe("INTERNAL_ERROR");
    expect(e.details).toMatchObject({ message: "oops" });
  });

  it("wraps non-error values", () => {
    const e = normalizeError("plain string");
    expect(e.code).toBe("INTERNAL_ERROR");
  });
});
