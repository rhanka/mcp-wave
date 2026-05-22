# WP-OPS-01 OAuth Kapsule Deploy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an OAuth 2.x protected remote MCP entrypoint and a repeatable Scaleway Kapsule deployment path for the existing single-tenant Wave MCP server.

**Architecture:** Keep the existing Hono HTTP entrypoint as the local/dev path and add a new Express entrypoint for OAuth because the MCP SDK OAuth helpers are Express middleware. The OAuth provider is single-tenant, issues MCP-local bearer tokens, persists OAuth state in a JSON file on a PVC, and keeps Wave access server-side through `WAVE_AUTH_MODE=env_token`.

**Tech Stack:** TypeScript 6 strict, Node 24, `@modelcontextprotocol/sdk` 1.29 OAuth helpers, Express 5, `express-rate-limit`, `crypto`, `fs/promises`, Vitest, Docker, Kubernetes manifests for Scaleway Kapsule.

**Reference spec:** `docs/superpowers/specs/2026-05-20-wp-ops-01-oauth-kapsule-design.md`

---

## File Structure

- Modify `package.json`: add direct runtime dependencies for Express OAuth routing and scripts for the OAuth entrypoint.
- Modify `package-lock.json`: lock the new direct dependencies.
- Modify `src/config/env.ts`: parse OAuth runtime configuration and enforce production HTTPS requirements.
- Create `src/server/oauth/config.ts`: derive URL, scope, TTL, and redirect allowlist settings from `AppEnv`.
- Create `src/server/oauth/crypto.ts`: generate random tokens, hash token material, and compare consent secrets in constant time.
- Create `src/server/oauth/redirect-uri.ts`: validate dynamic client redirect URIs for Claude and local development.
- Create `src/server/oauth/file-store.ts`: persist OAuth clients, authorization codes, and token records to a JSON file with atomic writes.
- Create `src/server/oauth/single-tenant-provider.ts`: implement `OAuthServerProvider` and `OAuthRegisteredClientsStore` behavior.
- Create `src/server/http/express-origin-allowlist.ts`: Express equivalent of the existing Hono origin allowlist.
- Create `src/entrypoints/oauth-http.ts`: production remote MCP entrypoint with OAuth metadata, DCR, token, revoke, health, ready, and protected `/mcp`.
- Create `tests/unit/config/env.oauth.test.ts`: env parsing coverage for OAuth configuration.
- Create `tests/unit/server/oauth/crypto.test.ts`: hashing and constant-time comparison behavior.
- Create `tests/unit/server/oauth/redirect-uri.test.ts`: redirect URI allowlist behavior.
- Create `tests/unit/server/oauth/file-store.test.ts`: persistence, atomic reload, and token hashing behavior.
- Create `tests/unit/server/oauth/single-tenant-provider.test.ts`: provider behavior for client registration, consent, code exchange, refresh, verification, and revocation.
- Create `tests/integration/entrypoints/oauth-http.test.ts`: full OAuth route behavior through the Express app.
- Create `Dockerfile`: production image that runs `dist/entrypoints/oauth-http.js`.
- Create `.dockerignore`: keep local secrets, build output, and test artifacts out of the image context.
- Create `deploy/scw/kustomization.yaml`: Kustomize app bundle for Kapsule.
- Create `deploy/scw/deployment.yaml`: single-replica deployment with probes, resources, read-only root filesystem, and OAuth PVC mount.
- Create `deploy/scw/service.yaml`: ClusterIP service.
- Create `deploy/scw/ingress.yaml`: Traefik HTTPS ingress.
- Create `deploy/scw/pvc.yaml`: 1Gi RWO PVC for OAuth state.
- Create `deploy/scw/configmap.example.yaml`: non-secret runtime configuration example.
- Create `deploy/scw/secret.example.yaml`: invalid example secret values for operator reference.
- Create `deploy/scw/README.md`: build, push, deploy, smoke, rollback, rotation, and revocation runbook.
- Modify `README.md`: document the OAuth Kapsule entrypoint and point operators at the runbook.
- Modify `plan.md`: move `WP-OPS-01` from spec review to implementation-ready.

---

## Task 1: Dependencies And OAuth Env

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `src/config/env.ts`
- Create: `src/server/oauth/config.ts`
- Test: `tests/unit/config/env.oauth.test.ts`

- [ ] **Step 1: Add direct dependencies and scripts**

Run:

```bash
npm install express@5.2.1 express-rate-limit@8.5.2 cors@2.8.6
npm install --save-dev @types/express @types/cors
```

Expected:

```text
added packages and audited dependencies
found 0 vulnerabilities
```

Then add these scripts to `package.json`:

```json
{
  "dev:oauth-http": "node --env-file-if-exists=.env node_modules/tsx/dist/cli.mjs watch src/entrypoints/oauth-http.ts",
  "start:oauth-http": "node dist/entrypoints/oauth-http.js"
}
```

- [ ] **Step 2: Write failing OAuth env tests**

Create `tests/unit/config/env.oauth.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseEnv } from "../../../src/config/env.js";

const base = {
  WAVE_AUTH_MODE: "env_token",
  WAVE_API_TOKEN: "wave-token",
  WAVE_DEFAULT_BUSINESS_ID: "biz_123",
  WAVE_GRAPHQL_ENDPOINT: "https://gql.waveapps.com/graphql/public",
  LOG_LEVEL: "fatal",
  LOG_PII: "false",
  ALLOWED_ORIGINS: "https://claude.ai,https://claude.com",
  RATE_LIMIT_RPM: "60",
};

describe("OAuth environment parsing", () => {
  it("fills safe local OAuth defaults", () => {
    const env = parseEnv({
      ...base,
      NODE_ENV: "development",
    });

    expect(env.PUBLIC_BASE_URL).toBe("http://localhost:8080");
    expect(env.OAUTH_ISSUER_URL).toBe("http://localhost:8080");
    expect(env.OAUTH_STORE_PATH).toBe(".data/oauth-store.json");
    expect(env.OAUTH_ACCESS_TOKEN_TTL_SECONDS).toBe(3600);
    expect(env.OAUTH_REFRESH_TOKEN_TTL_SECONDS).toBe(2592000);
    expect(env.OAUTH_AUTH_CODE_TTL_SECONDS).toBe(300);
    expect(env.OAUTH_ALLOWED_REDIRECT_URIS).toContain("https://claude.ai/api/mcp/auth_callback");
  });

  it("requires an OAuth consent secret for production OAuth HTTP", () => {
    expect(() =>
      parseEnv({
        ...base,
        NODE_ENV: "production",
        PUBLIC_BASE_URL: "https://mcp-wave.example.invalid",
        OAUTH_ISSUER_URL: "https://mcp-wave.example.invalid",
      }),
    ).toThrow("OAUTH_CONSENT_SECRET is required in production");
  });

  it("rejects production HTTP public URLs", () => {
    expect(() =>
      parseEnv({
        ...base,
        NODE_ENV: "production",
        PUBLIC_BASE_URL: "http://mcp-wave.example.invalid",
        OAUTH_ISSUER_URL: "https://mcp-wave.example.invalid",
        OAUTH_CONSENT_SECRET: "secret",
      }),
    ).toThrow("PUBLIC_BASE_URL must use https in production");
  });

  it("rejects production HTTP issuer URLs", () => {
    expect(() =>
      parseEnv({
        ...base,
        NODE_ENV: "production",
        PUBLIC_BASE_URL: "https://mcp-wave.example.invalid",
        OAUTH_ISSUER_URL: "http://mcp-wave.example.invalid",
        OAUTH_CONSENT_SECRET: "secret",
      }),
    ).toThrow("OAUTH_ISSUER_URL must use https in production");
  });
});
```

- [ ] **Step 3: Run env tests and confirm they fail**

Run:

```bash
npm run test:unit -- tests/unit/config/env.oauth.test.ts
```

Expected:

```text
FAIL tests/unit/config/env.oauth.test.ts
AssertionError: expected undefined to be 'http://localhost:8080'
```

- [ ] **Step 4: Extend `src/config/env.ts`**

Add these fields to `baseSchema`:

