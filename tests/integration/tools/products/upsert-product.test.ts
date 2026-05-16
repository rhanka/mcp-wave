import { graphql, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { ToolContext } from "../../../../src/server/tool-context.js";
import { upsertProductTool } from "../../../../src/tools/products/upsert-product.js";
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

describe("upsert_product", () => {
  it("creates a new product when product_id is omitted", async () => {
    server.use(
      graphql.mutation("ProductCreate", () =>
        HttpResponse.json({
          data: {
            productCreate: {
              didSucceed: true,
              inputErrors: null,
              product: {
                id: "prod_new",
                name: "Consulting",
                description: null,
                unitPrice: "150.00",
                incomeAccount: null,
              },
            },
          },
        }),
      ),
    );

    const result = await upsertProductTool.handler(
      { name: "Consulting", unit_price: 150 },
      makeCtx(),
    );

    expect(result).toEqual({
      product_id: "prod_new",
      name: "Consulting",
      unit_price: "150.00",
      action: "created",
    });
  });

  it("patches an existing product when product_id is provided", async () => {
    server.use(
      graphql.mutation("ProductPatch", () =>
        HttpResponse.json({
          data: {
            productPatch: {
              didSucceed: true,
              inputErrors: null,
              product: {
                id: "prod_existing",
                name: "Consulting v2",
                description: null,
                unitPrice: "175.00",
              },
            },
          },
        }),
      ),
    );

    const result = await upsertProductTool.handler(
      { product_id: "prod_existing", name: "Consulting v2", unit_price: 175 },
      makeCtx(),
    );

    expect(result).toEqual({
      product_id: "prod_existing",
      name: "Consulting v2",
      unit_price: "175.00",
      action: "patched",
    });
  });

  it("throws WAVE_VALIDATION_ERROR when ProductCreate did not succeed", async () => {
    server.use(
      graphql.mutation("ProductCreate", () =>
        HttpResponse.json({
          data: {
            productCreate: {
              didSucceed: false,
              inputErrors: [
                { code: "NOT_UNIQUE", message: "Product name already exists", path: ["name"] },
              ],
              product: null,
            },
          },
        }),
      ),
    );

    await expect(
      upsertProductTool.handler({ name: "Dup", unit_price: 10 }, makeCtx()),
    ).rejects.toMatchObject({ code: "WAVE_VALIDATION_ERROR" });
  });

  it("throws when CREATE is missing required fields (name/unit_price)", async () => {
    await expect(upsertProductTool.handler({}, makeCtx())).rejects.toBeDefined();
  });
});
