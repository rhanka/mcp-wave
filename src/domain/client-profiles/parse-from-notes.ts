import { parse as parseYaml } from "yaml";
import { type ClientProfile, ClientProfileSchema } from "./schema.js";

const MARKER_RE = /---mcp-wave---\s*\n([\s\S]*?)\n---mcp-wave---/;
const MARKER_SCAN_RE = new RegExp(MARKER_RE, "g");

export type ParseResult =
  | { kind: "absent" }
  | { kind: "ok"; profile: ClientProfile }
  | { kind: "parse_error"; issues: Array<{ path: string; message: string }> };

export function parseProfileFromNotes(notes: string | null | undefined): ParseResult {
  if (!notes) return { kind: "absent" };

  for (const markerMatch of notes.matchAll(MARKER_SCAN_RE)) {
    if (!isStandaloneMarkerMatch(notes, markerMatch)) continue;
    return parseProfileYaml(markerMatch[1] ?? "");
  }

  return { kind: "absent" };
}

function isStandaloneMarkerMatch(notes: string, markerMatch: RegExpMatchArray): boolean {
  const matchStart = markerMatch.index;
  if (matchStart === undefined) return false;
  if (matchStart > 0 && notes[matchStart - 1] !== "\n") return false;

  const nextCharacter = notes[matchStart + markerMatch[0].length];
  if (nextCharacter !== undefined && nextCharacter !== "\n" && nextCharacter !== "\r") {
    return false;
  }

  return true;
}

function parseProfileYaml(profileYaml: string): ParseResult {
  let raw: unknown;
  try {
    raw = parseYaml(profileYaml);
  } catch (error) {
    return {
      kind: "parse_error",
      issues: [
        {
          path: "<yaml>",
          message: error instanceof Error ? error.message : String(error),
        },
      ],
    };
  }

  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return {
      kind: "parse_error",
      issues: [{ path: "<yaml>", message: "expected a YAML mapping" }],
    };
  }

  const parsed = ClientProfileSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      kind: "parse_error",
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    };
  }

  return { kind: "ok", profile: parsed.data };
}