```ts
  PUBLIC_BASE_URL: z.string().url().default("http://localhost:8080"),
  OAUTH_ISSUER_URL: z.string().url().default("http://localhost:8080"),
  OAUTH_CONSENT_SECRET: z.string().min(1).optional(),
  OAUTH_STORE_PATH: z.string().min(1).default(".data/oauth-store.json"),
  OAUTH_ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(3600),
  OAUTH_REFRESH_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(2592000),
  OAUTH_AUTH_CODE_TTL_SECONDS: z.coerce.number().int().positive().default(300),
  OAUTH_ALLOWED_REDIRECT_URIS: z
    .string()
    .default("https://claude.ai/api/mcp/auth_callback,https://claude.com/api/mcp/auth_callback"),
```

Add these checks inside `superRefine`:

```ts
  if (v.NODE_ENV === "production") {
    if (new URL(v.PUBLIC_BASE_URL).protocol !== "https:") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "PUBLIC_BASE_URL must use https in production",
        path: ["PUBLIC_BASE_URL"],
      });
    }
    if (new URL(v.OAUTH_ISSUER_URL).protocol !== "https:") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "OAUTH_ISSUER_URL must use https in production",
        path: ["OAUTH_ISSUER_URL"],
      });
    }
    if (!v.OAUTH_CONSENT_SECRET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "OAUTH_CONSENT_SECRET is required in production",
        path: ["OAUTH_CONSENT_SECRET"],
      });
    }
  }
```

- [ ] **Step 5: Add OAuth config derivation**

Create `src/server/oauth/config.ts`:

```ts
import type { AppEnv } from "../../config/env.js";

export const OAUTH_SCOPE = "mcp:tools";

export interface OAuthRuntimeConfig {
  issuerUrl: URL;
  publicBaseUrl: URL;
  resourceServerUrl: URL;
  resourceMetadataUrl: string;
  consentSecret: string;
  allowedRedirectUris: readonly string[];
  accessTokenTtlSeconds: number;
  refreshTokenTtlSeconds: number;
  authCodeTtlSeconds: number;
}

export function parseOAuthCsv(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

export function oauthConfigFromEnv(env: AppEnv): OAuthRuntimeConfig {
  const publicBaseUrl = new URL(env.PUBLIC_BASE_URL);
  const issuerUrl = new URL(env.OAUTH_ISSUER_URL);
  const resourceServerUrl = new URL("/mcp", publicBaseUrl);
  const resourceMetadataUrl = new URL(
    "/.well-known/oauth-protected-resource/mcp",
    publicBaseUrl,
  ).href;

  return {
    issuerUrl,
    publicBaseUrl,
    resourceServerUrl,
    resourceMetadataUrl,
    consentSecret: env.OAUTH_CONSENT_SECRET ?? "local-dev-consent",
    allowedRedirectUris: parseOAuthCsv(env.OAUTH_ALLOWED_REDIRECT_URIS),
    accessTokenTtlSeconds: env.OAUTH_ACCESS_TOKEN_TTL_SECONDS,
    refreshTokenTtlSeconds: env.OAUTH_REFRESH_TOKEN_TTL_SECONDS,
    authCodeTtlSeconds: env.OAUTH_AUTH_CODE_TTL_SECONDS,
  };
}
```

- [ ] **Step 6: Re-run env tests**

Run:

```bash
npm run test:unit -- tests/unit/config/env.oauth.test.ts
```

Expected:

```text
PASS tests/unit/config/env.oauth.test.ts
```

- [ ] **Step 7: Commit**

Run:

```bash
git add package.json package-lock.json src/config/env.ts src/server/oauth/config.ts tests/unit/config/env.oauth.test.ts
git commit -m "feat(oauth): add runtime env configuration"
```

Expected: commit succeeds.

---

## Task 2: OAuth Crypto And Redirect Utilities

**Files:**
- Create: `src/server/oauth/crypto.ts`
- Create: `src/server/oauth/redirect-uri.ts`
- Test: `tests/unit/server/oauth/crypto.test.ts`
- Test: `tests/unit/server/oauth/redirect-uri.test.ts`

- [ ] **Step 1: Write crypto tests**

Create `tests/unit/server/oauth/crypto.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { randomToken, sha256Hex, timingSafeEqualString } from "../../../../src/server/oauth/crypto.js";

describe("OAuth crypto helpers", () => {
  it("hashes token material as sha256 hex", () => {
    expect(sha256Hex("secret-token")).toMatch(/^[a-f0-9]{64}$/);
    expect(sha256Hex("secret-token")).toBe(sha256Hex("secret-token"));
    expect(sha256Hex("secret-token")).not.toBe("secret-token");
  });

  it("generates URL-safe random tokens", () => {
    const token = randomToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(token.length).toBeGreaterThanOrEqual(43);
    expect(randomToken()).not.toBe(token);
  });

  it("compares strings without leaking length through direct comparison", () => {
    expect(timingSafeEqualString("secret", "secret")).toBe(true);
    expect(timingSafeEqualString("secret", "wrong")).toBe(false);
    expect(timingSafeEqualString("secret", "secret-longer")).toBe(false);
  });
});
```

- [ ] **Step 2: Implement crypto helpers**

Create `src/server/oauth/crypto.ts`:

```ts
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export function randomToken(byteLength = 32): string {
  return randomBytes(byteLength).toString("base64url");
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function tokenHashPrefix(tokenHash: string): string {
  return tokenHash.slice(0, 12);
}

export function timingSafeEqualString(a: string, b: string): boolean {
  const left = Buffer.from(sha256Hex(a), "hex");
  const right = Buffer.from(sha256Hex(b), "hex");
  return timingSafeEqual(left, right);
}
```

- [ ] **Step 3: Write redirect URI tests**

Create `tests/unit/server/oauth/redirect-uri.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { redirectUriAllowed } from "../../../../src/server/oauth/redirect-uri.js";

const allowed = [
  "https://claude.ai/api/mcp/auth_callback",
  "https://claude.com/api/mcp/auth_callback",
];

describe("OAuth redirect URI allowlist", () => {
  it("accepts Claude production callbacks", () => {
    expect(
      redirectUriAllowed("https://claude.ai/api/mcp/auth_callback", allowed, "production"),
    ).toBe(true);
    expect(
      redirectUriAllowed("https://claude.com/api/mcp/auth_callback", allowed, "production"),
    ).toBe(true);
  });

  it("rejects unlisted production callbacks", () => {
    expect(redirectUriAllowed("https://evil.example/callback", allowed, "production")).toBe(false);
    expect(redirectUriAllowed("http://localhost:3000/callback", allowed, "production")).toBe(false);
  });

  it("accepts localhost callbacks outside production", () => {
    expect(redirectUriAllowed("http://localhost:5173/callback", allowed, "development")).toBe(true);
    expect(redirectUriAllowed("http://127.0.0.1:5173/callback", allowed, "test")).toBe(true);
  });

  it("rejects malformed URIs", () => {
    expect(redirectUriAllowed("not-a-url", allowed, "test")).toBe(false);
  });
});
```

- [ ] **Step 4: Implement redirect URI helper**

Create `src/server/oauth/redirect-uri.ts`:

```ts
import type { AppEnv } from "../../config/env.js";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

export function redirectUriAllowed(
  redirectUri: string,
  allowedRedirectUris: readonly string[],
  nodeEnv: AppEnv["NODE_ENV"],
): boolean {
  let parsed: URL;
  try {
    parsed = new URL(redirectUri);
  } catch {
    return false;
  }

  if (allowedRedirectUris.includes(parsed.href)) {
    return true;
  }

  if (nodeEnv !== "production" && LOOPBACK_HOSTS.has(parsed.hostname)) {
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  }

  return false;
}

export function allRedirectUrisAllowed(
  redirectUris: readonly string[],
  allowedRedirectUris: readonly string[],
  nodeEnv: AppEnv["NODE_ENV"],
): boolean {
  return redirectUris.every((redirectUri) =>
    redirectUriAllowed(redirectUri, allowedRedirectUris, nodeEnv),
  );
}
```

- [ ] **Step 5: Run tests**

Run:

```bash
npm run test:unit -- tests/unit/server/oauth/crypto.test.ts tests/unit/server/oauth/redirect-uri.test.ts
```

Expected:

