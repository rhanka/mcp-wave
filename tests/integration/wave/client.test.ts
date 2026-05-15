import { HttpResponse, graphql } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { MockProvider } from "../../../src/wave/auth/mock.js";
import { WaveClient } from "../../../src/wave/client.js";

const ENDPOINT = "https://gql.waveapps.com/graphql/public";
const REQ = { headers: null, request_id: "test" };

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("WaveClient", () => {
  it("sends Authorization: Bearer <token> from the provider", async () => {
    let receivedAuth: string | null = null;
    server.use(
      graphql.query("ListBusinesses", ({ request }) => {
        receivedAuth = request.headers.get("authorization");
        return HttpResponse.json({
          data: {
            businesses: {
              pageInfo: { currentPage: 1, totalPages: 1, totalCount: 0 },
              edges: [],
            },
          },
        });
      }),
    );
    const client = new WaveClient({ endpoint: ENDPOINT, provider: new MockProvider("tok123") });
    await client.listBusinesses(REQ, { pageSize: 1, page: 1 });
    expect(receivedAuth).toBe("Bearer tok123");
  });

  it("retries on 5xx then succeeds", async () => {
    let attempts = 0;
    server.use(
      graphql.query("ListBusinesses", () => {
        attempts++;
        if (attempts < 2) {
          return HttpResponse.json(
            { errors: [{ extensions: { code: "INTERNAL_SERVER_ERROR" }, message: "boom" }] },
            { status: 500 },
          );
        }
        return HttpResponse.json({
          data: {
            businesses: {
              pageInfo: { currentPage: 1, totalPages: 1, totalCount: 0 },
              edges: [],
            },
          },
        });
      }),
    );
    const client = new WaveClient({
      endpoint: ENDPOINT,
      provider: new MockProvider("x"),
      retry: { retries: 2, minTimeout: 1, maxTimeout: 5 },
    });
    const r = await client.listBusinesses(REQ, { pageSize: 1, page: 1 });
    expect(r.businesses?.pageInfo.totalCount).toBe(0);
    expect(attempts).toBe(2);
  });

  it("does not retry on 401", async () => {
    let attempts = 0;
    server.use(
      graphql.query("ListBusinesses", () => {
        attempts++;
        return HttpResponse.json(
          { errors: [{ extensions: { code: "AUTHENTICATION_ERROR" }, message: "bad" }] },
          { status: 401 },
        );
      }),
    );
    const client = new WaveClient({
      endpoint: ENDPOINT,
      provider: new MockProvider("x"),
      retry: { retries: 3, minTimeout: 1 },
    });
    await expect(client.listBusinesses(REQ, { pageSize: 1, page: 1 })).rejects.toMatchObject({
      code: "WAVE_AUTHENTICATION_ERROR",
    });
    expect(attempts).toBe(1);
  });

  it("retries on a transient network failure", async () => {
    let attempts = 0;
    server.use(
      graphql.query("ListBusinesses", () => {
        attempts++;
        if (attempts < 2) return HttpResponse.error();
        return HttpResponse.json({
          data: {
            businesses: {
              pageInfo: { currentPage: 1, totalPages: 1, totalCount: 0 },
              edges: [],
            },
          },
        });
      }),
    );
    const client = new WaveClient({
      endpoint: ENDPOINT,
      provider: new MockProvider("x"),
      retry: { retries: 3, minTimeout: 1, maxTimeout: 5 },
    });
    await client.listBusinesses(REQ, { pageSize: 1, page: 1 });
    expect(attempts).toBe(2);
  });

  it("maps 429 with empty errors array using the HTTP status", async () => {
    server.use(
      graphql.query("ListBusinesses", () => HttpResponse.json({ errors: [] }, { status: 429 })),
    );
    const client = new WaveClient({
      endpoint: ENDPOINT,
      provider: new MockProvider("x"),
      retry: { retries: 0 },
    });
    await expect(client.listBusinesses(REQ, { pageSize: 1, page: 1 })).rejects.toMatchObject({
      code: "WAVE_RATE_LIMITED",
    });
  });

  it("aborts the request when it exceeds timeoutMs", async () => {
    server.use(
      graphql.query("ListBusinesses", async () => {
        await new Promise((r) => setTimeout(r, 200));
        return HttpResponse.json({
          data: {
            businesses: {
              pageInfo: { currentPage: 1, totalPages: 1, totalCount: 0 },
              edges: [],
            },
          },
        });
      }),
    );
    const client = new WaveClient({
      endpoint: ENDPOINT,
      provider: new MockProvider("x"),
      timeoutMs: 20,
      retry: { retries: 0 },
    });
    await expect(client.listBusinesses(REQ, { pageSize: 1, page: 1 })).rejects.toMatchObject({
      code: "WAVE_TIMEOUT",
    });
  });
});
