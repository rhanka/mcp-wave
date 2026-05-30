import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  type CallToolResult,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { ToolError } from "../lib/errors.js";
import type { RegisteredTool } from "./define-tool.js";
import { envelopeFromError, toMcpResult } from "./error-bridge.js";
import type { ToolContext } from "./tool-context.js";

export interface BuildOptions {
  tools: readonly RegisteredTool[];
  makeCtx: () => ToolContext;
}

export function buildMcpServer(opts: BuildOptions): { server: Server } {
  const server = new Server(
    { name: "mcp-wave", version: "0.1.0" },
    { capabilities: { tools: { listChanged: true } } },
  );

  const announcedTools = opts.tools.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: z.toJSONSchema(t.inputSchema, { target: "draft-7" }) as Record<string, unknown>,
  }));

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: announcedTools }));

  server.setRequestHandler(CallToolRequestSchema, async (req): Promise<CallToolResult> => {
    const ctx = opts.makeCtx();
    const tool = opts.tools.find((t) => t.name === req.params.name);
    if (!tool) {
      const err = new ToolError(
        "UNKNOWN_TOOL",
        { name: req.params.name },
        `Unknown tool. Known: ${opts.tools.map((t) => t.name).join(", ")}.`,
      );
      ctx.logger.warn(
        { request_id: ctx.req.request_id, tool: req.params.name, code: err.code },
        "unknown tool",
      );
      return envelopeFromError(err) satisfies CallToolResult;
    }
    const result = await toMcpResult(tool)(req.params.arguments ?? {}, ctx);
    return result satisfies CallToolResult;
  });

  return { server };
}