```text
PASS tests/unit/server/oauth/crypto.test.ts
PASS tests/unit/server/oauth/redirect-uri.test.ts
```

- [ ] **Step 6: Commit**

Run:

```bash
git add src/server/oauth/crypto.ts src/server/oauth/redirect-uri.ts tests/unit/server/oauth/crypto.test.ts tests/unit/server/oauth/redirect-uri.test.ts
git commit -m "feat(oauth): add crypto and redirect validation helpers"
```

Expected: commit succeeds.

---

## Task 3: File-Backed OAuth Store

**Files:**
- Create: `src/server/oauth/file-store.ts`
- Test: `tests/unit/server/oauth/file-store.test.ts`

- [ ] **Step 1: Write store tests**

Create `tests/unit/server/oauth/file-store.test.ts`:

```ts
import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { FileOAuthStore } from "../../../../src/server/oauth/file-store.js";
import { sha256Hex } from "../../../../src/server/oauth/crypto.js";

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
```

- [ ] **Step 2: Implement the store data model**

Create `src/server/oauth/file-store.ts` with these exported types:

```ts
import { mkdir, open, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { OAuthClientInformationFull } from "@modelcontextprotocol/sdk/shared/auth.js";
import type { OAuthRegisteredClientsStore } from "@modelcontextprotocol/sdk/server/auth/clients.js";
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
```

- [ ] **Step 3: Implement `FileOAuthStore`**

Add this class to `src/server/oauth/file-store.ts`:

```ts
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

  async getAuthorizationCode(code: string, nowSeconds: number): Promise<StoredAuthorizationCode | undefined> {
    const record = this.snapshot.authorizationCodes[sha256Hex(code)];
    if (!record || record.consumedAt || record.expiresAt <= nowSeconds) return undefined;
    return record;
  }

  async consumeAuthorizationCode(code: string, nowSeconds: number): Promise<StoredAuthorizationCode | undefined> {
    const codeHash = sha256Hex(code);
    const record = this.snapshot.authorizationCodes[codeHash];
    if (!record || record.consumedAt || record.expiresAt <= nowSeconds) return undefined;
    record.consumedAt = nowSeconds;
    await this.persist();
    return record;
  }

  async putToken(token: string, record: Omit<StoredToken, "tokenHash" | "revokedAt">): Promise<StoredToken> {
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
```

- [ ] **Step 4: Run store tests**

Run:

```bash
npm run test:unit -- tests/unit/server/oauth/file-store.test.ts
```

Expected:

```text
PASS tests/unit/server/oauth/file-store.test.ts
```

- [ ] **Step 5: Commit**

Run:

```bash
git add src/server/oauth/file-store.ts tests/unit/server/oauth/file-store.test.ts
git commit -m "feat(oauth): persist OAuth state in a file store"
```

Expected: commit succeeds.

---

## Task 4: Single-Tenant OAuth Provider

**Files:**
- Create: `src/server/oauth/single-tenant-provider.ts`
- Test: `tests/unit/server/oauth/single-tenant-provider.test.ts`

- [ ] **Step 1: Write provider tests**

Create `tests/unit/server/oauth/single-tenant-provider.test.ts` with these cases:

```ts
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { InvalidClientMetadataError, InvalidGrantError, InvalidTokenError } from "@modelcontextprotocol/sdk/server/auth/errors.js";
import { describe, expect, it } from "vitest";
import { FileOAuthStore } from "../../../../src/server/oauth/file-store.js";
import { SingleTenantOAuthProvider } from "../../../../src/server/oauth/single-tenant-provider.js";

async function provider(now = 100): Promise<SingleTenantOAuthProvider> {
  const dir = await mkdtemp(join(tmpdir(), "mcp-wave-provider-"));
  const store = new FileOAuthStore(join(dir, "oauth.json"));
  await store.load();
  return new SingleTenantOAuthProvider({
    store,
    nodeEnv: "test",
    issuerUrl: new URL("http://localhost:8080"),
    publicBaseUrl: new URL("http://localhost:8080"),
    resourceServerUrl: new URL("http://localhost:8080/mcp"),
    consentSecret: "consent",
    allowedRedirectUris: ["https://claude.ai/api/mcp/auth_callback"],
    authCodeTtlSeconds: 300,
    accessTokenTtlSeconds: 3600,
    refreshTokenTtlSeconds: 2592000,
    nowSeconds: () => now,
  });
}

describe("SingleTenantOAuthProvider", () => {
  it("registers clients with allowed redirect URIs", async () => {
    const p = await provider();
    const client = await p.clientsStore.registerClient?.({
      client_id: "client-a",
      client_id_issued_at: 100,
      redirect_uris: ["https://claude.ai/api/mcp/auth_callback"],
      token_endpoint_auth_method: "none",
    });

    expect(client?.client_id).toBe("client-a");
    expect(await p.clientsStore.getClient("client-a")).toEqual(client);
  });

  it("rejects clients with unknown redirect URIs", async () => {
    const p = await provider();

    await expect(
      p.clientsStore.registerClient?.({
        client_id: "client-a",
        client_id_issued_at: 100,
        redirect_uris: ["https://evil.example/callback"],
        token_endpoint_auth_method: "none",
      }),
    ).rejects.toBeInstanceOf(InvalidClientMetadataError);
  });

  it("exchanges a valid code for access and refresh tokens", async () => {
    const p = await provider();
    const client = await p.clientsStore.registerClient?.({
      client_id: "client-a",
      client_id_issued_at: 100,
      redirect_uris: ["https://claude.ai/api/mcp/auth_callback"],
      token_endpoint_auth_method: "none",
    });
    if (!client) throw new Error("client registration failed");

    const code = await p.issueAuthorizationCodeForTests(client, {
      redirectUri: "https://claude.ai/api/mcp/auth_callback",
      codeChallenge: "challenge",
      scopes: ["mcp:tools"],
      resource: new URL("http://localhost:8080/mcp"),
      state: "state-a",
    });

    const tokens = await p.exchangeAuthorizationCode(
      client,
      code,
      undefined,
      "https://claude.ai/api/mcp/auth_callback",
      new URL("http://localhost:8080/mcp"),
    );

    expect(tokens.token_type).toBe("Bearer");
    expect(tokens.expires_in).toBe(3600);
    expect(tokens.scope).toBe("mcp:tools");
    expect(tokens.access_token).toBeTruthy();
    expect(tokens.refresh_token).toBeTruthy();
    await expect(p.exchangeAuthorizationCode(client, code)).rejects.toBeInstanceOf(InvalidGrantError);
  });

  it("verifies and revokes access tokens", async () => {
    const p = await provider();
    const client = await p.clientsStore.registerClient?.({
      client_id: "client-a",
      client_id_issued_at: 100,
      redirect_uris: ["https://claude.ai/api/mcp/auth_callback"],
      token_endpoint_auth_method: "none",
    });
    if (!client) throw new Error("client registration failed");

    const tokens = await p.issueTokensForTests(client);
    const auth = await p.verifyAccessToken(tokens.access_token);
    expect(auth.clientId).toBe("client-a");
    expect(auth.scopes).toEqual(["mcp:tools"]);

    await p.revokeToken(client, { token: tokens.access_token });
    await expect(p.verifyAccessToken(tokens.access_token)).rejects.toBeInstanceOf(InvalidTokenError);
  });
});
```

- [ ] **Step 2: Implement provider constructor and client store wrapper**

Create `src/server/oauth/single-tenant-provider.ts` and export:

```ts
import type { Response } from "express";
import type { AppEnv } from "../../config/env.js";
import { InvalidClientMetadataError, InvalidGrantError, InvalidScopeError, InvalidTargetError, InvalidTokenError } from "@modelcontextprotocol/sdk/server/auth/errors.js";
import type { OAuthRegisteredClientsStore } from "@modelcontextprotocol/sdk/server/auth/clients.js";
import type { AuthorizationParams, OAuthServerProvider } from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type { OAuthClientInformationFull, OAuthTokenRevocationRequest, OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";
import { OAUTH_SCOPE } from "./config.js";
import { randomToken, sha256Hex, timingSafeEqualString, tokenHashPrefix } from "./crypto.js";
import type { FileOAuthStore } from "./file-store.js";
import { allRedirectUrisAllowed } from "./redirect-uri.js";
```

