import { ZodError } from "zod";
import { ToolError, normalizeError } from "../lib/errors.js";
import type { RegisteredTool } from "./define-tool.js";
import type { ToolContext } from "./tool-context.js";

export interface McpToolResult {
  isError?: boolean;
  content: Array<{ type: "text"; text: string }>;
  [key: string]: unknown;
}

export function envelopeFromError(err: ToolError): McpToolResult {
  return {
    isError: true,
    content: [{ type: "text", text: JSON.stringify(err.toJSON()) }],
  };
}

export function toMcpResult(
  tool: RegisteredTool,
): (input: unknown, ctx: ToolContext) => Promise<McpToolResult> {
  return async (input, ctx) => {
    try {
      const result = await tool.handler(input, ctx);
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    } catch (e) {
      if (e instanceof ZodError) {
        const err = new ToolError(
          "INVALID_INPUT",
          { issues: e.issues.map((i) => ({ path: i.path.join("."), message: i.message })) },
          "Tool arguments did not match the schema.",
        );
        ctx.logger.warn(
          { request_id: ctx.req.request_id, tool: tool.name, code: err.code },
          "invalid tool input",
        );
        return envelopeFromError(err);
      }
      if (e instanceof ToolError) {
        ctx.logger.warn(
          {
            request_id: ctx.req.request_id,
            tool: tool.name,
            code: e.code,
            details: e.details,
          },
          "tool error",
        );
        return envelopeFromError(e);
      }
      const normalized = normalizeError(e);
      ctx.logger.error(
        {
          request_id: ctx.req.request_id,
          tool: tool.name,
          message: normalized.details.message,
          stack: normalized.details.stack,
          value: normalized.details.value,
        },
        "unhandled tool error",
      );
      const redacted = new ToolError("INTERNAL_ERROR", {}, "An unexpected error occurred.");
      return envelopeFromError(redacted);
    }
  };
}
