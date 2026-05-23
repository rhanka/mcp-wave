import { mkdir, open, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { OAuthRegisteredClientsStore } from "@modelcontextprotocol/sdk/server/auth/clients.js";
import type { OAuthClientInformationFull } from "@modelcontextprotocol/sdk/shared/auth.js";
import { sha256Hex } from "./crypto.js";

export interface StoredAuthorizationCode {
  codeHash: string;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  scopes: string[];
  resource: string;
  createdAt: number;
  expiresAt: number;
  consumedAt?: number;
}

export interface StoredToken {
  tokenHash: string;
  tokenType: "access" | "refresh";
  clientId: string;
  scopes: string[];
  resource: string;
  issuedAt: number;
  expiresAt: number;
  revokedAt?: number;
  parentRefreshTokenHash?: string;
}

interface Snapshot {
  version: 1;
  clients: Record<string, OAuthClientInformationFull>;
  authorizationCodes: Record<string, StoredAuthorizationCode>;
  tokens: Record<string, StoredToken>;
}

export class FileOAuthStore implements OAuthRegisteredClientsStore {
  private snapshot: Snapshot = {
    version: 1,
    clients: {},
    authorizationCodes: {},
    tokens: {},
  };

  constructor(readonly path: string) {}

  async load(): Promise<void> {
    try {
      const raw = await readFile(this.path, "utf8");
      const parsed = JSON.parse(raw) as Snapshot;
      this.snapshot = {
        version: 1,
        clients: parsed.clients ?? {},
        authorizationCodes: parsed.authorizationCodes ?? {},
        tokens: parsed.tokens ?? {},
      };
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        await this.persist();
        return;
      }
      throw error;
    }
  }

  async getClient(clientId: string): Promise<OAuthClientInformationFull | undefined> {
    return this.snapshot.clients[clientId];
  }

  async registerClient(client: OAuthClientInformationFull): Promise<OAuthClientInformationFull> {
    this.snapshot.clients[client.client_id] = client;
    await this.persist();
    return client;
  }

  async putAuthorizationCode(
    code: string,
    record: Omit<StoredAuthorizationCode, "codeHash" | "consumedAt">,
  ): Promise<void> {
    const codeHash = sha256Hex(code);
    this.snapshot.authorizationCodes[codeHash] = { ...record, codeHash };
    await this.persist();
  }

  async getAuthorizationCode(
    code: string,
    nowSeconds: number,
  ): Promise<StoredAuthorizationCode | undefined> {
    const record = this.snapshot.authorizationCodes[sha256Hex(code)];
    if (!record || record.consumedAt || record.expiresAt <= nowSeconds) return undefined;
    return record;
  }

  async consumeAuthorizationCode(
    code: string,
    nowSeconds: number,
  ): Promise<StoredAuthorizationCode | undefined> {
    const codeHash = sha256Hex(code);
    const record = this.snapshot.authorizationCodes[codeHash];
    if (!record || record.consumedAt || record.expiresAt <= nowSeconds) return undefined;
    record.consumedAt = nowSeconds;
    await this.persist();
    return record;
  }

  async putToken(
    token: string,
    record: Omit<StoredToken, "tokenHash" | "revokedAt">,
  ): Promise<StoredToken> {
    const tokenHash = sha256Hex(token);
    const stored = { ...record, tokenHash };
    this.snapshot.tokens[tokenHash] = stored;
    await this.persist();
    return stored;
  }

  async findToken(token: string): Promise<StoredToken | undefined> {
    return this.snapshot.tokens[sha256Hex(token)];
  }

  async revokeToken(token: string, nowSeconds: number): Promise<void> {
    const record = this.snapshot.tokens[sha256Hex(token)];
    if (record && record.revokedAt === undefined) {
      record.revokedAt = nowSeconds;
      await this.persist();
    }
  }

  private async persist(): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const body = `${JSON.stringify(this.snapshot, null, 2)}\n`;
    const tempPath = `${this.path}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tempPath, body, { mode: 0o600 });
    const handle = await open(tempPath, "r");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(tempPath, this.path);
  }
}