Add interfaces:

```ts
interface ProviderOptions {
  store: FileOAuthStore;
  nodeEnv: AppEnv["NODE_ENV"];
  issuerUrl: URL;
  publicBaseUrl: URL;
  resourceServerUrl: URL;
  consentSecret: string;
  allowedRedirectUris: readonly string[];
  authCodeTtlSeconds: number;
  accessTokenTtlSeconds: number;
  refreshTokenTtlSeconds: number;
  nowSeconds?: () => number;
}

interface IssueCodeParams {
  redirectUri: string;
  codeChallenge: string;
  scopes: string[];
  resource?: URL;
  state?: string;
}
```

Implement `clientsStore` so registration rejects unknown redirect URIs and normalizes scope:

```ts
export class SingleTenantOAuthProvider implements OAuthServerProvider {
  readonly clientsStore: OAuthRegisteredClientsStore;

  constructor(private readonly opts: ProviderOptions) {
    this.clientsStore = {
      getClient: (clientId) => this.opts.store.getClient(clientId),
      registerClient: async (client) => {
        if (!allRedirectUrisAllowed(client.redirect_uris, this.opts.allowedRedirectUris, this.opts.nodeEnv)) {
          throw new InvalidClientMetadataError("redirect_uris contains a URI that is not allowed");
        }

        const normalized: OAuthClientInformationFull = {
          ...client,
          scope: OAUTH_SCOPE,
          grant_types: ["authorization_code", "refresh_token"],
          response_types: ["code"],
          token_endpoint_auth_method: client.token_endpoint_auth_method ?? "none",
        };

        return this.opts.store.registerClient(normalized);
      },
    };
  }

  private nowSeconds(): number {
    return this.opts.nowSeconds?.() ?? Math.floor(Date.now() / 1000);
  }
}
```

- [ ] **Step 3: Implement authorization code issuance and consent rendering**

Add these methods inside the class:

```ts
  async authorize(client: OAuthClientInformationFull, params: AuthorizationParams, res: Response): Promise<void> {
    const req = res.req;
    const body = req.body as { consent_secret?: string } | undefined;

    if (req.method !== "POST") {
      res.status(200).type("html").send(this.renderConsentForm(client, params, undefined));
      return;
    }

    if (!body?.consent_secret || !timingSafeEqualString(body.consent_secret, this.opts.consentSecret)) {
      res.status(401).type("html").send(this.renderConsentForm(client, params, "Invalid consent secret"));
      return;
    }

    const code = await this.issueAuthorizationCodeForTests(client, {
      redirectUri: params.redirectUri,
      codeChallenge: params.codeChallenge,
      scopes: this.normalizeScopes(params.scopes),
      resource: params.resource,
      state: params.state,
    });

    const redirect = new URL(params.redirectUri);
    redirect.searchParams.set("code", code);
    if (params.state) redirect.searchParams.set("state", params.state);
    res.redirect(302, redirect.href);
  }

  async issueAuthorizationCodeForTests(
    client: OAuthClientInformationFull,
    params: IssueCodeParams,
  ): Promise<string> {
    const resource = this.normalizeResource(params.resource);
    const scopes = this.normalizeScopes(params.scopes);
    const code = randomToken();
    const now = this.nowSeconds();
    await this.opts.store.putAuthorizationCode(code, {
      clientId: client.client_id,
      redirectUri: params.redirectUri,
      codeChallenge: params.codeChallenge,
      scopes,
      resource: resource.href,
      createdAt: now,
      expiresAt: now + this.opts.authCodeTtlSeconds,
    });
    return code;
  }

  private renderConsentForm(
    client: OAuthClientInformationFull,
    params: AuthorizationParams,
    error: string | undefined,
  ): string {
    const scope = this.normalizeScopes(params.scopes).join(" ");
    const resource = this.normalizeResource(params.resource).href;
    const errorHtml = error ? `<p role="alert">${escapeHtml(error)}</p>` : "";
    return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Authorize mcp-wave</title></head>
<body>
<main>
<h1>Authorize mcp-wave</h1>
${errorHtml}
<form method="post" action="/authorize">
<input type="hidden" name="response_type" value="code">
<input type="hidden" name="client_id" value="${escapeHtml(client.client_id)}">
<input type="hidden" name="redirect_uri" value="${escapeHtml(params.redirectUri)}">
<input type="hidden" name="code_challenge" value="${escapeHtml(params.codeChallenge)}">
<input type="hidden" name="code_challenge_method" value="S256">
<input type="hidden" name="scope" value="${escapeHtml(scope)}">
<input type="hidden" name="resource" value="${escapeHtml(resource)}">
${params.state ? `<input type="hidden" name="state" value="${escapeHtml(params.state)}">` : ""}
<p>Client: ${escapeHtml(client.client_name ?? client.client_id)}</p>
<p>Redirect URI: ${escapeHtml(params.redirectUri)}</p>
<p>Scope: ${escapeHtml(scope)}</p>
<label>Consent secret <input name="consent_secret" type="password" autocomplete="current-password"></label>
<button type="submit">Authorize</button>
</form>
</main>
</body>
</html>`;
  }
```

Add a local helper at file bottom:

```ts
function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
```

- [ ] **Step 4: Implement code exchange, refresh, token verification, and revocation**

Add these methods inside the class:

```ts
  async challengeForAuthorizationCode(
    _client: OAuthClientInformationFull,
    authorizationCode: string,
  ): Promise<string> {
    const record = await this.opts.store.getAuthorizationCode(authorizationCode, this.nowSeconds());
    if (!record) throw new InvalidGrantError("authorization code is invalid or expired");
    return record.codeChallenge;
  }

  async exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string,
    _codeVerifier?: string,
    redirectUri?: string,
    resource?: URL,
  ): Promise<OAuthTokens> {
    const record = await this.opts.store.consumeAuthorizationCode(authorizationCode, this.nowSeconds());
    if (!record) throw new InvalidGrantError("authorization code is invalid, expired, or already used");
    if (record.clientId !== client.client_id) throw new InvalidGrantError("authorization code was issued to another client");
    if (redirectUri && redirectUri !== record.redirectUri) throw new InvalidGrantError("redirect_uri does not match authorization code");
    if (this.normalizeResource(resource).href !== record.resource) throw new InvalidTargetError("resource does not match authorization code");
    return this.issueTokens(client, record.scopes, new URL(record.resource), undefined);
  }

  async exchangeRefreshToken(
    client: OAuthClientInformationFull,
    refreshToken: string,
    scopes?: string[],
    resource?: URL,
  ): Promise<OAuthTokens> {
    const record = await this.opts.store.findToken(refreshToken);
    const now = this.nowSeconds();
    if (!record || record.tokenType !== "refresh" || record.revokedAt || record.expiresAt <= now) {
      throw new InvalidGrantError("refresh token is invalid or expired");
    }
    if (record.clientId !== client.client_id) throw new InvalidGrantError("refresh token was issued to another client");
    if (this.normalizeResource(resource).href !== record.resource) throw new InvalidTargetError("resource does not match refresh token");

    const requestedScopes = this.normalizeScopes(scopes ?? record.scopes);
    if (!requestedScopes.every((scope) => record.scopes.includes(scope))) {
      throw new InvalidScopeError("requested scope exceeds refresh token scope");
    }

    await this.opts.store.revokeToken(refreshToken, now);
    return this.issueTokens(client, requestedScopes, new URL(record.resource), sha256Hex(refreshToken));
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const record = await this.opts.store.findToken(token);
    const now = this.nowSeconds();
    if (!record || record.tokenType !== "access" || record.revokedAt || record.expiresAt <= now) {
      throw new InvalidTokenError("access token is invalid or expired");
    }
    return {
      token,
      clientId: record.clientId,
      scopes: record.scopes,
      expiresAt: record.expiresAt,
      resource: new URL(record.resource),
      extra: {
        tokenHashPrefix: tokenHashPrefix(record.tokenHash),
      },
    };
  }

  async revokeToken(_client: OAuthClientInformationFull, request: OAuthTokenRevocationRequest): Promise<void> {
    await this.opts.store.revokeToken(request.token, this.nowSeconds());
  }

  async issueTokensForTests(client: OAuthClientInformationFull): Promise<OAuthTokens> {
    return this.issueTokens(client, [OAUTH_SCOPE], this.opts.resourceServerUrl, undefined);
  }

  private async issueTokens(
    client: OAuthClientInformationFull,
    scopes: string[],
    resource: URL,
    parentRefreshTokenHash: string | undefined,
  ): Promise<OAuthTokens> {
    const accessToken = randomToken();
    const refreshToken = randomToken();
    const now = this.nowSeconds();
    await this.opts.store.putToken(accessToken, {
      tokenType: "access",
      clientId: client.client_id,
      scopes,
      resource: resource.href,
      issuedAt: now,
      expiresAt: now + this.opts.accessTokenTtlSeconds,
      parentRefreshTokenHash,
    });
    await this.opts.store.putToken(refreshToken, {
      tokenType: "refresh",
      clientId: client.client_id,
      scopes,
      resource: resource.href,
      issuedAt: now,
      expiresAt: now + this.opts.refreshTokenTtlSeconds,
      parentRefreshTokenHash,
    });
    return {
      access_token: accessToken,
      refresh_token: refreshToken,
      token_type: "Bearer",
      expires_in: this.opts.accessTokenTtlSeconds,
      scope: scopes.join(" "),
    };
  }
