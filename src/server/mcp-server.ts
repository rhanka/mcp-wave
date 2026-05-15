import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  type CallToolResult,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { zodToJsonSchema } from "zod-to-json-schema";
import { ToolError } from "../lib/errors.js";
import type { RegisteredTool } from "./define-tool.js";
import { toMcpResult } from "./error-bridge.js";
import type { ToolContext } from "./tool-context.js";

export interface BuildOptions {
  tools: readonly RegisteredTool[];
  makeCtx: () => ToolContext;
}

export function buildMcpServer(opts: BuildOptions): { server: Server } {
  const server = new Server(
    { name: "mcp-wave", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: opts.tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: zodToJsonSchema(t.inputSchema, { target: "openApi3" }) as Record<
        string,
        unknown
      >,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req): Promise<CallToolResult> => {
    const tool = opts.tools.find((t) => t.name === req.params.name);
    if (!tool) {
      throw new ToolError("UNKNOWN_TOOL", { name: req.params.name });
    }
    const ctx = opts.makeCtx();
    const result = await toMcpResult(tool)(req.params.arguments ?? {}, ctx);
    return result as CallToolResult;
  });

  return { server };
}
