import { HttpResponse, graphql } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { ToolContext } from "../../../../src/server/tool-context.js";
import { listBusinessesTool } from "../../../../src/tools/businesses/list-businesses.js";
import { MockProvider } from "../../../../src/wave/auth/mock.js";
import { WaveClient } from "../../../../src/wave/client.js";

const ENDPOINT = "https://gql.waveapps.com/graphql/public";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function makeCtx(): ToolContext {
  return {
    req: { headers: null, request_id: "test" },
    wave: new WaveClient({ endpoint: ENDPOINT, provider: new MockProvider("x") }),
    taxRates: {} as never,
    accountMapping: {} as never,
    env: { WAVE_DEFAULT_BUSINESS_ID: "biz_x" } as never,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never,
    identity: "mock",
  };
}

describe("list_businesses", () => {
  it("returns the list of businesses with snake_case keys", async () => {
    server.use(
      graphql.query("ListBusinesses", () =>
        HttpResponse.json({
          data: {
            businesses: {
              pageInfo: { currentPage: 1, totalPages: 1, totalCount: 1 },
              edges: [
                {
                  node: {
                    id: "biz_x",
                    name: "Acme",
                    currency: { code: "CAD" },
                    timezone: "UTC",
                  },
                },
              ],
            },
          },
        }),
      ),
    );
    const result = await listBusinessesTool.handler({}, makeCtx());
    expect(result).toMatchObject({
      businesses: [{ id: "biz_x", name: "Acme", currency: "CAD", timezone: "UTC" }],
      page_info: { current_page: 1, total_pages: 1, total_count: 1 },
    });
  });

  it("honors page and page_size arguments", async () => {
    let received: { page?: number; pageSize?: number } | null = null;
    server.use(
      graphql.query("ListBusinesses", ({ variables }) => {
        received = variables as { page?: number; pageSize?: number };
        return HttpResponse.json({
          data: {
            businesses: {
              pageInfo: { currentPage: 2, totalPages: 5, totalCount: 99 },
              edges: [],
            },
          },
        });
      }),
    );
    await listBusinessesTool.handler({ page: 2, page_size: 10 }, makeCtx());
    expect(received).toEqual({ page: 2, pageSize: 10 });
  });
});