```

Add normalization helpers:

```ts
  private normalizeScopes(scopes: readonly string[] | undefined): string[] {
    const requested = scopes && scopes.length > 0 ? [...scopes] : [OAUTH_SCOPE];
    if (!requested.every((scope) => scope === OAUTH_SCOPE)) {
      throw new InvalidScopeError("only mcp:tools scope is supported");
    }
    return [OAUTH_SCOPE];
  }

  private normalizeResource(resource: URL | undefined): URL {
    const resolved = resource ?? this.opts.resourceServerUrl;
    if (resolved.href !== this.opts.resourceServerUrl.href) {
      throw new InvalidTargetError("resource must match the MCP resource server URL");
    }
    return resolved;
  }
```

- [ ] **Step 5: Run provider tests**

Run:

```bash
npm run test:unit -- tests/unit/server/oauth/single-tenant-provider.test.ts
```

Expected:

```text
PASS tests/unit/server/oauth/single-tenant-provider.test.ts
```

- [ ] **Step 6: Commit**

Run:

```bash
git add src/server/oauth/single-tenant-provider.ts tests/unit/server/oauth/single-tenant-provider.test.ts
git commit -m "feat(oauth): implement single tenant provider"
```

Expected: commit succeeds.

---

## Task 5: OAuth HTTP Entrypoint

**Files:**
- Create: `src/server/http/express-origin-allowlist.ts`
- Create: `src/entrypoints/oauth-http.ts`
- Test: `tests/integration/entrypoints/oauth-http.test.ts`

- [ ] **Step 1: Add Express origin middleware**

Create `src/server/http/express-origin-allowlist.ts`:

```ts
import type { RequestHandler } from "express";

export function expressOriginAllowlist(patterns: readonly string[]): RequestHandler {
  const matchers = patterns.map((pattern) => globToRegex(pattern));

  return (req, res, next) => {
    const origin = req.header("origin");
    if (!origin) {
      next();
      return;
    }
    if (!matchers.some((matcher) => matcher.test(origin))) {
      res.status(403).json({ error: "ORIGIN_NOT_ALLOWED", origin, allowed: patterns });
      return;
    }
    next();
  };
}

