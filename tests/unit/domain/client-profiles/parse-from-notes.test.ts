import { describe, expect, it } from "vitest";
import { parseProfileFromNotes } from "../../../../src/domain/client-profiles/parse-from-notes.js";

describe("parseProfileFromNotes", () => {
  it("returns absent when no marker is present", () => {
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

  it("parses when the opening marker has trailing spaces", () => {
    const notes = `---mcp-wave---   
alias: acme
currency: CAD
send_to:
  - billing@example.com
---mcp-wave---`;
    const r = parseProfileFromNotes(notes);
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") {
      expect(r.profile.alias).toBe("acme");
    }
  });

  it("returns absent when the opening marker is embedded in text", () => {
    const notes = `prefix ---mcp-wave---
alias: acme
currency: CAD
send_to:
  - billing@example.com
---mcp-wave---`;
    expect(parseProfileFromNotes(notes)).toEqual({ kind: "absent" });
  });

  it("returns absent when the closing marker has a suffix", () => {
    const notes = `---mcp-wave---
alias: acme
currency: CAD
send_to:
  - billing@example.com
---mcp-wave---not-a-marker`;
    expect(parseProfileFromNotes(notes)).toEqual({ kind: "absent" });
  });

  it("skips embedded false markers and parses a later standalone profile block", () => {
    const notes = `prefix ---mcp-wave---
alias: ignored
currency: CAD
send_to:
  - ignored@example.com
---mcp-wave---

---mcp-wave---
alias: acme
currency: CAD
send_to:
  - billing@example.com
---mcp-wave---`;
    const r = parseProfileFromNotes(notes);
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") {
      expect(r.profile.alias).toBe("acme");
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
      expect(r.issues).toContainEqual({
        path: "alias",
        message: "alias must be [a-z0-9-]+",
      });
    }
  });

  it("returns parse_error on invalid YAML", () => {
    const notes = `---mcp-wave---
not: { valid: yaml: at all
---mcp-wave---`;
    const r = parseProfileFromNotes(notes);
    expect(r.kind).toBe("parse_error");
  });

  it("returns a YAML mapping error for YAML sequences", () => {
    const notes = `---mcp-wave---
[]
---mcp-wave---`;
    const r = parseProfileFromNotes(notes);
    expect(r.kind).toBe("parse_error");
    if (r.kind === "parse_error") {
      expect(r.issues).toEqual([{ path: "<yaml>", message: "expected a YAML mapping" }]);
    }
  });

  it("returns a YAML mapping error for scalar YAML values", () => {
    const notes = `---mcp-wave---
42
---mcp-wave---`;
    const r = parseProfileFromNotes(notes);
    expect(r.kind).toBe("parse_error");
    if (r.kind === "parse_error") {
      expect(r.issues).toEqual([{ path: "<yaml>", message: "expected a YAML mapping" }]);
    }
  });

  it("treats null/undefined notes as absent", () => {
    expect(parseProfileFromNotes(null).kind).toBe("absent");
    expect(parseProfileFromNotes(undefined).kind).toBe("absent");
  });

  it("returns parse_error when the matched YAML doc is empty", () => {
    const notes = `---mcp-wave---

---mcp-wave---`;
    const r = parseProfileFromNotes(notes);
    expect(r.kind).toBe("parse_error");
    if (r.kind === "parse_error") {
      expect(r.issues).toEqual([{ path: "<yaml>", message: "expected a YAML mapping" }]);
    }
  });
});
