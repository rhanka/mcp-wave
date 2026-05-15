import { HttpResponse, graphql } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { ToolContext } from "../../../../src/server/tool-context.js";
import { listAccountsTool } from "../../../../src/tools/accounts/list-accounts.js";
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

describe("list_accounts", () => {
  it("returns flattened accounts with snake_case keys", async () => {
    server.use(
      graphql.query("ListAccounts", () =>
        HttpResponse.json({
          data: {
            business: {
              accounts: {
                edges: [
                  {
                    node: {
                      id: "acc_1",
                      name: "Cash on Hand",
                      type: { value: "ASSET", normalBalanceType: "DEBIT" },
                      subtype: { value: "CASH_AND_BANK" },
                      currency: { code: "CAD" },
                    },
                  },
                  {
                    node: {
                      id: "acc_2",
                      name: "Sales",
                      type: { value: "INCOME", normalBalanceType: "CREDIT" },
                      subtype: { value: "INCOME" },
                      currency: { code: "CAD" },
                    },
                  },
                ],
              },
            },
          },
        }),
      ),
    );
    const result = await listAccountsTool.handler({}, makeCtx());
    expect(result).toEqual({
      accounts: [
        {
          id: "acc_1",
          name: "Cash on Hand",
          type: "ASSET",
          normal_balance_type: "DEBIT",
          subtype: "CASH_AND_BANK",
          currency: "CAD",
        },
        {
          id: "acc_2",
          name: "Sales",
          type: "INCOME",
          normal_balance_type: "CREDIT",
          subtype: "INCOME",
          currency: "CAD",
        },
      ],
    });
  });

  it("forwards the type filter as a single-element types array", async () => {
    let received: { businessId?: string; types?: string[] } | null = null;
    server.use(
      graphql.query("ListAccounts", ({ variables }) => {
        received = variables as { businessId?: string; types?: string[] };
        return HttpResponse.json({
          data: { business: { accounts: { edges: [] } } },
        });
      }),
    );
    await listAccountsTool.handler({ type: "EXPENSE" }, makeCtx());
    expect(received).toEqual({ businessId: "biz_x", types: ["EXPENSE"] });
  });
});
