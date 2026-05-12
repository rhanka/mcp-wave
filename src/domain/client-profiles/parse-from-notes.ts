import { parse as parseYaml } from "yaml";
import { type ClientProfile, ClientProfileSchema } from "./schema.js";

const MARKER_RE = /---mcp-wave---\s*\n([\s\S]*?)\n---mcp-wave---/;

export type ParseResult =
  | { kind: "absent" }
  | { kind: "ok"; profile: ClientProfile }
  | { kind: "parse_error"; issues: Array<{ path: string; message: string }> };

export function parseProfileFromNotes(notes: string | null | undefined): ParseResult {
  if (!notes) return { kind: "absent" };

  const markerMatch = notes.match(MARKER_RE);
  if (!markerMatch) return { kind: "absent" };

  let raw: unknown;
  try {
    raw = parseYaml(markerMatch[1] ?? "");
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
