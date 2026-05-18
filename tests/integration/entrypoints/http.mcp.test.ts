import { beforeAll, describe, expect, it } from "vitest";

beforeAll(() => {
  process.env.WAVE_AUTH_MODE = "mock";
  process.env.WAVE_API_TOKEN = "fake";
  process.env.WAVE_DEFAULT_BUSINESS_ID = "biz_x";
  process.env.WAVE_GRAPHQL_ENDPOINT = "https://example.invalid/graphql";
  process.env.LOG_LEVEL = "fatal";
  process.env.NODE_ENV = "test";
  process.env.ALLOWED_ORIGINS = "https://claude.ai,http://localhost:*";
  process.env.RATE_LIMIT_RPM = "60";
});

function mcpHeaders(extra?: Record<string, string>): Record<string, string> {
  return {
    accept: "application/json, text/event-stream",
    "content-type": "application/json",
    origin: "https://claude.ai",
    ...extra,
  };
}

describe("http /mcp", () => {
  it("initializes a streamable HTTP session and lists tools", async () => {
    const { app } = await import("../../../src/entrypoints/http.js");

    const initializeResponse = await app.request("/mcp", {
      method: "POST",
      headers: mcpHeaders(),
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "http-test", version: "0" },
        },
      }),
    });

    expect(initializeResponse.status).toBe(200);
    const sessionId = initializeResponse.headers.get("mcp-session-id");
    expect(sessionId).toBeTruthy();
    const initialized = (await initializeResponse.json()) as {
      result: { serverInfo: { name: string } };
    };
    expect(initialized.result.serverInfo.name).toBe("mcp-wave");

    const initializedNotificationResponse = await app.request("/mcp", {
      method: "POST",
      headers: mcpHeaders({ "mcp-session-id": sessionId ?? "" }),
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "notifications/initialized",
      }),
    });
    expect(initializedNotificationResponse.status).toBe(202);

    const toolsResponse = await app.request("/mcp", {
      method: "POST",
      headers: mcpHeaders({ "mcp-session-id": sessionId ?? "" }),
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/list",
        params: {},
      }),
    });

    expect(toolsResponse.status).toBe(200);
    const toolsBody = (await toolsResponse.json()) as {
      result: { tools: Array<{ name: string }> };
    };
    expect(toolsBody.result.tools.map((tool) => tool.name)).toContain("list_businesses");
    expect(toolsBody.result.tools.map((tool) => tool.name)).toContain("setup_account_mapping");
  });
});