function globToRegex(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`);
}
```

- [ ] **Step 2: Write OAuth entrypoint integration tests**

Create `tests/integration/entrypoints/oauth-http.test.ts` with:

```ts
import { createHash } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { AppEnv } from "../../../src/config/env.js";
import type { createLogger } from "../../../src/config/logger.js";
import { AccountMappingLoader } from "../../../src/domain/tax/account-mapping-loader.js";
import { TaxRatesLoader } from "../../../src/domain/tax/rates-loader.js";
import { buildOAuthHttpApp } from "../../../src/entrypoints/oauth-http.js";
import { FileOAuthStore } from "../../../src/server/oauth/file-store.js";
import { selectProvider } from "../../../src/wave/auth/select.js";
import { WaveClient } from "../../../src/wave/client.js";

function env(storePath: string): AppEnv {
  return {
    WAVE_AUTH_MODE: "env_token",
    WAVE_API_TOKEN: "wave-token",
    WAVE_DEFAULT_BUSINESS_ID: "biz_x",
    WAVE_GRAPHQL_ENDPOINT: "https://example.invalid/graphql",
    LOG_LEVEL: "fatal",
    LOG_PII: false,
    NODE_ENV: "test",
    ALLOWED_ORIGINS: "https://claude.ai,http://localhost:*",
    RATE_LIMIT_RPM: 120,
    PUBLIC_BASE_URL: "http://localhost:8080",
    OAUTH_ISSUER_URL: "http://localhost:8080",
    OAUTH_CONSENT_SECRET: "consent",
    OAUTH_STORE_PATH: storePath,
    OAUTH_ACCESS_TOKEN_TTL_SECONDS: 3600,
    OAUTH_REFRESH_TOKEN_TTL_SECONDS: 2592000,
    OAUTH_AUTH_CODE_TTL_SECONDS: 300,
    OAUTH_ALLOWED_REDIRECT_URIS: "https://claude.ai/api/mcp/auth_callback",
  };
}

async function appFor() {
  const dir = await mkdtemp(join(tmpdir(), "mcp-wave-oauth-http-"));
  const testEnv = env(join(dir, "oauth-store.json"));
  const provider = selectProvider(testEnv);
  const store = new FileOAuthStore(testEnv.OAUTH_STORE_PATH);
  await store.load();
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), child() { return logger; } };
  const app = buildOAuthHttpApp({
    env: testEnv,
    logger: logger as unknown as ReturnType<typeof createLogger>,
    provider,
    oauthStore: store,
    wave: new WaveClient({ endpoint: testEnv.WAVE_GRAPHQL_ENDPOINT, provider }),
    taxRates: new TaxRatesLoader(resolve("data/tax-rates")),
    accountMapping: new AccountMappingLoader(resolve("data/account-mapping")),
  });
  return { app, logger };
}

function pkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

describe("OAuth HTTP entrypoint", () => {
  it("serves OAuth metadata", async () => {
    const { app } = await appFor();
    const response = await app.request("/.well-known/oauth-authorization-server");
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.issuer).toBe("http://localhost:8080");
    expect(body.authorization_endpoint).toBe("http://localhost:8080/authorize");
    expect(body.token_endpoint).toBe("http://localhost:8080/token");
    expect(body.registration_endpoint).toBe("http://localhost:8080/register");
    expect(body.revocation_endpoint).toBe("http://localhost:8080/revoke");
  });

  it("rejects /mcp without an OAuth bearer token", async () => {
    const { app } = await appFor();
    const response = await app.request("/mcp", {
      method: "POST",
      headers: {
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
        origin: "https://claude.ai",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "test", version: "0" } } }),
    });
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain("resource_metadata");
  });

  it("registers, authorizes, exchanges, and uses an OAuth token for MCP initialize", async () => {
    const { app } = await appFor();
    const register = await app.request("/register", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://claude.ai" },
      body: JSON.stringify({
        redirect_uris: ["https://claude.ai/api/mcp/auth_callback"],
        token_endpoint_auth_method: "none",
        client_name: "Claude test",
      }),
    });
    expect(register.status).toBe(201);
    const client = await register.json();
    const verifier = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~";
    const challenge = pkceChallenge(verifier);

    const authorize = await app.request("/authorize", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        response_type: "code",
        client_id: client.client_id,
        redirect_uri: "https://claude.ai/api/mcp/auth_callback",
        code_challenge: challenge,
        code_challenge_method: "S256",
        scope: "mcp:tools",
        resource: "http://localhost:8080/mcp",
        state: "state-a",
        consent_secret: "consent",
      }).toString(),
    });
    expect(authorize.status).toBe(302);
    const location = new URL(authorize.headers.get("location") ?? "");
    expect(location.searchParams.get("state")).toBe("state-a");
    const code = location.searchParams.get("code");
    expect(code).toBeTruthy();

    const token = await app.request("/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", origin: "https://claude.ai" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: client.client_id,
        code: code ?? "",
        code_verifier: verifier,
        redirect_uri: "https://claude.ai/api/mcp/auth_callback",
        resource: "http://localhost:8080/mcp",
      }).toString(),
    });
    expect(token.status).toBe(200);
    const tokens = await token.json();
    expect(tokens.access_token).toBeTruthy();
    expect(tokens.refresh_token).toBeTruthy();

    const init = await app.request("/mcp", {
      method: "POST",
      headers: {
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
        authorization: `Bearer ${tokens.access_token}`,
        origin: "https://claude.ai",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "test", version: "0" } } }),
    });
    expect(init.status).toBe(200);
    expect(init.headers.get("mcp-session-id")).toBeTruthy();
  });
});
```

- [ ] **Step 3: Implement `src/entrypoints/oauth-http.ts`**

Create the entrypoint with these imports and dependency interface:

```ts
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { resolve } from "node:path";
import express, { type Express } from "express";
import rateLimit from "express-rate-limit";
import { mcpAuthRouter } from "@modelcontextprotocol/sdk/server/auth/router.js";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { GraphQLClient } from "graphql-request";
import type { AppEnv } from "../config/env.js";
import { parseEnv } from "../config/env.js";
import { createLogger } from "../config/logger.js";
import { AccountMappingLoader } from "../domain/tax/account-mapping-loader.js";
import { TaxRatesLoader } from "../domain/tax/rates-loader.js";
import { expressOriginAllowlist } from "../server/http/express-origin-allowlist.js";
import { buildMcpServer } from "../server/mcp-server.js";
import { allTools } from "../server/tool-registry.js";
import { oauthConfigFromEnv, OAUTH_SCOPE } from "../server/oauth/config.js";
import { FileOAuthStore } from "../server/oauth/file-store.js";
import { SingleTenantOAuthProvider } from "../server/oauth/single-tenant-provider.js";
import type { WaveCredentialProvider } from "../wave/auth/provider.js";
import { selectProvider } from "../wave/auth/select.js";
import { WaveClient } from "../wave/client.js";

interface OAuthHttpAppDeps {
  env: AppEnv;
  logger: ReturnType<typeof createLogger>;
  provider: WaveCredentialProvider;
  oauthStore: FileOAuthStore;
  wave: WaveClient;
  taxRates: TaxRatesLoader;
  accountMapping: AccountMappingLoader;
}

interface OAuthHttpSession {
  transport: StreamableHTTPServerTransport;
}
```

Implement `buildOAuthHttpApp`:

```ts
export function buildOAuthHttpApp(deps: OAuthHttpAppDeps): Express {
  const oauth = oauthConfigFromEnv(deps.env);
  const oauthProvider = new SingleTenantOAuthProvider({
    store: deps.oauthStore,
    nodeEnv: deps.env.NODE_ENV,
    issuerUrl: oauth.issuerUrl,
    publicBaseUrl: oauth.publicBaseUrl,
    resourceServerUrl: oauth.resourceServerUrl,
    consentSecret: oauth.consentSecret,
    allowedRedirectUris: oauth.allowedRedirectUris,
    authCodeTtlSeconds: oauth.authCodeTtlSeconds,
    accessTokenTtlSeconds: oauth.accessTokenTtlSeconds,
    refreshTokenTtlSeconds: oauth.refreshTokenTtlSeconds,
  });

  const app = express();
  const sessions = new Map<string, OAuthHttpSession>();
  const allowedOrigins = deps.env.ALLOWED_ORIGINS.split(",").map((origin) => origin.trim());

  app.set("trust proxy", 1);
  app.disable("x-powered-by");
  app.use(expressOriginAllowlist(allowedOrigins));
  app.use(rateLimit({ windowMs: 60_000, limit: deps.env.RATE_LIMIT_RPM, standardHeaders: true, legacyHeaders: false }));

  app.get("/healthz", (_req, res) => {
    res.json({ ok: true });
  });

  app.get("/readyz", async (_req, res) => {
    const issues: string[] = [];
    try {
      await deps.taxRates.load("CA-QC", new Date().getUTCFullYear());
    } catch (e) {
      issues.push(`tax-rates: ${e instanceof Error ? e.message : String(e)}`);
    }
    try {
      const gql = new GraphQLClient(deps.env.WAVE_GRAPHQL_ENDPOINT);
      await gql.request("{ __typename }");
    } catch (e) {
      issues.push(`wave-schema: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (issues.length > 0) {
      res.status(503).json({ ok: false, issues });
      return;
    }
    res.json({ ok: true });
  });

  app.use(
    mcpAuthRouter({
      provider: oauthProvider,
      issuerUrl: oauth.issuerUrl,
      baseUrl: oauth.publicBaseUrl,
      resourceServerUrl: oauth.resourceServerUrl,
      resourceName: "mcp-wave",
      scopesSupported: [OAUTH_SCOPE],
    }),
  );

  app.all(
    "/mcp",
    express.json({ limit: "1mb", type: ["application/json", "application/*+json"] }),
    requireBearerAuth({
      verifier: oauthProvider,
      requiredScopes: [OAUTH_SCOPE],
      resourceMetadataUrl: oauth.resourceMetadataUrl,
    }),
    async (req, res, next) => {
      try {
        const requestId = randomUUID();
        const requestedSessionId = req.header("mcp-session-id");
        let session = requestedSessionId ? sessions.get(requestedSessionId) : undefined;

        if (!session) {
          let newSession: OAuthHttpSession | undefined;
          const transport = new StreamableHTTPServerTransport({
            enableJsonResponse: true,
            sessionIdGenerator: () => randomUUID(),
            onsessioninitialized: (sessionId) => {
              if (newSession) sessions.set(sessionId, newSession);
            },
            onsessionclosed: (sessionId) => {
              sessions.delete(sessionId);
            },
          });
          newSession = { transport };
          const identity = `oauth:${req.auth?.clientId}:${String(req.auth?.extra?.tokenHashPrefix ?? "unknown")}`;
          const reqCtx = { headers: new Headers(req.headers as Record<string, string>), request_id: requestId };
          const { server } = buildMcpServer({
            tools: allTools(),
            makeCtx: () => ({
              req: reqCtx,
              wave: deps.wave,
              taxRates: deps.taxRates,
              accountMapping: deps.accountMapping,
              env: deps.env,
              logger: deps.logger.child({ request_id: requestId }),
              identity,
            }),
          });
          await server.connect(transport);
          session = newSession;
        }

        deps.logger.info({ request_id: requestId, client_id: req.auth?.clientId }, "mcp oauth http request");
        await session.transport.handleRequest(req, res, req.body);
      } catch (error) {
        next(error);
      }
    },
  );

  return app;
}
```

Add default deps and server startup:

```ts
async function defaultDeps(): Promise<OAuthHttpAppDeps> {
  const env = parseEnv(process.env);
  const logger = createLogger({ level: env.LOG_LEVEL, logPII: env.LOG_PII });
  const provider = selectProvider(env);
  const oauthStore = new FileOAuthStore(env.OAUTH_STORE_PATH);
  await oauthStore.load();
  return {
    env,
    logger,
    provider,
    oauthStore,
    wave: new WaveClient({ endpoint: env.WAVE_GRAPHQL_ENDPOINT, provider }),
    taxRates: new TaxRatesLoader(resolve("data/tax-rates")),
    accountMapping: new AccountMappingLoader(resolve("data/account-mapping")),
  };
}

export const appPromise = defaultDeps().then((deps) => buildOAuthHttpApp(deps));

