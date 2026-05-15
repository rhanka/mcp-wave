import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { defineTool } from "../../../src/server/define-tool.js";
import type { ToolContext } from "../../../src/server/tool-context.js";

const ctx = (): ToolContext => ({
  req: { headers: null, request_id: "req_1" },
  wave: {} as never,
  taxRates: {} as never,
  accountMapping: {} as never,
  env: {} as never,
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never,
  identity: "mock",
});

describe("defineTool", () => {
  it("registers name, description, and inputSchema", () => {
    const t = defineTool({
      name: "do_thing",
      description: "Does a thing",
      inputSchema: z.object({ x: z.number() }),
      async execute(input) {
        return { doubled: input.x * 2 };
      },
    });
    expect(t.name).toBe("do_thing");
    expect(t.description).toBe("Does a thing");
    expect(t.inputSchema).toBeDefined();
  });

  it("invokes execute with parsed input", async () => {
    const t = defineTool({
      name: "x",
      description: "x",
      inputSchema: z.object({ n: z.number() }),
      async execute(input) {
        return { n: input.n };
      },
    });
    const r = await t.handler({ n: 21 }, ctx());
    expect(r).toEqual({ n: 21 });
  });

  it("throws on invalid input (Zod surfaces a usable error)", async () => {
    const t = defineTool({
      name: "x",
      description: "x",
      inputSchema: z.object({ n: z.number() }),
      async execute() {
        return null;
      },
    });
    await expect(t.handler({ n: "not-a-number" }, ctx())).rejects.toThrow();
  });
});
