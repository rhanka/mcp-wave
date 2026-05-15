import { HttpResponse, graphql } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { ToolContext } from "../../../../src/server/tool-context.js";
import { listVendorsTool } from "../../../../src/tools/vendors/list-vendors.js";
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

describe("list_vendors", () => {
  it("returns the list of vendors with snake_case keys and currency code", async () => {
    server.use(
      graphql.query("ListVendors", () =>
        HttpResponse.json({
          data: {
            business: {
              vendors: {
                pageInfo: { currentPage: 1, totalPages: 1, totalCount: 1 },
                edges: [
                  {
                    node: {
                      id: "vendor_1",
                      name: "Acme Supplies",
                      email: "ap@acme-supplies.example",
                      currency: { code: "USD" },
                    },
                  },
                ],
              },
            },
          },
        }),
      ),
    );
    const result = await listVendorsTool.handler({}, makeCtx());
    expect(result).toMatchObject({
      vendors: [
        {
          id: "vendor_1",
          name: "Acme Supplies",
          email: "ap@acme-supplies.example",
          currency: "USD",
        },
      ],
      page_info: { current_page: 1, total_pages: 1, total_count: 1 },
    });
  });

  it("forwards page, page_size, and business_id to the query", async () => {
    let received: { businessId?: string; page?: number; pageSize?: number } | null = null;
    server.use(
      graphql.query("ListVendors", ({ variables }) => {
        received = variables as { businessId?: string; page?: number; pageSize?: number };
        return HttpResponse.json({
          data: {
            business: {
              vendors: {
                pageInfo: { currentPage: 2, totalPages: 5, totalCount: 42 },
                edges: [],
              },
            },
          },
        });
      }),
    );
    await listVendorsTool.handler({ business_id: "biz_y", page: 2, page_size: 10 }, makeCtx());
    expect(received).toEqual({ businessId: "biz_y", page: 2, pageSize: 10 });
  });

  it("throws BUSINESS_NOT_FOUND when the business is null", async () => {
    server.use(graphql.query("ListVendors", () => HttpResponse.json({ data: { business: null } })));
    await expect(listVendorsTool.handler({}, makeCtx())).rejects.toMatchObject({
      code: "BUSINESS_NOT_FOUND",
    });
  });

  it("throws BUSINESS_ID_REQUIRED when no business id is configured", async () => {
    const ctx = makeCtx();
    (ctx as { env: Record<string, unknown> }).env = {};
    await expect(listVendorsTool.handler({}, ctx)).rejects.toMatchObject({
      code: "BUSINESS_ID_REQUIRED",
    });
  });
});