if (process.env.NODE_ENV !== "test") {
  const deps = await defaultDeps();
  const app = buildOAuthHttpApp(deps);
  const port = Number(process.env.PORT ?? 8080);
  createServer(app).listen(port, () => {
    deps.logger.info({ port, tools: allTools().length }, "mcp-wave oauth http ready");
  });
}
```

- [ ] **Step 4: Run OAuth entrypoint integration tests**

Run:

```bash
npm run test:integration -- tests/integration/entrypoints/oauth-http.test.ts
```

Expected:

```text
PASS tests/integration/entrypoints/oauth-http.test.ts
```

- [ ] **Step 5: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected:

```text
> mcp-wave@0.1.0 typecheck
> tsc --noEmit
```

Exit code must be 0.

- [ ] **Step 6: Commit**

Run:

```bash
git add src/server/http/express-origin-allowlist.ts src/entrypoints/oauth-http.ts tests/integration/entrypoints/oauth-http.test.ts
git commit -m "feat(oauth): add protected HTTP entrypoint"
```

Expected: commit succeeds.

---

## Task 6: Docker Image

**Files:**
- Create: `Dockerfile`
- Create: `.dockerignore`

- [ ] **Step 1: Create `.dockerignore`**

```text
.git
.claude
.codex
.agents
.gemini
node_modules
dist
coverage
.env
.env.*
!.env.example
*.log
deploy/scw/secret.example.yaml
```

- [ ] **Step 2: Create `Dockerfile`**

```dockerfile
FROM node:24-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS build
WORKDIR /app
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
COPY data ./data
RUN npm run build
RUN npm prune --omit=dev

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production
ENV PORT=8080
WORKDIR /app
COPY --from=build --chown=node:node /app/package.json /app/package-lock.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/data ./data
USER node
EXPOSE 8080
CMD ["node", "dist/entrypoints/oauth-http.js"]
```

- [ ] **Step 3: Build image locally**

Run:

```bash
docker build -t mcp-wave:wp-ops-01 .
```

Expected:

```text
Successfully tagged mcp-wave:wp-ops-01
```

- [ ] **Step 4: Commit**

Run:

```bash
git add Dockerfile .dockerignore
git commit -m "build: add OAuth HTTP Docker image"
```

Expected: commit succeeds.

---

## Task 7: Scaleway Kapsule Manifests And Runbook

**Files:**
- Create: `deploy/scw/kustomization.yaml`
- Create: `deploy/scw/deployment.yaml`
- Create: `deploy/scw/service.yaml`
- Create: `deploy/scw/ingress.yaml`
- Create: `deploy/scw/pvc.yaml`
- Create: `deploy/scw/configmap.example.yaml`
- Create: `deploy/scw/secret.example.yaml`
- Create: `deploy/scw/README.md`

- [ ] **Step 1: Create Kustomize bundle**

Create `deploy/scw/kustomization.yaml`:

```yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
namespace: mcp-wave
resources:
  - deployment.yaml
  - service.yaml
  - ingress.yaml
  - pvc.yaml
images:
  - name: mcp-wave
    newName: mcp-wave
    newTag: local
```

- [ ] **Step 2: Create deployment**

Create `deploy/scw/deployment.yaml`:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: mcp-wave
  labels:
    app.kubernetes.io/name: mcp-wave
spec:
  replicas: 1
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxUnavailable: 0
      maxSurge: 1
  selector:
    matchLabels:
      app.kubernetes.io/name: mcp-wave
  template:
    metadata:
      labels:
        app.kubernetes.io/name: mcp-wave
    spec:
      serviceAccountName: mcp-wave
      securityContext:
        runAsNonRoot: true
        runAsUser: 1000
        runAsGroup: 1000
        fsGroup: 1000
      containers:
        - name: mcp-wave
          image: mcp-wave:local
          imagePullPolicy: IfNotPresent
          ports:
            - name: http
              containerPort: 8080
          envFrom:
            - configMapRef:
                name: mcp-wave-config
            - secretRef:
                name: mcp-wave-secret
          volumeMounts:
            - name: oauth-store
              mountPath: /var/lib/mcp-wave
          readinessProbe:
            httpGet:
              path: /readyz
              port: http
            initialDelaySeconds: 10
            periodSeconds: 15
            timeoutSeconds: 5
            failureThreshold: 4
          livenessProbe:
            httpGet:
              path: /healthz
              port: http
            initialDelaySeconds: 10
            periodSeconds: 30
            timeoutSeconds: 3
            failureThreshold: 3
          resources:
            requests:
              cpu: 100m
              memory: 192Mi
            limits:
              cpu: 500m
              memory: 512Mi
          securityContext:
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
            capabilities:
              drop:
                - ALL
      volumes:
        - name: oauth-store
          persistentVolumeClaim:
            claimName: mcp-wave-oauth-store
```

- [ ] **Step 3: Create service, ingress, PVC, and examples**

Create `deploy/scw/service.yaml`:

```yaml
apiVersion: v1
kind: Service
metadata:
  name: mcp-wave
  labels:
    app.kubernetes.io/name: mcp-wave
spec:
  type: ClusterIP
  selector:
    app.kubernetes.io/name: mcp-wave
  ports:
    - name: http
      port: 80
      targetPort: http
```

Create `deploy/scw/ingress.yaml`:

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: mcp-wave
  annotations:
    kubernetes.io/ingress.class: traefik
spec:
  ingressClassName: traefik
  tls:
    - hosts:
        - mcp-wave.example.invalid
      secretName: mcp-wave-tls
  rules:
    - host: mcp-wave.example.invalid
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: mcp-wave
                port:
                  name: http
```

Create `deploy/scw/pvc.yaml`:

```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: mcp-wave-oauth-store
spec:
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 1Gi
```

Create `deploy/scw/configmap.example.yaml`:

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: mcp-wave-config
  namespace: mcp-wave
data:
  NODE_ENV: production
  PORT: "8080"
  WAVE_AUTH_MODE: env_token
  WAVE_GRAPHQL_ENDPOINT: https://gql.waveapps.com/graphql/public
  LOG_LEVEL: info
  LOG_PII: "false"
  ALLOWED_ORIGINS: https://claude.ai,https://claude.com
  RATE_LIMIT_RPM: "60"
  PUBLIC_BASE_URL: https://mcp-wave.example.invalid
  OAUTH_ISSUER_URL: https://mcp-wave.example.invalid
  OAUTH_STORE_PATH: /var/lib/mcp-wave/oauth-store.json
  OAUTH_ACCESS_TOKEN_TTL_SECONDS: "3600"
  OAUTH_REFRESH_TOKEN_TTL_SECONDS: "2592000"
  OAUTH_AUTH_CODE_TTL_SECONDS: "300"
  OAUTH_ALLOWED_REDIRECT_URIS: https://claude.ai/api/mcp/auth_callback,https://claude.com/api/mcp/auth_callback
```

Create `deploy/scw/secret.example.yaml`:

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: mcp-wave-secret
  namespace: mcp-wave
type: Opaque
stringData:
  WAVE_API_TOKEN: not-a-real-wave-token
  WAVE_DEFAULT_BUSINESS_ID: biz_not_real
  OAUTH_CONSENT_SECRET: not-a-real-consent-secret
```

- [ ] **Step 4: Create runbook**

Create `deploy/scw/README.md` with sections and commands:

````markdown
# mcp-wave Scaleway Kapsule Runbook

## Inputs

- Kapsule cluster context selected in `kubectl`.
- Namespace contract already created by `poc-k8s`: `mcp-wave`, resource quota, limit range, default deny policy, and `mcp-wave` service account.
- Scaleway Container Registry namespace available in `fr-par`.
- DNS host pointed at the cluster ingress.
- Wave full-access token and Wave business id available from the operator vault.

## Build And Push

```bash
export IMAGE="rg.fr-par.scw.cloud/mcp-wave/mcp-wave:$(git rev-parse --short HEAD)"
docker build -t "${IMAGE}" .
docker push "${IMAGE}"
```

## Runtime Config

```bash
export MCP_WAVE_HOST="mcp-wave.example.invalid"
kubectl -n mcp-wave create configmap mcp-wave-config \
  --from-literal=NODE_ENV=production \
  --from-literal=PORT=8080 \
  --from-literal=WAVE_AUTH_MODE=env_token \
  --from-literal=WAVE_GRAPHQL_ENDPOINT=https://gql.waveapps.com/graphql/public \
  --from-literal=LOG_LEVEL=info \
  --from-literal=LOG_PII=false \
  --from-literal=ALLOWED_ORIGINS=https://claude.ai,https://claude.com \
  --from-literal=RATE_LIMIT_RPM=60 \
  --from-literal=PUBLIC_BASE_URL="https://${MCP_WAVE_HOST}" \
  --from-literal=OAUTH_ISSUER_URL="https://${MCP_WAVE_HOST}" \
  --from-literal=OAUTH_STORE_PATH=/var/lib/mcp-wave/oauth-store.json \
  --from-literal=OAUTH_ACCESS_TOKEN_TTL_SECONDS=3600 \
  --from-literal=OAUTH_REFRESH_TOKEN_TTL_SECONDS=2592000 \
  --from-literal=OAUTH_AUTH_CODE_TTL_SECONDS=300 \
  --from-literal=OAUTH_ALLOWED_REDIRECT_URIS=https://claude.ai/api/mcp/auth_callback,https://claude.com/api/mcp/auth_callback \
  --dry-run=client -o yaml | kubectl apply -f -
