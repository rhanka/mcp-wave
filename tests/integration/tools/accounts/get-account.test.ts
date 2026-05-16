import { graphql, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ToolError } from "../../../../src/lib/errors.js";
import type { ToolContext } from "../../../../src/server/tool-context.js";
import { getAccountTool } from "../../../../src/tools/accounts/get-account.js";
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

describe("get_account", () => {
  it("returns the account with snake_case keys", async () => {
    server.use(
      graphql.query("GetAccount", () =>
        HttpResponse.json({
          data: {
            business: {
              account: {
                id: "acc_1",
                name: "Cash on Hand",
                type: { value: "ASSET", normalBalanceType: "DEBIT" },
                subtype: { value: "CASH_AND_BANK" },
                currency: { code: "CAD" },
              },
            },
          },
        }),
      ),
    );
    const result = await getAccountTool.handler({ account_id: "acc_1" }, makeCtx());
    expect(result).toEqual({
      id: "acc_1",
      name: "Cash on Hand",
      type: "ASSET",
      normal_balance_type: "DEBIT",
      subtype: "CASH_AND_BANK",
      currency: "CAD",
    });
  });

  it("throws ACCOUNT_NOT_FOUND when business.account is null", async () => {
    server.use(
      graphql.query("GetAccount", () =>
        HttpResponse.json({
          data: { business: { account: null } },
        }),
      ),
    );
    await expect(
      getAccountTool.handler({ account_id: "missing" }, makeCtx()),
    ).rejects.toMatchObject({
      code: "ACCOUNT_NOT_FOUND",
    });
    await expect(
      getAccountTool.handler({ account_id: "missing" }, makeCtx()),
    ).rejects.toBeInstanceOf(ToolError);
  });
});
