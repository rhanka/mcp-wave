import { graphql, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { ToolContext } from "../../../../src/server/tool-context.js";
import { listClientProfilesTool } from "../../../../src/tools/profiles/list-client-profiles.js";
import { MockProvider } from "../../../../src/wave/auth/mock.js";
import { WaveClient } from "../../../../src/wave/client.js";

const ENDPOINT = "https://gql.waveapps.com/graphql/public";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function ctx(): ToolContext {
  return {
    req: { headers: null, request_id: "t" },
    wave: new WaveClient({ endpoint: ENDPOINT, provider: new MockProvider("x") }),
    taxRates: {} as never,
    accountMapping: {} as never,
    env: { WAVE_DEFAULT_BUSINESS_ID: "biz_x" } as never,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never,
    identity: "mock",
  };
}

describe("list_client_profiles", () => {
  it("returns parsed profiles and skips customers with no profile", async () => {
    server.use(
      graphql.query("ListCustomers", () =>
        HttpResponse.json({
          data: {
            business: {
              customers: {
                pageInfo: { currentPage: 1, totalPages: 1, totalCount: 2 },
                edges: [
                  {
                    node: {
                      id: "c1",
                      name: "Acme",
                      email: "x@y.z",
                      currency: { code: "CAD" },
                      internalNotes: `---mcp-wave---
alias: acme
currency: CAD
send_to: [billing@example.com]
---mcp-wave---`,
                    },
                  },
                  {
                    node: {
                      id: "c2",
                      name: "NoProfile",
                      email: null,
                      currency: { code: "USD" },
                      internalNotes: null,
                    },
                  },
                ],
              },
            },
          },
        }),
      ),
    );
    const r = (await listClientProfilesTool.handler({}, ctx())) as {
      profiles: unknown[];
      errors: unknown[];
    };
    expect(r.profiles).toHaveLength(1);
    expect(r.errors).toHaveLength(0);
  });

  it("captures parse errors when a profile block is malformed", async () => {
    server.use(
      graphql.query("ListCustomers", () =>
        HttpResponse.json({
          data: {
            business: {
              customers: {
                pageInfo: { currentPage: 1, totalPages: 1, totalCount: 1 },
                edges: [
                  {
                    node: {
                      id: "c1",
                      name: "Broken",
                      email: null,
                      currency: { code: "CAD" },
                      internalNotes: `---mcp-wave---
alias: 12
currency: BAD
---mcp-wave---`,
                    },
                  },
                ],
              },
            },
          },
        }),
      ),
    );
    const r = (await listClientProfilesTool.handler({}, ctx())) as {
      profiles: unknown[];
      errors: Array<{ customer_id: string }>;
    };
    expect(r.profiles).toHaveLength(0);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]?.customer_id).toBe("c1");
  });
});
