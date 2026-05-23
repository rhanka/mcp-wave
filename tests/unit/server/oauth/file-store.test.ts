import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { sha256Hex } from "../../../../src/server/oauth/crypto.js";
import { FileOAuthStore } from "../../../../src/server/oauth/file-store.js";

describe("FileOAuthStore", () => {
  async function newStore(): Promise<FileOAuthStore> {
    const dir = await mkdtemp(join(tmpdir(), "mcp-wave-oauth-"));
    const store = new FileOAuthStore(join(dir, "oauth-store.json"));
    await store.load();
    return store;
  }

  it("persists and reloads registered clients", async () => {
    const store = await newStore();
    const client = await store.registerClient({
      client_id: "client-a",
      client_id_issued_at: 1,
      redirect_uris: ["https://claude.ai/api/mcp/auth_callback"],
      token_endpoint_auth_method: "none",
    });

    const reloaded = new FileOAuthStore(store.path);
    await reloaded.load();

    expect(await reloaded.getClient(client.client_id)).toEqual(client);
  });

  it("stores authorization codes by hash and never writes plaintext codes", async () => {
    const store = await newStore();
    await store.putAuthorizationCode("plain-code", {
      clientId: "client-a",
      redirectUri: "https://claude.ai/api/mcp/auth_callback",
      codeChallenge: "challenge",
      scopes: ["mcp:tools"],
      resource: "https://mcp-wave.example.invalid/mcp",
      createdAt: 10,
      expiresAt: 20,
    });

    const raw = await readFile(store.path, "utf8");
    expect(raw).not.toContain("plain-code");
    expect(raw).toContain(sha256Hex("plain-code"));
  });

  it("consumes authorization codes exactly once", async () => {
    const store = await newStore();
    await store.putAuthorizationCode("plain-code", {
      clientId: "client-a",
      redirectUri: "https://claude.ai/api/mcp/auth_callback",
      codeChallenge: "challenge",
      scopes: ["mcp:tools"],
      resource: "https://mcp-wave.example.invalid/mcp",
      createdAt: 10,
      expiresAt: 20,
    });

    expect(await store.consumeAuthorizationCode("plain-code", 15)).toMatchObject({
      clientId: "client-a",
    });
    expect(await store.consumeAuthorizationCode("plain-code", 15)).toBeUndefined();
  });

  it("revokes token records by hash", async () => {
    const store = await newStore();
    await store.putToken("access-token", {
      tokenType: "access",
      clientId: "client-a",
      scopes: ["mcp:tools"],
      resource: "https://mcp-wave.example.invalid/mcp",
      issuedAt: 10,
      expiresAt: 20,
    });

    await store.revokeToken("access-token", 12);

    expect(await store.findToken("access-token")).toMatchObject({
      tokenHash: sha256Hex("access-token"),
      revokedAt: 12,
    });
  });
});
