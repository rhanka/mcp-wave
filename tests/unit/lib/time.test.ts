import { describe, expect, it } from "vitest";
import { isoDate, isoToday, parseIsoDate, plusDays } from "../../../src/lib/time.js";

describe("isoToday", () => {
  it("returns YYYY-MM-DD for the given clock", () => {
    const clock = () => new Date("2026-05-09T10:00:00Z");
    expect(isoToday(clock)).toBe("2026-05-09");
  });
});

describe("plusDays", () => {
  it("adds positive days", () => {
    expect(plusDays("2026-05-09", 30)).toBe("2026-06-08");
  });
  it("handles year boundary", () => {
    expect(plusDays("2026-12-15", 30)).toBe("2027-01-14");
  });
  it("handles zero", () => {
    expect(plusDays("2026-05-09", 0)).toBe("2026-05-09");
  });
});

describe("parseIsoDate", () => {
  it("rejects invalid formats", () => {
    expect(() => parseIsoDate("05/09/2026")).toThrow();
  });
  it("accepts valid YYYY-MM-DD", () => {
    expect(parseIsoDate("2026-05-09").getUTCFullYear()).toBe(2026);
  });
});

describe("isoDate", () => {
  it("formats a Date as YYYY-MM-DD", () => {
    expect(isoDate(new Date("2026-05-09T23:59:59Z"))).toBe("2026-05-09");
  });
});
