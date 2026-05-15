import type { z } from "zod";
import type { ToolContext } from "./tool-context.js";

export interface ToolDefinition<I, O> {
  name: string;
  description: string;
  inputSchema: z.ZodType<I>;
  execute(input: I, ctx: ToolContext): Promise<O>;
}

export interface RegisteredTool {
  name: string;
  description: string;
  inputSchema: z.ZodType<unknown>;
  handler(rawInput: unknown, ctx: ToolContext): Promise<unknown>;
}

export function defineTool<I, O>(def: ToolDefinition<I, O>): RegisteredTool {
  return {
    name: def.name,
    description: def.description,
    inputSchema: def.inputSchema,
    async handler(rawInput: unknown, ctx: ToolContext): Promise<unknown> {
      const input = def.inputSchema.parse(rawInput);
      return def.execute(input, ctx);
    },
  };
}
