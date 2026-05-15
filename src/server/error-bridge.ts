import { ZodError } from "zod";
import { ToolError, normalizeError } from "../lib/errors.js";
import type { RegisteredTool } from "./define-tool.js";
import type { ToolContext } from "./tool-context.js";

export interface McpToolResult {
  isError?: boolean;
  content: Array<{ type: "text"; text: string }>;
}

export function toMcpResult(
  tool: RegisteredTool,
): (input: unknown, ctx: ToolContext) => Promise<McpToolResult> {
  return async (input, ctx) => {
    try {
      const result = await tool.handler(input, ctx);
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    } catch (e) {
      let err: ToolError;
      if (e instanceof ZodError) {
        err = new ToolError(
          "INVALID_INPUT",
          { issues: e.issues.map((i) => ({ path: i.path.join("."), message: i.message })) },
          "Tool arguments did not match the schema.",
        );
      } else {
        err = normalizeError(e);
      }
      ctx.logger.warn(
        { request_id: ctx.req.request_id, tool: tool.name, code: err.code, details: err.details },
        "tool error",
      );
      return {
        isError: true,
        content: [{ type: "text", text: JSON.stringify(err.toJSON()) }],
      };
    }
  };
}
