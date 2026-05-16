import { graphql, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { ToolContext } from "../../../../src/server/tool-context.js";
import { createCustomerTool } from "../../../../src/tools/customers/create-customer.js";
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

describe("create_customer", () => {
  it("wraps notes_yaml between mcp-wave markers and forwards as internalNotes", async () => {
    let received: { input?: Record<string, unknown> } | undefined;
    const expectedNotes = `---mcp-wave---\nalias: acme\ncurrency: CAD\n---mcp-wave---`;

    server.use(
      graphql.mutation("CustomerCreate", ({ variables }) => {
        received = variables as { input?: Record<string, unknown> };
        return HttpResponse.json({
          data: {
            customerCreate: {
              didSucceed: true,
              inputErrors: null,
              customer: {
                id: "cust_new",
                name: "Acme",
                email: "billing@example.com",
                internalNotes: expectedNotes,
                currency: { code: "CAD" },
              },
            },
          },
        });
      }),
    );

    const result = (await createCustomerTool.handler(
      {
        name: "Acme",
        email: "billing@example.com",
        currency: "CAD",
        notes_yaml: "alias: acme\ncurrency: CAD",
      },
      makeCtx(),
    )) as {
      customer_id: string;
      name: string;
      email: string;
      currency: string;
      internal_notes_raw: string;
    };

    expect(received?.input).toMatchObject({
      businessId: "biz_x",
      name: "Acme",
      email: "billing@example.com",
      currency: "CAD",
      internalNotes: expectedNotes,
    });
    expect(result).toEqual({
      customer_id: "cust_new",
      name: "Acme",
      email: "billing@example.com",
      currency: "CAD",
      internal_notes_raw: expectedNotes,
    });
  });

  it("throws WAVE_VALIDATION_ERROR when didSucceed is false", async () => {
    server.use(
      graphql.mutation("CustomerCreate", () =>
        HttpResponse.json({
          data: {
            customerCreate: {
              didSucceed: false,
              inputErrors: [{ code: "INVALID", message: "bad email", path: ["email"] }],
              customer: null,
            },
          },
        }),
      ),
    );

    await expect(
      createCustomerTool.handler({ name: "Acme", email: "not-an-email@x.com" }, makeCtx()),
    ).rejects.toMatchObject({ code: "WAVE_VALIDATION_ERROR" });
  });

  it("omits internalNotes from variables when notes_yaml is not provided", async () => {
    let received: { input?: Record<string, unknown> } | undefined;

    server.use(
      graphql.mutation("CustomerCreate", ({ variables }) => {
        received = variables as { input?: Record<string, unknown> };
        return HttpResponse.json({
          data: {
            customerCreate: {
              didSucceed: true,
              inputErrors: null,
              customer: {
                id: "cust_plain",
                name: "Plain",
                email: null,
                internalNotes: null,
                currency: { code: "USD" },
              },
            },
          },
        });
      }),
    );

    await createCustomerTool.handler({ name: "Plain" }, makeCtx());

    expect(received?.input).toBeDefined();
    expect(received?.input).not.toHaveProperty("internalNotes");
  });
});
