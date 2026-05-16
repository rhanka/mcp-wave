import { graphql, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { ToolContext } from "../../../../src/server/tool-context.js";
import { getCustomerTool } from "../../../../src/tools/customers/get-customer.js";
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

describe("get_customer", () => {
  it("returns the customer flattened to snake_case", async () => {
    server.use(
      graphql.query("GetCustomer", () =>
        HttpResponse.json({
          data: {
            business: {
              customer: {
                id: "c1",
                name: "Acme",
                email: "x@y.z",
                internalNotes: "raw notes here",
                currency: { code: "CAD" },
              },
            },
          },
        }),
      ),
    );
    const r = (await getCustomerTool.handler({ customer_id: "c1" }, ctx())) as Record<
      string,
      unknown
    >;
    expect(r).toMatchObject({
      id: "c1",
      name: "Acme",
      email: "x@y.z",
      currency: "CAD",
      internal_notes_raw: "raw notes here",
    });
    expect(r).not.toHaveProperty("profile");
  });

  it("parses the profile when with_profile=true", async () => {
    server.use(
      graphql.query("GetCustomer", () =>
        HttpResponse.json({
          data: {
            business: {
              customer: {
                id: "c1",
                name: "Acme",
                email: null,
                internalNotes: `---mcp-wave---
alias: acme
currency: CAD
send_to: [billing@example.com]
---mcp-wave---`,
                currency: { code: "CAD" },
              },
            },
          },
        }),
      ),
    );
    const r = (await getCustomerTool.handler({ customer_id: "c1", with_profile: true }, ctx())) as {
      profile: { kind: string };
    };
    expect(r.profile.kind).toBe("ok");
  });

  it("throws CUSTOMER_NOT_FOUND when business.customer is null", async () => {
    server.use(
      graphql.query("GetCustomer", () =>
        HttpResponse.json({ data: { business: { customer: null } } }),
      ),
    );
    await expect(getCustomerTool.handler({ customer_id: "missing" }, ctx())).rejects.toMatchObject({
      code: "CUSTOMER_NOT_FOUND",
    });
  });
});
