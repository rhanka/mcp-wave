import { describe, expect, it } from "vitest";
import { WaveApiError } from "../../../src/lib/errors.js";
import { mapWaveGraphQLError } from "../../../src/wave/errors.js";

describe("mapWaveGraphQLError", () => {
  it.each([
    ["AUTHENTICATION_ERROR", 401],
    ["AUTHORIZATION_ERROR", 403],
    ["NOT_FOUND", 404],
    ["VALIDATION_ERROR", 400],
    ["RATE_LIMITED", 429],
    ["INTERNAL_SERVER_ERROR", 500],
  ])("maps %s to status %d", (waveCode, expectedStatus) => {
    const err = mapWaveGraphQLError({ extensions: { code: waveCode }, message: "x" });
    expect(err).toBeInstanceOf(WaveApiError);
    expect(err.httpStatus).toBe(expectedStatus);
    expect(err.waveCode).toBe(waveCode);
    expect(err.code).toBe(`WAVE_${waveCode}`);
  });

  it("falls back to UNKNOWN with status 500 when code is missing", () => {
    const err = mapWaveGraphQLError({ message: "weird" });
    expect(err.waveCode).toBe("UNKNOWN");
    expect(err.httpStatus).toBe(500);
  });

  it("handles null input", () => {
    const err = mapWaveGraphQLError(null);
    expect(err.waveCode).toBe("UNKNOWN");
    expect(err.httpStatus).toBe(500);
  });

  it("keeps an unrecognized extension code but adopts the HTTP status hint", () => {
    const err = mapWaveGraphQLError({ extensions: { code: "OUTSIDE_MAP" }, message: "?" }, 502);
    expect(err.waveCode).toBe("OUTSIDE_MAP");
    expect(err.httpStatus).toBe(502);
  });

  it("derives the code from an HTTP status when extensions code is missing", () => {
    expect(mapWaveGraphQLError(null, 429).waveCode).toBe("RATE_LIMITED");
    expect(mapWaveGraphQLError({}, 401).waveCode).toBe("AUTHENTICATION_ERROR");
    expect(mapWaveGraphQLError({}, 502).waveCode).toBe("INTERNAL_SERVER_ERROR");
    expect(mapWaveGraphQLError({}, 422).waveCode).toBe("VALIDATION_ERROR");
  });
});
