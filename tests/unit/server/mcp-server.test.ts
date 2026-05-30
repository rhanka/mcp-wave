import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineTool } from "../../../src/server/define-tool.js";
import { buildMcpServer } from "../../../src/server/mcp-server.js";
import type { ToolContext } from "../../../src/server/tool-context.js";

const stubTool = defineTool({
  name: "stub",
  description: "stub",
  inputSchema: z.object({}),
  async execute() {
    return {};
  },
});

const makeCtx = (): ToolContext => ({}) as ToolContext;

describe("buildMcpServer", () => {
  it("declares tools.listChanged: true capability so clients auto-refresh after a deploy", () => {
    const { server } = buildMcpServer({ tools: [stubTool], makeCtx });
    // _capabilities is declared private in the .d.ts but accessible at runtime.
    // We cast to introspect the declared capability without connecting to a
    // transport. This is the only way to assert the declaration without a
    // full MCP handshake.
    const caps = (server as unknown as { _capabilities: Record<string, unknown> })._capabilities;
    expect(caps.tools).toEqual({ listChanged: true });
  });
});
