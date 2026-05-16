import { graphql, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { ToolContext } from "../../../../src/server/tool-context.js";
import { listCustomersTool } from "../../../../src/tools/customers/list-customers.js";
import { MockProvider } from "../../../../src/wave/auth/mock.js";
import { WaveClient } from "../../../../src/wave/client.js";

const ENDPOINT = "https://gql.waveapps.com/graphql/public";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function ctx(): ToolContext {
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

const PROFILE = `---mcp-wave---
alias: acme
unit: hours
hourly_rate: 95
currency: CAD
send_to: [billing@example.com]
---mcp-wave---`;

describe("list_customers", () => {
  it("returns customers with parsed profiles when with_profiles=true", async () => {
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
                      id: "cust_1",
                      name: "Acme",
                      email: "billing@example.com",
                      currency: { code: "CAD" },
                      internalNotes: PROFILE,
                    },
                  },
                ],
              },
            },
          },
        }),
      ),
    );
    const r = (await listCustomersTool.handler({ with_profiles: true }, ctx())) as {
      customers: Array<{ id: string; profile: { kind: string } }>;
    };
    expect(r.customers[0]?.profile.kind).toBe("ok");
  });

  it("omits the profile field when with_profiles is false", async () => {
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
                      name: "x",
                      email: null,
                      currency: { code: "CAD" },
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
    const r = (await listCustomersTool.handler({}, ctx())) as {
      customers: Array<Record<string, unknown>>;
    };
    expect(r.customers[0]).not.toHaveProperty("profile");
  });

  it("throws BUSINESS_NOT_FOUND when business is null", async () => {
    server.use(
      graphql.query("ListCustomers", () => HttpResponse.json({ data: { business: null } })),
    );
    await expect(listCustomersTool.handler({}, ctx())).rejects.toMatchObject({
      code: "BUSINESS_NOT_FOUND",
    });
  });
});
