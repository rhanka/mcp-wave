import { describe, expect, it } from "vitest";
import { parseProfileFromNotes } from "../../../../src/domain/client-profiles/parse-from-notes.js";

describe("parseProfileFromNotes", () => {
  it("returns null when no marker is present", () => {
    expect(parseProfileFromNotes("just free notes")).toEqual({ kind: "absent" });
  });

  it("extracts a valid profile between markers and ignores surrounding text", () => {
    const notes = `Marc is the contact.

---mcp-wave---
alias: acme
unit: hours
hourly_rate: 95
currency: CAD
send_to:
  - billing@example.com
---mcp-wave---

trailing trivia`;
    const r = parseProfileFromNotes(notes);
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") {
      expect(r.profile.alias).toBe("acme");
      expect(r.profile.hourly_rate).toBe(95);
      expect(r.profile.currency).toBe("CAD");
      expect(r.profile.send_to).toEqual(["billing@example.com"]);
    }
  });

  it("returns parse_error with Zod issues on schema violations", () => {
    const notes = `---mcp-wave---
alias: ACME
currency: CAD
send_to:
  - billing@example.com
---mcp-wave---`;
    const r = parseProfileFromNotes(notes);
    expect(r.kind).toBe("parse_error");
    if (r.kind === "parse_error") {
      expect(r.issues.length).toBeGreaterThan(0);
    }
  });

  it("returns parse_error on invalid YAML", () => {
    const notes = `---mcp-wave---
not: { valid: yaml: at all
---mcp-wave---`;
    const r = parseProfileFromNotes(notes);
    expect(r.kind).toBe("parse_error");
  });

  it("treats null/undefined notes as absent", () => {
    expect(parseProfileFromNotes(null).kind).toBe("absent");
    expect(parseProfileFromNotes(undefined).kind).toBe("absent");
  });

  it("ignores text inside the block boundaries that is not a single YAML doc", () => {
    const notes = `---mcp-wave---
---mcp-wave---`;
    const r = parseProfileFromNotes(notes);
    expect(r.kind).toBe("parse_error");
  });
});
