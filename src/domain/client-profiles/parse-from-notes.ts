import { parse as parseYaml } from "yaml";
import { type ClientProfile, ClientProfileSchema } from "./schema.js";

const MARKER_RE = /---mcp-wave---\s*\n([\s\S]*?)\n---mcp-wave---/;
const MARKER_TEXT = "---mcp-wave---";

export type ParseResult =
  | { kind: "absent" }
  | { kind: "ok"; profile: ClientProfile }
  | { kind: "parse_error"; issues: Array<{ path: string; message: string }> };

export function parseProfileFromNotes(notes: string | null | undefined): ParseResult {
  if (!notes) return { kind: "absent" };

  const markerLines = findMarkerLines(notes);
  let firstParseError: ParseResult | undefined;
  for (let markerIndex = 0; markerIndex < markerLines.length - 1; markerIndex += 1) {
    const opener = markerLines[markerIndex];
    const closer = markerLines[markerIndex + 1];
    if (!opener?.canOpen || !closer?.canClose) continue;

    const profileYaml = extractProfileYaml(notes, opener, closer);
    if (profileYaml === null) continue;

    const parsed = parseProfileYaml(profileYaml);
    if (parsed.kind === "ok") return parsed;
    firstParseError ??= parsed;
  }

  return firstParseError ?? { kind: "absent" };
}

type MarkerLine = {
  canClose: boolean;
  canOpen: boolean;
  end: number;
  start: number;
};

function findMarkerLines(notes: string): MarkerLine[] {
  const markerLines: MarkerLine[] = [];
  let searchStart = 0;
  while (searchStart < notes.length) {
    const markerStart = notes.indexOf(MARKER_TEXT, searchStart);
    if (markerStart === -1) break;
    searchStart = markerStart + MARKER_TEXT.length;
    if (markerStart > 0 && notes[markerStart - 1] !== "\n") continue;

    const markerEnd = markerStart + MARKER_TEXT.length;
    markerLines.push({
      canClose: isClosingBoundary(notes[markerEnd]),
      canOpen: canOpenMarkerLine(notes, markerEnd),
      end: markerEnd,
      start: markerStart,
    });
  }

  return markerLines;
}

function canOpenMarkerLine(notes: string, markerEnd: number): boolean {
  for (let cursor = markerEnd; cursor < notes.length; cursor += 1) {
    const character = notes[cursor];
    if (character === "\n") return true;
    if (character === "\r" && notes[cursor + 1] === "\n") return true;
    if (!isHorizontalWhitespace(character)) return false;
  }

  return false;
}

function isHorizontalWhitespace(character: string | undefined): boolean {
  return character === " " || character === "\t" || character === "\f" || character === "\v";
}

function isClosingBoundary(character: string | undefined): boolean {
  return character === undefined || character === "\n" || character === "\r";
}

function extractProfileYaml(notes: string, opener: MarkerLine, closer: MarkerLine): string | null {
  const block = notes.slice(opener.start, closer.end);
  const markerMatch = block.match(MARKER_RE);
  if (markerMatch?.index !== 0 || markerMatch[0].length !== block.length) return null;
  return markerMatch[1] ?? "";
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
