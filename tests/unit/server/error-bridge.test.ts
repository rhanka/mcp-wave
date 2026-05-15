import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ToolError } from "../../../src/lib/errors.js";
import { defineTool } from "../../../src/server/define-tool.js";
import { toMcpResult } from "../../../src/server/error-bridge.js";
import type { ToolContext } from "../../../src/server/tool-context.js";

const ctx = (): ToolContext =>
  ({
    req: { headers: null, request_id: "r" },
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  }) as unknown as ToolContext;

function parseText(r: { content: Array<{ type: "text"; text: string }> }): unknown {
  const first = r.content[0];
  if (!first) throw new Error("expected content entry");
  return JSON.parse(first.text);
}

describe("toMcpResult", () => {
  it("wraps a successful result", async () => {
    const tool = defineTool({
      name: "ok",
      description: "x",
      inputSchema: z.object({}),
      async execute() {
        return { hello: "world" };
      },
    });
    const r = await toMcpResult(tool)({}, ctx());
    expect(r.isError).toBeUndefined();
    expect(r.content[0]?.type).toBe("text");
    expect(parseText(r)).toEqual({ hello: "world" });
  });

  it("converts a ToolError to an isError result with code/details/hint", async () => {
    const tool = defineTool({
      name: "fail",
      description: "x",
      inputSchema: z.object({}),
      async execute() {
        throw new ToolError("X_FAILED", { why: "because" }, "do better");
      },
    });
    const r = await toMcpResult(tool)({}, ctx());
    expect(r.isError).toBe(true);
    expect(parseText(r)).toEqual({
      code: "X_FAILED",
      details: { why: "because" },
      hint: "do better",
    });
  });

  it("converts a Zod validation error to INVALID_INPUT", async () => {
    const tool = defineTool({
      name: "v",
      description: "x",
      inputSchema: z.object({ n: z.number() }),
      async execute() {
        return null;
      },
    });
    const r = await toMcpResult(tool)({ n: "x" }, ctx());
    expect(r.isError).toBe(true);
    const body = parseText(r) as { code: string };
    expect(body.code).toBe("INVALID_INPUT");
  });

  it("wraps an unknown thrown value as INTERNAL_ERROR", async () => {
    const tool = defineTool({
      name: "weird",
      description: "x",
      inputSchema: z.object({}),
      async execute() {
        throw "not even an Error";
      },
    });
    const r = await toMcpResult(tool)({}, ctx());
    expect(r.isError).toBe(true);
    const body = parseText(r) as { code: string };
    expect(body.code).toBe("INTERNAL_ERROR");
  });
});
