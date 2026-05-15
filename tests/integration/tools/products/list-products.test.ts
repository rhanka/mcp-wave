import { HttpResponse, graphql } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { ToolContext } from "../../../../src/server/tool-context.js";
import { listProductsTool } from "../../../../src/tools/products/list-products.js";
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

describe("list_products", () => {
  it("returns the list of products with snake_case keys and flattened income account", async () => {
    server.use(
      graphql.query("ListProducts", () =>
        HttpResponse.json({
          data: {
            business: {
              products: {
                pageInfo: { currentPage: 1, totalPages: 1, totalCount: 1 },
                edges: [
                  {
                    node: {
                      id: "prod_1",
                      name: "Consulting",
                      description: "Hourly consulting service",
                      unitPrice: "150.00",
                      incomeAccount: { id: "acct_income_1", name: "Sales" },
                    },
                  },
                ],
              },
            },
          },
        }),
      ),
    );
    const result = await listProductsTool.handler({}, makeCtx());
    expect(result).toMatchObject({
      products: [
        {
          id: "prod_1",
          name: "Consulting",
          description: "Hourly consulting service",
          unit_price: "150.00",
          income_account: { id: "acct_income_1", name: "Sales" },
        },
      ],
      page_info: { current_page: 1, total_pages: 1, total_count: 1 },
    });
  });
});
