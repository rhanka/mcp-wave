import { describe, expect, it } from "vitest";
import { BearerHeaderProvider } from "../../../../src/wave/auth/bearer-passthrough.js";

const ctx = (auth?: string) => ({
  headers: auth ? new Headers({ authorization: auth }) : new Headers(),
  request_id: "req_1",
});

describe("BearerHeaderProvider", () => {
  it("extracts token from 'Bearer <token>'", async () => {
    const p = new BearerHeaderProvider();
    expect(await p.getToken(ctx("Bearer abc.def"))).toBe("abc.def");
  });

  it("is case-insensitive on 'Bearer'", async () => {
    const p = new BearerHeaderProvider();
    expect(await p.getToken(ctx("bearer xyz"))).toBe("xyz");
  });

  it("trims surrounding whitespace from the token", async () => {
    const p = new BearerHeaderProvider();
    expect(await p.getToken(ctx("Bearer   abc   "))).toBe("abc");
  });

  it("throws AUTH_BEARER_MISSING when header absent", async () => {
    const p = new BearerHeaderProvider();
    await expect(p.getToken(ctx())).rejects.toMatchObject({ code: "AUTH_BEARER_MISSING" });
  });

  it("throws AUTH_BEARER_MISSING when scheme is not Bearer", async () => {
    const p = new BearerHeaderProvider();
    await expect(p.getToken(ctx("Basic abc"))).rejects.toMatchObject({
      code: "AUTH_BEARER_MISSING",
    });
  });

  it("getIdentity returns a hashed prefix, never the token", async () => {
    const p = new BearerHeaderProvider();
    const id = await p.getIdentity(ctx("Bearer secret"));
    expect(id.startsWith("bearer:")).toBe(true);
    expect(id).not.toContain("secret");
  });

  it("returns a stable identity for the same token", async () => {
    const p = new BearerHeaderProvider();
    const a = await p.getIdentity(ctx("Bearer same-token"));
    const b = await p.getIdentity(ctx("Bearer same-token"));
    expect(a).toBe(b);
  });

  it("rejects when context has null headers (stdio)", async () => {
    const p = new BearerHeaderProvider();
    await expect(
      p.getToken({ headers: null, request_id: "x" }),
    ).rejects.toMatchObject({ code: "AUTH_BEARER_MISSING" });
  });
});