```

```bash
kubectl -n mcp-wave create secret generic mcp-wave-secret \
  --from-literal=WAVE_API_TOKEN="${WAVE_API_TOKEN}" \
  --from-literal=WAVE_DEFAULT_BUSINESS_ID="${WAVE_DEFAULT_BUSINESS_ID}" \
  --from-literal=OAUTH_CONSENT_SECRET="${OAUTH_CONSENT_SECRET}" \
  --dry-run=client -o yaml | kubectl apply -f -
```

## Deploy

```bash
cp -R deploy/scw /tmp/mcp-wave-scw
cd /tmp/mcp-wave-scw
kustomize edit set image "mcp-wave=${IMAGE}"
kubectl apply -k .
kubectl -n mcp-wave rollout status deployment/mcp-wave
```

## Smoke Checks

```bash
curl -fsS "https://${MCP_WAVE_HOST}/healthz"
curl -fsS "https://${MCP_WAVE_HOST}/readyz"
curl -fsS "https://${MCP_WAVE_HOST}/.well-known/oauth-authorization-server"
curl -fsS "https://${MCP_WAVE_HOST}/.well-known/oauth-protected-resource/mcp"
```

`/mcp` without a token must return 401 and a `WWW-Authenticate` header:

```bash
curl -i "https://${MCP_WAVE_HOST}/mcp" \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  --data '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}}'
```

## Rollback

```bash
kubectl -n mcp-wave rollout undo deployment/mcp-wave
kubectl -n mcp-wave rollout status deployment/mcp-wave
```

## Secret Rotation

Rotate `OAUTH_CONSENT_SECRET`:

```bash
kubectl -n mcp-wave create secret generic mcp-wave-secret \
  --from-literal=WAVE_API_TOKEN="${WAVE_API_TOKEN}" \
  --from-literal=WAVE_DEFAULT_BUSINESS_ID="${WAVE_DEFAULT_BUSINESS_ID}" \
  --from-literal=OAUTH_CONSENT_SECRET="${NEW_OAUTH_CONSENT_SECRET}" \
  --dry-run=client -o yaml | kubectl apply -f -
kubectl -n mcp-wave rollout restart deployment/mcp-wave
```

Rotate `WAVE_API_TOKEN` with the same command and a new `WAVE_API_TOKEN` value.

## OAuth Token Revocation

Use the OAuth revocation endpoint with the client id and token issued during the OAuth flow:

```bash
curl -fsS -X POST "https://${MCP_WAVE_HOST}/revoke" \
  -H 'content-type: application/x-www-form-urlencoded' \
  --data-urlencode "client_id=${OAUTH_CLIENT_ID}" \
  --data-urlencode "token=${OAUTH_TOKEN}"
```
````

- [ ] **Step 5: Validate manifests render**

Run:

```bash
kubectl kustomize deploy/scw
```

Expected:

```text
apiVersion: v1
kind: Service
metadata:
  name: mcp-wave
```

The rendered output must include one `Deployment`, one `Service`, one `Ingress`, and one `PersistentVolumeClaim`.

- [ ] **Step 6: Commit**

Run:

```bash
git add deploy/scw
git commit -m "deploy(scw): add Kapsule manifests and runbook"
```

Expected: commit succeeds.

---

## Task 8: Docs, Full Verification, And Push

**Files:**
- Modify: `README.md`
- Modify: `plan.md`

- [ ] **Step 1: Update README**

Add a section to `README.md`:

````markdown
## OAuth Remote MCP Deploy

The production remote MCP entrypoint is `src/entrypoints/oauth-http.ts`. It exposes:

- OAuth authorization server metadata
- OAuth protected resource metadata for `/mcp`
- Dynamic client registration
- Authorization code + PKCE token exchange
- Refresh token exchange
- Token revocation
- OAuth-protected Streamable HTTP MCP at `/mcp`

The deploy target for `WP-OPS-01` is Scaleway Kapsule with the image running:

```bash
node dist/entrypoints/oauth-http.js
```

See `deploy/scw/README.md` for the build, push, deploy, smoke, rollback, secret rotation, and token revocation runbook.
````

- [ ] **Step 2: Update `plan.md`**

Change `WP-OPS-01 - Single-tenant Kapsule deploy` status from:

```markdown
### WP-OPS-01 - Single-tenant Kapsule deploy `[spec review]`
```

to:

```markdown
### WP-OPS-01 - Single-tenant Kapsule deploy `[implementation ready]`
```

Add this line under `Design spec`:

```markdown
**Implementation plan**
- `docs/superpowers/plans/2026-05-21-wp-ops-01-oauth-kapsule-implementation.md`
```

- [ ] **Step 3: Run focused verification**

Run:

```bash
npm run test:unit -- tests/unit/config/env.oauth.test.ts tests/unit/server/oauth/crypto.test.ts tests/unit/server/oauth/redirect-uri.test.ts tests/unit/server/oauth/file-store.test.ts tests/unit/server/oauth/single-tenant-provider.test.ts
npm run test:integration -- tests/integration/entrypoints/oauth-http.test.ts
npm run typecheck
npm run lint
```

Expected:

```text
PASS tests/unit/config/env.oauth.test.ts
PASS tests/unit/server/oauth/crypto.test.ts
PASS tests/unit/server/oauth/redirect-uri.test.ts
PASS tests/unit/server/oauth/file-store.test.ts
PASS tests/unit/server/oauth/single-tenant-provider.test.ts
PASS tests/integration/entrypoints/oauth-http.test.ts
```

Both `typecheck` and `lint` must exit 0.

- [ ] **Step 4: Run full verification**

Run:

```bash
npm run check
```

Expected:

```text
> mcp-wave@0.1.0 check
> npm run lint && npm run typecheck && npm run test
```

Exit code must be 0.

- [ ] **Step 5: Commit docs**

Run:

```bash
git add README.md plan.md docs/superpowers/plans/2026-05-21-wp-ops-01-oauth-kapsule-implementation.md
git commit -m "docs(plan): add OAuth Kapsule implementation plan"
```

Expected: commit succeeds.

- [ ] **Step 6: Push**

Run:

```bash
git push origin main
```

Expected:

```text
To github.com:rhanka/mcp-wave.git
   previous..current  main -> main
```

---

## Self-Review

Spec coverage:
- OAuth metadata, DCR, authorization code + PKCE, refresh tokens, revocation, protected `/mcp`: Tasks 4 and 5.
- Single-tenant Wave token model: Task 5 uses `selectProvider(env)` with `WAVE_AUTH_MODE=env_token`; Task 7 stores Wave token in Kubernetes Secret only.
- Redirect URI policy: Task 2 validates Claude callbacks in production and loopback callbacks outside production.
- Operator consent secret: Task 4 renders and validates the consent form without logging the secret.
- File-backed JSON store on PVC: Tasks 3 and 7.
- Docker image and Scaleway Kapsule manifests: Tasks 6 and 7.
- Health, readiness, smoke, rollback, secret rotation, token revocation: Tasks 5 and 7.
- Existing dev HTTP path preserved: no task modifies `src/entrypoints/http.ts`.

Red-flag scan:
- The plan contains concrete paths, commands, expected outcomes, and code blocks for each code-producing step.
- No unresolved marker text is required for implementation.

Type consistency:
- `OAuthRuntimeConfig`, `FileOAuthStore`, and `SingleTenantOAuthProvider` names are consistent across tasks.
- SDK imports match the installed `@modelcontextprotocol/sdk` 1.29 ESM paths checked during planning.
- Express entrypoint uses `StreamableHTTPServerTransport`, which accepts `IncomingMessage & { auth?: AuthInfo }` and `ServerResponse`.
