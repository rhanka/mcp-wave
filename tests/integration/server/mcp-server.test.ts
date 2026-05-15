import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { defineTool } from "../../../src/server/define-tool.js";
import { buildMcpServer } from "../../../src/server/mcp-server.js";
import type { ToolContext } from "../../../src/server/tool-context.js";

type RequestHandler = (req: unknown) => Promise<unknown>;

function getHandler(server: unknown, method: string): RequestHandler {
  const handlers = (server as { _requestHandlers: Map<string, RequestHandler> })._requestHandlers;
  const handler = handlers.get(method);
  if (!handler) throw new Error(`missing handler for ${method}`);
  return handler;
}

function makeCtx(): ToolContext {
  return {
    req: { headers: null, request_id: "r" },
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  } as unknown as ToolContext;
}

const helloTool = defineTool({
  name: "hello",
  description: "Returns a greeting",
  inputSchema: z.object({ name: z.string() }),
  async execute(input) {
    return { greeting: `hello ${input.name}` };
  },
});

describe("buildMcpServer", () => {
  it("lists registered tools with a JSON schema", async () => {
    const { server } = buildMcpServer({ tools: [helloTool], makeCtx });
    const handler = getHandler(server, ListToolsRequestSchema.shape.method.value);
    const result = (await handler({ method: "tools/list", params: {} })) as {
      tools: Array<{ name: string; description: string; inputSchema: Record<string, unknown> }>;
    };
    expect(result.tools[0]?.name).toBe("hello");
    expect(result.tools[0]?.description).toBe("Returns a greeting");
    expect(result.tools[0]?.inputSchema).toBeTypeOf("object");
  });

  it("dispatches tools/call and returns the serialized result", async () => {
    const { server } = buildMcpServer({ tools: [helloTool], makeCtx });
    const handler = getHandler(server, CallToolRequestSchema.shape.method.value);
    const result = (await handler({
      method: "tools/call",
      params: { name: "hello", arguments: { name: "world" } },
    })) as { content: Array<{ text: string }> };
    const first = result.content[0];
    if (!first) throw new Error("expected content");
    expect(JSON.parse(first.text)).toEqual({ greeting: "hello world" });
  });

  it("returns UNKNOWN_TOOL as an isError envelope (not a thrown JSON-RPC error)", async () => {
    const { server } = buildMcpServer({ tools: [helloTool], makeCtx });
    const handler = getHandler(server, CallToolRequestSchema.shape.method.value);
    const result = (await handler({
      method: "tools/call",
      params: { name: "nope", arguments: {} },
    })) as { isError: boolean; content: Array<{ text: string }> };
    expect(result.isError).toBe(true);
    const first = result.content[0];
    if (!first) throw new Error("expected content");
    const body = JSON.parse(first.text) as { code: string; details: { name: string } };
    expect(body.code).toBe("UNKNOWN_TOOL");
    expect(body.details.name).toBe("nope");
  });

  it("dispatches a parameterless tool when arguments are omitted", async () => {
    const pingTool = defineTool({
      name: "ping",
      description: "no input",
      inputSchema: z.object({}),
      async execute() {
        return { ok: true };
      },
    });
    const { server } = buildMcpServer({ tools: [pingTool], makeCtx });
    const handler = getHandler(server, CallToolRequestSchema.shape.method.value);
    const result = (await handler({
      method: "tools/call",
      params: { name: "ping" },
    })) as { content: Array<{ text: string }> };
    const first = result.content[0];
    if (!first) throw new Error("expected content");
    expect(JSON.parse(first.text)).toEqual({ ok: true });
  });
});
