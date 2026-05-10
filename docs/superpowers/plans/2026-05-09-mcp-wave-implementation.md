# MCP Wave Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a serverless TypeScript MCP server exposing Wave Accounting (waveapps.com) operations to Claude — invoices, transactions, customers, payroll-remittance splits, alias-driven invoice creation — deployable identically to GCP Cloud Run (validation) and Scaleway Containers (production), with pluggable Wave authentication.

**Architecture:** Single Node 22 process, Hono HTTP framework, MCP SDK with both stdio and Streamable HTTP transports, Wave GraphQL client with codegen-typed SDK, deterministic domain logic in pure TypeScript, stateless runtime. Wave is the source of truth for all data; the MCP carries only read-only YAML tables for tax rates and account mapping.

**Tech Stack:** TypeScript 5.7 strict · Node 22 LTS · `@modelcontextprotocol/sdk` 1.x · Hono 4.x · `graphql-request` 7.x · `@graphql-codegen/cli` 5.x · Zod 3.24 · Vitest 2.x · msw 2.x · pino 9.x · p-retry 6.x · execa 9.x · tsx 4.x · Biome 1.9 · Distroless Node 22 image · `gcloud` and `scw` CLIs.

**Reference spec:** `docs/superpowers/specs/2026-05-09-mcp-wave-design.md` (sections referenced as §N throughout).

**Plan structure:**
- **Part A — Foundations + Read-only MCP** (Tasks A1–A44) → working stdio MCP, read-only Wave access, locally usable from Claude Desktop.
- **Part B — Write tools + Workflows** (Tasks B1–B30) → full v1 functionality including the two flagship workflows.
- **Part C — Multi-cloud deployment** (Tasks C1–C18) → GCP Cloud Run + Scaleway Containers production runtime.

Each part is independently mergeable and produces working software. Commit after every task. Run `npm run check` (lint + typecheck + test) before each commit.

---

## Part A — Foundations + Read-only MCP

### Phase A.0 — Bootstrap (Tasks A1–A5)

### Task A1: Initialize git repo and base files

**Files:**
- Create: `.gitignore`
- Create: `README.md`
- Create: `.nvmrc`
- Create: `.editorconfig`

- [ ] **Step 1: Initialize git**

```bash
cd /home/user/src/mcp-wave
git init
git branch -m main
```

Expected: `Initialized empty Git repository in /home/user/src/mcp-wave/.git/` and main branch created.

- [ ] **Step 2: Create `.gitignore`**

```
node_modules/
dist/
coverage/
.env
.env.*
!.env.example
*.log
.DS_Store
.vscode/
.idea/
src/wave/generated/sdk.ts
src/wave/generated/schema.graphql
.deploy.env
```

- [ ] **Step 3: Create `.nvmrc`**

```
22
```

- [ ] **Step 4: Create `.editorconfig`**

```
root = true

[*]
end_of_line = lf
insert_final_newline = true
indent_style = space
indent_size = 2
charset = utf-8
trim_trailing_whitespace = true

[*.md]
trim_trailing_whitespace = false
```

- [ ] **Step 5: Create `README.md` stub**

```markdown
# mcp-wave

Model Context Protocol server for [Wave Accounting](https://waveapps.com).

See `docs/superpowers/specs/2026-05-09-mcp-wave-design.md` for the design spec.

## Quick start

```bash
npm install
cp .env.example .env             # then fill in WAVE_API_TOKEN
npm run codegen                  # fetch Wave schema and generate TS SDK
npm run dev:stdio                # run MCP locally over stdio
```

## Status

Under active development. See `docs/superpowers/plans/2026-05-09-mcp-wave-implementation.md`.
```

- [ ] **Step 6: First commit**

```bash
git add .gitignore README.md .nvmrc .editorconfig docs/
git commit -m "chore: initial commit with spec and plan"
```

Expected: commit succeeds, `git log` shows one commit including the spec and plan files we already wrote.

---

### Task A2: package.json + TypeScript config

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `tsconfig.build.json`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "mcp-wave",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": {
    "node": ">=22"
  },
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "typecheck": "tsc --noEmit",
    "lint": "biome check .",
    "lint:fix": "biome check --write .",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:unit": "vitest run tests/unit",
    "test:integration": "vitest run tests/integration",
    "coverage": "vitest run --coverage",
    "codegen": "graphql-codegen --config codegen.yml",
    "dev:stdio": "tsx watch src/entrypoints/stdio.ts",
    "dev:http": "tsx watch src/entrypoints/http.ts",
    "check": "npm run lint && npm run typecheck && npm run test"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0",
    "graphql": "^16.9.0",
    "graphql-request": "^7.1.0",
    "hono": "^4.6.0",
    "p-retry": "^6.2.0",
    "pino": "^9.5.0",
    "yaml": "^2.6.0",
    "zod": "^3.24.0"
  },
  "devDependencies": {
    "@biomejs/biome": "^1.9.0",
    "@graphql-codegen/cli": "^5.0.0",
    "@graphql-codegen/typescript": "^4.1.0",
    "@graphql-codegen/typescript-graphql-request": "^6.2.0",
    "@graphql-codegen/typescript-operations": "^4.4.0",
    "@hono/node-server": "^1.13.0",
    "@types/node": "^22.9.0",
    "@vitest/coverage-v8": "^2.1.0",
    "execa": "^9.5.0",
    "fast-check": "^3.23.0",
    "msw": "^2.6.0",
    "tsx": "^4.19.0",
    "typescript": "^5.7.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2023"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "exactOptionalPropertyTypes": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "outDir": "dist",
    "rootDir": "src",
    "baseUrl": ".",
    "types": ["node"]
  },
  "include": ["src/**/*", "tests/**/*", "scripts/**/*"],
  "exclude": ["node_modules", "dist", "coverage"]
}
```

- [ ] **Step 3: Create `tsconfig.build.json`**

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "noEmit": false,
    "declaration": false,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["src/**/*.test.ts", "tests/**/*"]
}
```

- [ ] **Step 4: Install dependencies**

```bash
npm install
```

Expected: dependencies install, `node_modules/` populated, `package-lock.json` created.

- [ ] **Step 5: Verify typecheck on empty src**

```bash
mkdir -p src
echo 'export {};' > src/index.ts
npm run typecheck
```

Expected: no errors. Now remove the placeholder:

```bash
rm src/index.ts
```

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json tsconfig.json tsconfig.build.json
git commit -m "chore: package.json, tsconfig, base dependencies"
```

---

### Task A3: Biome config

**Files:**
- Create: `biome.json`

- [ ] **Step 1: Create `biome.json`**

```json
{
  "$schema": "./node_modules/@biomejs/biome/configuration_schema.json",
  "vcs": { "enabled": true, "clientKind": "git", "useIgnoreFile": true },
  "files": {
    "ignore": ["dist", "coverage", "src/wave/generated", "node_modules"]
  },
  "formatter": {
    "enabled": true,
    "indentStyle": "space",
    "indentWidth": 2,
    "lineWidth": 100
  },
  "organizeImports": { "enabled": true },
  "linter": {
    "enabled": true,
    "rules": {
      "recommended": true,
      "style": {
        "noNonNullAssertion": "warn",
        "useImportType": "error"
      },
      "suspicious": {
        "noExplicitAny": "warn"
      },
      "complexity": {
        "noForEach": "off"
      }
    }
  },
  "javascript": {
    "formatter": {
      "quoteStyle": "double",
      "trailingCommas": "all",
      "semicolons": "always"
    }
  }
}
```

- [ ] **Step 2: Run lint on empty repo**

```bash
npm run lint
```

Expected: no files checked or no issues.

- [ ] **Step 3: Commit**

```bash
git add biome.json
git commit -m "chore: biome config"
```

---

### Task A4: Vitest config and first smoke test

**Files:**
- Create: `vitest.config.ts`
- Create: `tests/unit/smoke.test.ts`

- [ ] **Step 1: Create `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: false,
    environment: "node",
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov", "html"],
      include: ["src/**/*.ts"],
      exclude: ["src/wave/generated/**", "src/entrypoints/**"],
      thresholds: {
        lines: 85,
        statements: 85,
        functions: 85,
        branches: 80,
      },
    },
  },
});
```

- [ ] **Step 2: Write the failing smoke test**

```ts
// tests/unit/smoke.test.ts
import { describe, expect, it } from "vitest";

describe("smoke", () => {
  it("vitest runs", () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 3: Run the test**

```bash
npm run test
```

Expected: `1 passed`. If anything fails, investigate before continuing.

- [ ] **Step 4: Commit**

```bash
git add vitest.config.ts tests/unit/smoke.test.ts
git commit -m "chore: vitest config and smoke test"
```

---

### Task A5: Project skeleton directories

**Files:**
- Create: empty index files / placeholders to anchor the layout

- [ ] **Step 1: Create the directory tree**

```bash
mkdir -p src/{entrypoints,server,tools,wave/auth,wave/operations,wave/generated,domain/tax,domain/client-profiles,domain/invoice-templating,config,lib}
mkdir -p src/tools/{invoices,transactions,customers,products,vendors,accounts,reports,workflows,businesses,profiles,tax}
mkdir -p data/{tax-rates,account-mapping}
mkdir -p tests/{unit,integration,e2e,fixtures/wave-graphql}
mkdir -p scripts/lib
```

- [ ] **Step 2: Add `.gitkeep` to empty directories that must exist**

```bash
touch src/wave/generated/.gitkeep
touch tests/fixtures/wave-graphql/.gitkeep
touch data/tax-rates/.gitkeep
touch data/account-mapping/.gitkeep
```

- [ ] **Step 3: Verify**

```bash
find src data tests scripts -type d | sort
```

Expected output includes all directories listed in step 1.

- [ ] **Step 4: Commit**

```bash
git add src data tests scripts
git commit -m "chore: project skeleton directories"
```

---

### Phase A.1 — Config + lib basics (Tasks A6–A10)

### Task A6: Env validation with Zod

**Files:**
- Create: `src/config/env.ts`
- Create: `tests/unit/config/env.test.ts`
- Create: `.env.example`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/config/env.test.ts
import { describe, expect, it } from "vitest";
import { parseEnv } from "../../../src/config/env.js";

describe("parseEnv", () => {
  it("parses a valid env_token configuration", () => {
    const result = parseEnv({
      WAVE_AUTH_MODE: "env_token",
      WAVE_API_TOKEN: "abc123",
      WAVE_DEFAULT_BUSINESS_ID: "biz_xyz",
      WAVE_GRAPHQL_ENDPOINT: "https://gql.waveapps.com/graphql/public",
      LOG_LEVEL: "info",
      NODE_ENV: "test",
    });
    expect(result.WAVE_AUTH_MODE).toBe("env_token");
    expect(result.WAVE_API_TOKEN).toBe("abc123");
  });

  it("rejects env_token mode when WAVE_API_TOKEN is missing", () => {
    expect(() =>
      parseEnv({
        WAVE_AUTH_MODE: "env_token",
        WAVE_DEFAULT_BUSINESS_ID: "biz_xyz",
        WAVE_GRAPHQL_ENDPOINT: "https://x",
      }),
    ).toThrow(/WAVE_API_TOKEN/);
  });

  it("accepts bearer_passthrough without WAVE_API_TOKEN", () => {
    const r = parseEnv({
      WAVE_AUTH_MODE: "bearer_passthrough",
      WAVE_DEFAULT_BUSINESS_ID: "biz_xyz",
      WAVE_GRAPHQL_ENDPOINT: "https://x",
    });
    expect(r.WAVE_AUTH_MODE).toBe("bearer_passthrough");
  });

  it("defaults LOG_LEVEL to info, NODE_ENV to development", () => {
    const r = parseEnv({
      WAVE_AUTH_MODE: "mock",
      WAVE_API_TOKEN: "x",
      WAVE_DEFAULT_BUSINESS_ID: "biz_xyz",
      WAVE_GRAPHQL_ENDPOINT: "https://x",
    });
    expect(r.LOG_LEVEL).toBe("info");
    expect(r.NODE_ENV).toBe("development");
  });

  it("rejects unknown WAVE_AUTH_MODE values", () => {
    expect(() =>
      parseEnv({
        WAVE_AUTH_MODE: "weird",
        WAVE_DEFAULT_BUSINESS_ID: "biz_xyz",
        WAVE_GRAPHQL_ENDPOINT: "https://x",
      }),
    ).toThrow();
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

```bash
npm run test -- tests/unit/config/env.test.ts
```

Expected: 5 failing tests with "Cannot find module" or similar.

- [ ] **Step 3: Implement `parseEnv`**

```ts
// src/config/env.ts
import { z } from "zod";

const baseSchema = z.object({
  WAVE_AUTH_MODE: z.enum(["env_token", "bearer_passthrough", "mock"]),
  WAVE_API_TOKEN: z.string().min(1).optional(),
  WAVE_DEFAULT_BUSINESS_ID: z.string().min(1),
  WAVE_GRAPHQL_ENDPOINT: z.string().url(),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  LOG_PII: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  ALLOWED_ORIGINS: z.string().default("http://localhost:*"),
  RATE_LIMIT_RPM: z.coerce.number().int().positive().default(60),
});

const envSchema = baseSchema.superRefine((v, ctx) => {
  if (v.WAVE_AUTH_MODE === "env_token" && !v.WAVE_API_TOKEN) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "WAVE_API_TOKEN is required when WAVE_AUTH_MODE=env_token",
      path: ["WAVE_API_TOKEN"],
    });
  }
});

export type AppEnv = z.infer<typeof envSchema>;

export function parseEnv(source: Record<string, string | undefined> = process.env): AppEnv {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("\n  ");
    throw new Error(`Invalid environment configuration:\n  ${issues}`);
  }
  return parsed.data;
}
```

- [ ] **Step 4: Run the test, verify it passes**

```bash
npm run test -- tests/unit/config/env.test.ts
```

Expected: 5 passing.

- [ ] **Step 5: Create `.env.example`**

```
WAVE_AUTH_MODE=env_token
WAVE_API_TOKEN=replace-with-your-full-access-token
WAVE_DEFAULT_BUSINESS_ID=biz_xxx
WAVE_GRAPHQL_ENDPOINT=https://gql.waveapps.com/graphql/public
LOG_LEVEL=info
NODE_ENV=development
ALLOWED_ORIGINS=http://localhost:*
RATE_LIMIT_RPM=60
```

- [ ] **Step 6: Commit**

```bash
git add src/config/env.ts tests/unit/config/env.test.ts .env.example
git commit -m "feat(config): zod-validated env parsing with auth-mode rules"
```

---

### Task A7: Logger with PII redaction

**Files:**
- Create: `src/config/logger.ts`
- Create: `tests/unit/config/logger.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/config/logger.test.ts
import { describe, expect, it } from "vitest";
import { createLogger, redact } from "../../../src/config/logger.js";

describe("redact", () => {
  it("redacts authorization headers", () => {
    const out = redact({ headers: { authorization: "Bearer abc123" } });
    expect(out).toEqual({ headers: { authorization: "[REDACTED]" } });
  });

  it("redacts token-like keys at any depth", () => {
    const out = redact({ a: { token: "x", b: { api_token: "y" } } });
    expect(out).toEqual({ a: { token: "[REDACTED]", b: { api_token: "[REDACTED]" } } });
  });

  it("redacts emails when LOG_PII is false", () => {
    const out = redact({ email: "a@b.c", recipient: "x@y.z" });
    expect(out.email).toBe("[REDACTED]");
    expect(out.recipient).toBe("[REDACTED]");
  });

  it("preserves non-sensitive keys", () => {
    const out = redact({ id: "inv_1", amount: 42, currency: "CAD" });
    expect(out).toEqual({ id: "inv_1", amount: 42, currency: "CAD" });
  });

  it("handles arrays", () => {
    const out = redact({ list: [{ token: "x" }, { id: 1 }] });
    expect(out).toEqual({ list: [{ token: "[REDACTED]" }, { id: 1 }] });
  });
});

describe("createLogger", () => {
  it("returns a pino logger with the requested level", () => {
    const log = createLogger({ level: "debug", logPII: false });
    expect(log.level).toBe("debug");
  });
});
```

- [ ] **Step 2: Run, verify failure**

```bash
npm run test -- tests/unit/config/logger.test.ts
```

- [ ] **Step 3: Implement**

```ts
// src/config/logger.ts
import pino, { type Logger } from "pino";

const REDACTED_KEYS = new Set([
  "authorization",
  "token",
  "api_token",
  "wave_api_token",
  "access_token",
  "refresh_token",
  "secret",
  "password",
  "email",
  "recipient",
  "to_email",
]);

export function redact(input: unknown): unknown {
  if (input === null || typeof input !== "object") return input;
  if (Array.isArray(input)) return input.map(redact);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (REDACTED_KEYS.has(k.toLowerCase())) {
      out[k] = "[REDACTED]";
    } else {
      out[k] = redact(v);
    }
  }
  return out;
}

export interface LoggerOptions {
  level: "fatal" | "error" | "warn" | "info" | "debug" | "trace";
  logPII: boolean;
}

export function createLogger(opts: LoggerOptions): Logger {
  return pino({
    level: opts.level,
    formatters: {
      log: (obj) => (opts.logPII ? obj : (redact(obj) as Record<string, unknown>)),
    },
    timestamp: pino.stdTimeFunctions.isoTime,
  });
}
```

- [ ] **Step 4: Verify pass**

```bash
npm run test -- tests/unit/config/logger.test.ts
```

Expected: 6 passing.

- [ ] **Step 5: Commit**

```bash
git add src/config/logger.ts tests/unit/config/logger.test.ts
git commit -m "feat(config): pino logger with PII-redaction"
```

---

### Task A8: Error types

**Files:**
- Create: `src/lib/errors.ts`
- Create: `tests/unit/lib/errors.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/lib/errors.test.ts
import { describe, expect, it } from "vitest";
import { ToolError, WaveApiError, normalizeError } from "../../../src/lib/errors.js";

describe("ToolError", () => {
  it("captures code, details, hint", () => {
    const e = new ToolError("ALIAS_NOT_FOUND", { alias: "x" }, "Try list_client_profiles");
    expect(e.code).toBe("ALIAS_NOT_FOUND");
    expect(e.details).toEqual({ alias: "x" });
    expect(e.hint).toBe("Try list_client_profiles");
    expect(e.message).toContain("ALIAS_NOT_FOUND");
  });

  it("serializes to a plain object", () => {
    const e = new ToolError("X", { a: 1 }, "h");
    expect(e.toJSON()).toEqual({ code: "X", details: { a: 1 }, hint: "h" });
  });
});

describe("WaveApiError", () => {
  it("extends ToolError with WAVE_-prefixed code", () => {
    const e = new WaveApiError("AUTHENTICATION_ERROR", 401, { foo: "bar" });
    expect(e).toBeInstanceOf(ToolError);
    expect(e.code).toBe("WAVE_AUTHENTICATION_ERROR");
    expect(e.httpStatus).toBe(401);
    expect(e.waveDetails).toEqual({ foo: "bar" });
  });
});

describe("normalizeError", () => {
  it("returns ToolError as-is", () => {
    const e = new ToolError("X");
    expect(normalizeError(e)).toBe(e);
  });

  it("wraps generic Error as INTERNAL_ERROR", () => {
    const e = normalizeError(new Error("oops"));
    expect(e).toBeInstanceOf(ToolError);
    expect(e.code).toBe("INTERNAL_ERROR");
    expect(e.details).toEqual({ message: "oops" });
  });

  it("wraps non-error values", () => {
    const e = normalizeError("plain string");
    expect(e.code).toBe("INTERNAL_ERROR");
  });
});
```

- [ ] **Step 2: Verify failure**

```bash
npm run test -- tests/unit/lib/errors.test.ts
```

- [ ] **Step 3: Implement**

```ts
// src/lib/errors.ts
export class ToolError extends Error {
  constructor(
    public readonly code: string,
    public readonly details: Record<string, unknown> = {},
    public readonly hint?: string,
  ) {
    super(`${code}${hint ? `: ${hint}` : ""}`);
    this.name = "ToolError";
  }

  toJSON(): { code: string; details: Record<string, unknown>; hint?: string } {
    return { code: this.code, details: this.details, hint: this.hint };
  }
}

export class WaveApiError extends ToolError {
  constructor(
    public readonly waveCode: string,
    public readonly httpStatus: number,
    public readonly waveDetails: unknown,
  ) {
    super(`WAVE_${waveCode}`, { httpStatus, waveDetails });
    this.name = "WaveApiError";
  }
}

export function normalizeError(e: unknown): ToolError {
  if (e instanceof ToolError) return e;
  if (e instanceof Error) {
    return new ToolError("INTERNAL_ERROR", { message: e.message, stack: e.stack });
  }
  return new ToolError("INTERNAL_ERROR", { value: String(e) });
}
```

- [ ] **Step 4: Verify pass**

```bash
npm run test -- tests/unit/lib/errors.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/errors.ts tests/unit/lib/errors.test.ts
git commit -m "feat(lib): ToolError, WaveApiError, normalizeError"
```

---

### Task A9: Time helpers

**Files:**
- Create: `src/lib/time.ts`
- Create: `tests/unit/lib/time.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/lib/time.test.ts
import { describe, expect, it } from "vitest";
import { isoToday, plusDays, isoDate, parseIsoDate } from "../../../src/lib/time.js";

describe("isoToday", () => {
  it("returns YYYY-MM-DD for the given clock", () => {
    const clock = () => new Date("2026-05-09T10:00:00Z");
    expect(isoToday(clock)).toBe("2026-05-09");
  });
});

describe("plusDays", () => {
  it("adds positive days", () => {
    expect(plusDays("2026-05-09", 30)).toBe("2026-06-08");
  });
  it("handles year boundary", () => {
    expect(plusDays("2026-12-15", 30)).toBe("2027-01-14");
  });
  it("handles zero", () => {
    expect(plusDays("2026-05-09", 0)).toBe("2026-05-09");
  });
});

describe("parseIsoDate", () => {
  it("rejects invalid formats", () => {
    expect(() => parseIsoDate("05/09/2026")).toThrow();
  });
  it("accepts valid YYYY-MM-DD", () => {
    expect(parseIsoDate("2026-05-09").getUTCFullYear()).toBe(2026);
  });
});

describe("isoDate", () => {
  it("formats a Date as YYYY-MM-DD", () => {
    expect(isoDate(new Date("2026-05-09T23:59:59Z"))).toBe("2026-05-09");
  });
});
```

- [ ] **Step 2: Verify failure**

```bash
npm run test -- tests/unit/lib/time.test.ts
```

- [ ] **Step 3: Implement**

```ts
// src/lib/time.ts
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export type IsoDate = string;

export function isoToday(clock: () => Date = () => new Date()): IsoDate {
  return isoDate(clock());
}

export function isoDate(d: Date): IsoDate {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function parseIsoDate(s: string): Date {
  if (!ISO_DATE_RE.test(s)) {
    throw new Error(`Invalid ISO date '${s}', expected YYYY-MM-DD`);
  }
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) throw new Error(`Invalid date '${s}'`);
  return d;
}

export function plusDays(s: IsoDate, days: number): IsoDate {
  const d = parseIsoDate(s);
  d.setUTCDate(d.getUTCDate() + days);
  return isoDate(d);
}
```

- [ ] **Step 4: Verify pass**

```bash
npm run test -- tests/unit/lib/time.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/time.ts tests/unit/lib/time.test.ts
git commit -m "feat(lib): ISO date helpers"
```

---

### Task A10: Retry helper

**Files:**
- Create: `src/lib/retry.ts`
- Create: `tests/unit/lib/retry.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/lib/retry.test.ts
import { describe, expect, it } from "vitest";
import { isRetryable } from "../../../src/lib/retry.js";
import { WaveApiError } from "../../../src/lib/errors.js";

describe("isRetryable", () => {
  it("returns true for 429", () => {
    expect(isRetryable(new WaveApiError("RATE_LIMITED", 429, null))).toBe(true);
  });
  it("returns true for 5xx", () => {
    expect(isRetryable(new WaveApiError("INTERNAL_SERVER_ERROR", 503, null))).toBe(true);
  });
  it("returns false for 4xx (non-429)", () => {
    expect(isRetryable(new WaveApiError("VALIDATION_ERROR", 400, null))).toBe(false);
    expect(isRetryable(new WaveApiError("AUTHENTICATION_ERROR", 401, null))).toBe(false);
    expect(isRetryable(new WaveApiError("NOT_FOUND", 404, null))).toBe(false);
  });
  it("returns true for network-like errors", () => {
    const e = new Error("ECONNRESET") as Error & { code?: string };
    e.code = "ECONNRESET";
    expect(isRetryable(e)).toBe(true);
  });
  it("returns false for unknown errors", () => {
    expect(isRetryable(new Error("oops"))).toBe(false);
  });
  it("returns false for non-error values", () => {
    expect(isRetryable("string")).toBe(false);
    expect(isRetryable(null)).toBe(false);
  });
});
```

- [ ] **Step 2: Verify failure**

```bash
npm run test -- tests/unit/lib/retry.test.ts
```

- [ ] **Step 3: Implement**

```ts
// src/lib/retry.ts
import pRetry, { AbortError, type Options as PRetryOptions } from "p-retry";
import { WaveApiError } from "./errors.js";

const NETWORK_CODES = new Set([
  "ECONNRESET",
  "ETIMEDOUT",
  "ECONNREFUSED",
  "ENOTFOUND",
  "EPIPE",
  "EAI_AGAIN",
]);

export function isRetryable(e: unknown): boolean {
  if (e instanceof WaveApiError) {
    if (e.httpStatus === 429) return true;
    if (e.httpStatus >= 500) return true;
    return false;
  }
  if (e instanceof Error) {
    const code = (e as Error & { code?: string }).code;
    if (code && NETWORK_CODES.has(code)) return true;
  }
  return false;
}

export function withRetry<T>(fn: () => Promise<T>, opts?: Partial<PRetryOptions>): Promise<T> {
  return pRetry(
    async () => {
      try {
        return await fn();
      } catch (e) {
        if (!isRetryable(e)) throw new AbortError(e instanceof Error ? e : new Error(String(e)));
        throw e;
      }
    },
    {
      retries: 3,
      factor: 2,
      minTimeout: 500,
      maxTimeout: 5000,
      randomize: true,
      ...opts,
    },
  );
}
```

- [ ] **Step 4: Verify pass**

```bash
npm run test -- tests/unit/lib/retry.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/retry.ts tests/unit/lib/retry.test.ts
git commit -m "feat(lib): retry helper with isRetryable"
```

---

### Phase A.2 — Domain (pure logic) (Tasks A11–A17)

### Task A11: Tax rates schema and sample fixture

**Files:**
- Create: `src/domain/tax/schema.ts`
- Create: `data/tax-rates/ca-qc-2026.yaml`
- Create: `tests/unit/domain/tax/schema.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/domain/tax/schema.test.ts
import { describe, expect, it } from "vitest";
import { TaxRatesSchema } from "../../../../src/domain/tax/schema.js";

const valid = {
  jurisdiction: "CA-QC",
  year: 2026,
  effective_from: "2026-01-01",
  effective_to: "2026-12-31",
  remittance_authorities: [
    { code: "CRA", name: "Receiver General", level: "federal" },
    { code: "RQ", name: "Revenu Québec", level: "regional" },
  ],
  payroll_taxes: [
    { code: "CIT", name: "Federal income tax", remits_to: "CRA", type: "withheld" },
  ],
  sales_taxes: [{ code: "GST", name: "GST", rate: 0.05, remits_to: "CRA" }],
};

describe("TaxRatesSchema", () => {
  it("accepts a valid table", () => {
    const r = TaxRatesSchema.safeParse(valid);
    expect(r.success).toBe(true);
  });

  it("rejects payroll_taxes referencing an unknown remits_to", () => {
    const bad = { ...valid, payroll_taxes: [{ ...valid.payroll_taxes[0], remits_to: "NOPE" }] };
    const r = TaxRatesSchema.safeParse(bad);
    expect(r.success).toBe(false);
  });

  it("rejects sales_taxes with negative rate", () => {
    const bad = { ...valid, sales_taxes: [{ ...valid.sales_taxes[0], rate: -0.05 }] };
    const r = TaxRatesSchema.safeParse(bad);
    expect(r.success).toBe(false);
  });

  it("requires effective_from <= effective_to", () => {
    const bad = { ...valid, effective_from: "2027-01-01", effective_to: "2026-01-01" };
    const r = TaxRatesSchema.safeParse(bad);
    expect(r.success).toBe(false);
  });
});
```

- [ ] **Step 2: Verify failure**

```bash
npm run test -- tests/unit/domain/tax/schema.test.ts
```

- [ ] **Step 3: Implement schema**

```ts
// src/domain/tax/schema.ts
import { z } from "zod";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");

const RemittanceAuthority = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  level: z.enum(["federal", "regional", "municipal", "other"]),
});

const PayrollTax = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  remits_to: z.string().min(1),
  type: z.enum(["withheld", "employer_only", "both"]),
  employer_rate: z.number().min(0).max(1).optional(),
  employee_rate: z.number().min(0).max(1).optional(),
  employer_factor: z.number().positive().optional(),
  insurable_max: z.number().nonnegative().optional(),
  pensionable_max: z.number().nonnegative().optional(),
  basic_exemption: z.number().nonnegative().optional(),
});

const SalesTax = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  rate: z.number().min(0).max(1),
  remits_to: z.string().min(1),
});

export const TaxRatesSchema = z
  .object({
    jurisdiction: z.string().min(1),
    year: z.number().int(),
    effective_from: isoDate,
    effective_to: isoDate,
    remittance_authorities: z.array(RemittanceAuthority).min(1),
    payroll_taxes: z.array(PayrollTax),
    sales_taxes: z.array(SalesTax),
  })
  .superRefine((v, ctx) => {
    if (v.effective_from > v.effective_to) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "effective_from must be <= effective_to",
        path: ["effective_from"],
      });
    }
    const codes = new Set(v.remittance_authorities.map((a) => a.code));
    for (const [i, t] of v.payroll_taxes.entries()) {
      if (!codes.has(t.remits_to)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `payroll_taxes[${i}].remits_to '${t.remits_to}' is not a known authority code`,
          path: ["payroll_taxes", i, "remits_to"],
        });
      }
    }
    for (const [i, t] of v.sales_taxes.entries()) {
      if (!codes.has(t.remits_to)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `sales_taxes[${i}].remits_to '${t.remits_to}' is not a known authority code`,
          path: ["sales_taxes", i, "remits_to"],
        });
      }
    }
  });

export type TaxRates = z.infer<typeof TaxRatesSchema>;
```

- [ ] **Step 4: Create the CA-QC sample fixture**

```yaml
# data/tax-rates/ca-qc-2026.yaml
# Numerical values are placeholders to be confirmed by a Quebec payroll
# professional or against current CRA / Revenu Québec publications before
# any production split is computed.
jurisdiction: CA-QC
year: 2026
effective_from: 2026-01-01
effective_to: 2026-12-31

remittance_authorities:
  - { code: CRA, name: "Receiver General of Canada", level: federal }
  - { code: RQ,  name: "Revenu Québec",              level: regional }

payroll_taxes:
  - { code: CIT,    name: "Federal income tax",        remits_to: CRA, type: withheld }
  - { code: PIT,    name: "Quebec income tax",         remits_to: RQ,  type: withheld }
  - { code: QPP,    name: "Quebec Pension Plan",       remits_to: RQ,  type: both,
      employer_rate: 0.064, employee_rate: 0.064, pensionable_max: 71300, basic_exemption: 3500 }
  - { code: EI,     name: "Employment Insurance",      remits_to: CRA, type: both,
      employee_rate: 0.0166, employer_factor: 1.4, insurable_max: 65700 }
  - { code: QPIP,   name: "Quebec Parental Insurance", remits_to: RQ,  type: both,
      employer_rate: 0.00692, employee_rate: 0.00494, insurable_max: 98000 }
  - { code: FSS,    name: "Health Services Fund (QC)", remits_to: RQ,  type: employer_only }
  - { code: CNESST, name: "CNESST",                    remits_to: RQ,  type: employer_only }

sales_taxes:
  - { code: GST, name: "GST", rate: 0.05,    remits_to: CRA }
  - { code: QST, name: "QST", rate: 0.09975, remits_to: RQ }
```

- [ ] **Step 5: Verify pass**

```bash
npm run test -- tests/unit/domain/tax/schema.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add src/domain/tax/schema.ts tests/unit/domain/tax/schema.test.ts data/tax-rates/ca-qc-2026.yaml
git commit -m "feat(domain): tax rates schema and CA-QC 2026 sample"
```

---

### Task A12: Tax rates loader

**Files:**
- Create: `src/domain/tax/rates-loader.ts`
- Create: `tests/unit/domain/tax/rates-loader.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/domain/tax/rates-loader.test.ts
import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TaxRatesLoader } from "../../../../src/domain/tax/rates-loader.js";
import { ToolError } from "../../../../src/lib/errors.js";

function fixtureDir(content: string, name = "ca-qc-2026.yaml"): string {
  const dir = mkdtempSync(join(tmpdir(), "tax-rates-"));
  writeFileSync(join(dir, name), content);
  return dir;
}

const VALID = `
jurisdiction: CA-QC
year: 2026
effective_from: 2026-01-01
effective_to: 2026-12-31
remittance_authorities:
  - { code: CRA, name: "X", level: federal }
payroll_taxes: []
sales_taxes: []
`;

describe("TaxRatesLoader", () => {
  it("loads a valid file by jurisdiction+year", async () => {
    const loader = new TaxRatesLoader(fixtureDir(VALID));
    const r = await loader.load("CA-QC", 2026);
    expect(r.jurisdiction).toBe("CA-QC");
  });

  it("throws TAX_RATES_NOT_FOUND when file is missing", async () => {
    const loader = new TaxRatesLoader(fixtureDir(VALID));
    await expect(loader.load("US-CA", 2026)).rejects.toMatchObject({ code: "TAX_RATES_NOT_FOUND" });
  });

  it("throws TAX_RATES_INVALID on schema violations", async () => {
    const loader = new TaxRatesLoader(fixtureDir("jurisdiction: CA-QC\n"));
    await expect(loader.load("CA-QC", 2026)).rejects.toBeInstanceOf(ToolError);
  });

  it("loadForDate finds the table whose period covers the given date", async () => {
    const loader = new TaxRatesLoader(fixtureDir(VALID));
    const r = await loader.loadForDate("CA-QC", "2026-06-15");
    expect(r.year).toBe(2026);
  });
});
```

- [ ] **Step 2: Verify failure**

```bash
npm run test -- tests/unit/domain/tax/rates-loader.test.ts
```

- [ ] **Step 3: Implement**

```ts
// src/domain/tax/rates-loader.ts
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { ToolError } from "../../lib/errors.js";
import { type TaxRates, TaxRatesSchema } from "./schema.js";

export class TaxRatesLoader {
  private cache = new Map<string, TaxRates>();

  constructor(private readonly dir: string) {}

  async load(jurisdiction: string, year: number): Promise<TaxRates> {
    const key = `${jurisdiction.toLowerCase()}-${year}`;
    const cached = this.cache.get(key);
    if (cached) return cached;
    const file = join(this.dir, `${key}.yaml`);
    let raw: string;
    try {
      raw = await readFile(file, "utf8");
    } catch (e) {
      throw new ToolError(
        "TAX_RATES_NOT_FOUND",
        { jurisdiction, year, file },
        "Add the YAML table for this jurisdiction/year to data/tax-rates/",
      );
    }
    const parsed = TaxRatesSchema.safeParse(parseYaml(raw));
    if (!parsed.success) {
      throw new ToolError(
        "TAX_RATES_INVALID",
        { jurisdiction, year, issues: parsed.error.issues },
        "Fix the YAML to match the schema in src/domain/tax/schema.ts",
      );
    }
    this.cache.set(key, parsed.data);
    return parsed.data;
  }

  async loadForDate(jurisdiction: string, isoDate: string): Promise<TaxRates> {
    const files = await readdir(this.dir).catch(() => []);
    const candidates = files.filter((f) =>
      f.toLowerCase().startsWith(`${jurisdiction.toLowerCase()}-`),
    );
    for (const f of candidates) {
      const m = f.match(/^.+-(\d{4})\.yaml$/);
      if (!m?.[1]) continue;
      const year = Number(m[1]);
      const table = await this.load(jurisdiction, year).catch(() => null);
      if (table && isoDate >= table.effective_from && isoDate <= table.effective_to) {
        return table;
      }
    }
    throw new ToolError(
      "TAX_RATES_NOT_FOUND",
      { jurisdiction, date: isoDate },
      "No tax rates table covers this date for this jurisdiction.",
    );
  }
}
```

- [ ] **Step 4: Verify pass**

```bash
npm run test -- tests/unit/domain/tax/rates-loader.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/domain/tax/rates-loader.ts tests/unit/domain/tax/rates-loader.test.ts
git commit -m "feat(domain): tax rates loader with date-based selection"
```

---

### Task A13: Client profiles schema

**Files:**
- Create: `src/domain/client-profiles/schema.ts`
- Create: `tests/unit/domain/client-profiles/schema.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/domain/client-profiles/schema.test.ts
import { describe, expect, it } from "vitest";
import { ClientProfileSchema } from "../../../../src/domain/client-profiles/schema.js";

const valid = {
  alias: "acme",
  unit: "hours",
  hourly_rate: 95,
  currency: "CAD",
  send_to: ["billing@example.com"],
};

describe("ClientProfileSchema", () => {
  it("accepts a minimal valid profile and applies defaults", () => {
    const r = ClientProfileSchema.safeParse(valid);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.payment_terms_days).toBe(30);
      expect(r.data.language).toBe("en");
      expect(r.data.cc).toEqual([]);
      expect(r.data.default_taxes).toEqual([]);
    }
  });

  it("rejects an alias with uppercase letters", () => {
    const r = ClientProfileSchema.safeParse({ ...valid, alias: "Acme" });
    expect(r.success).toBe(false);
  });

  it("rejects an invalid email in send_to", () => {
    const r = ClientProfileSchema.safeParse({ ...valid, send_to: ["not-an-email"] });
    expect(r.success).toBe(false);
  });

  it("rejects a 4-letter currency", () => {
    const r = ClientProfileSchema.safeParse({ ...valid, currency: "CADX" });
    expect(r.success).toBe(false);
  });

  it("rejects empty send_to", () => {
    const r = ClientProfileSchema.safeParse({ ...valid, send_to: [] });
    expect(r.success).toBe(false);
  });
});
```

- [ ] **Step 2: Verify failure**

```bash
npm run test -- tests/unit/domain/client-profiles/schema.test.ts
```

- [ ] **Step 3: Implement**

```ts
// src/domain/client-profiles/schema.ts
import { z } from "zod";

export const ClientProfileSchema = z.object({
  alias: z.string().regex(/^[a-z0-9-]+$/, "alias must be [a-z0-9-]+"),
  unit: z.enum(["hours", "days", "fixed"]).default("hours"),
  hourly_rate: z.number().positive().optional(),
  currency: z.string().length(3),
  default_product_id: z.string().optional(),
  default_description: z.string().optional(),
  send_to: z.array(z.string().email()).min(1),
  cc: z.array(z.string().email()).default([]),
  payment_terms_days: z.number().int().min(0).default(30),
  language: z.enum(["en", "fr"]).default("en"),
  default_taxes: z.array(z.string()).default([]),
  invoice_notes: z.string().optional(),
});

export type ClientProfile = z.infer<typeof ClientProfileSchema>;
```

- [ ] **Step 4: Verify pass**

```bash
npm run test -- tests/unit/domain/client-profiles/schema.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/domain/client-profiles/schema.ts tests/unit/domain/client-profiles/schema.test.ts
git commit -m "feat(domain): client profile schema"
```

---

### Task A14: Client profile parser (parse-from-notes)

**Files:**
- Create: `src/domain/client-profiles/parse-from-notes.ts`
- Create: `tests/unit/domain/client-profiles/parse-from-notes.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/domain/client-profiles/parse-from-notes.test.ts
import { describe, expect, it } from "vitest";
import { parseProfileFromNotes } from "../../../../src/domain/client-profiles/parse-from-notes.js";

describe("parseProfileFromNotes", () => {
  it("returns null when no marker is present", () => {
    expect(parseProfileFromNotes("just free notes")).toEqual({ kind: "absent" });
  });

  it("extracts a valid profile between markers and ignores surrounding text", () => {
    const notes = `Marc is the contact.

---mcp-wave---
alias: acme
unit: hours
hourly_rate: 95
currency: CAD
send_to:
  - billing@example.com
---mcp-wave---

trailing trivia`;
    const r = parseProfileFromNotes(notes);
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") {
      expect(r.profile.alias).toBe("acme");
      expect(r.profile.hourly_rate).toBe(95);
      expect(r.profile.currency).toBe("CAD");
      expect(r.profile.send_to).toEqual(["billing@example.com"]);
    }
  });

  it("returns parse_error with Zod issues on schema violations", () => {
    const notes = `---mcp-wave---
alias: ACME
currency: CAD
send_to:
  - billing@example.com
---mcp-wave---`;
    const r = parseProfileFromNotes(notes);
    expect(r.kind).toBe("parse_error");
    if (r.kind === "parse_error") {
      expect(r.issues.length).toBeGreaterThan(0);
    }
  });

  it("returns parse_error on invalid YAML", () => {
    const notes = `---mcp-wave---
not: { valid: yaml: at all
---mcp-wave---`;
    const r = parseProfileFromNotes(notes);
    expect(r.kind).toBe("parse_error");
  });

  it("treats null/undefined notes as absent", () => {
    expect(parseProfileFromNotes(null).kind).toBe("absent");
    expect(parseProfileFromNotes(undefined).kind).toBe("absent");
  });

  it("ignores text inside the block boundaries that is not a single YAML doc", () => {
    const notes = `---mcp-wave---
---mcp-wave---`;
    const r = parseProfileFromNotes(notes);
    expect(r.kind).toBe("parse_error");
  });
});
```

- [ ] **Step 2: Verify failure**

```bash
npm run test -- tests/unit/domain/client-profiles/parse-from-notes.test.ts
```

- [ ] **Step 3: Implement**

```ts
// src/domain/client-profiles/parse-from-notes.ts
import { parse as parseYaml } from "yaml";
import { ClientProfileSchema, type ClientProfile } from "./schema.js";

const MARKER_RE = /---mcp-wave---\s*\n([\s\S]*?)\n---mcp-wave---/;

export type ParseResult =
  | { kind: "absent" }
  | { kind: "ok"; profile: ClientProfile }
  | { kind: "parse_error"; issues: Array<{ path: string; message: string }> };

export function parseProfileFromNotes(notes: string | null | undefined): ParseResult {
  if (!notes) return { kind: "absent" };
  const m = notes.match(MARKER_RE);
  if (!m?.[1]) return { kind: "absent" };

  let raw: unknown;
  try {
    raw = parseYaml(m[1]);
  } catch (e) {
    return {
      kind: "parse_error",
      issues: [{ path: "<yaml>", message: e instanceof Error ? e.message : String(e) }],
    };
  }

  if (raw === null || typeof raw !== "object") {
    return { kind: "parse_error", issues: [{ path: "<yaml>", message: "expected a YAML mapping" }] };
  }

  const parsed = ClientProfileSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      kind: "parse_error",
      issues: parsed.error.issues.map((i) => ({
        path: i.path.join("."),
        message: i.message,
      })),
    };
  }
  return { kind: "ok", profile: parsed.data };
}
```

- [ ] **Step 4: Verify pass**

```bash
npm run test -- tests/unit/domain/client-profiles/parse-from-notes.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/domain/client-profiles/parse-from-notes.ts tests/unit/domain/client-profiles/parse-from-notes.test.ts
git commit -m "feat(domain): parseProfileFromNotes with structured errors"
```

---

### Task A15: Invoice totals computation

**Files:**
- Create: `src/domain/invoice-templating/compute-totals.ts`
- Create: `tests/unit/domain/invoice-templating/compute-totals.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/domain/invoice-templating/compute-totals.test.ts
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { computeInvoiceTotals } from "../../../../src/domain/invoice-templating/compute-totals.js";

describe("computeInvoiceTotals", () => {
  it("single line, no tax", () => {
    const r = computeInvoiceTotals({
      lines: [{ quantity: 10, unit_price: 100, tax_codes: [] }],
      taxes: [],
      currency: "CAD",
    });
    expect(r.subtotal).toBe(1000);
    expect(r.taxes_breakdown).toEqual([]);
    expect(r.total).toBe(1000);
  });

  it("single line with GST + QST", () => {
    const r = computeInvoiceTotals({
      lines: [{ quantity: 10, unit_price: 100, tax_codes: ["GST", "QST"] }],
      taxes: [
        { code: "GST", rate: 0.05 },
        { code: "QST", rate: 0.09975 },
      ],
      currency: "CAD",
    });
    expect(r.subtotal).toBe(1000);
    expect(r.taxes_breakdown).toEqual([
      { code: "GST", amount: 50 },
      { code: "QST", amount: 99.75 },
    ]);
    expect(r.total).toBeCloseTo(1149.75, 2);
  });

  it("multiple lines", () => {
    const r = computeInvoiceTotals({
      lines: [
        { quantity: 23, unit_price: 95, tax_codes: ["GST", "QST"] },
        { quantity: 1, unit_price: 100, tax_codes: ["GST", "QST"] },
      ],
      taxes: [
        { code: "GST", rate: 0.05 },
        { code: "QST", rate: 0.09975 },
      ],
      currency: "CAD",
    });
    expect(r.subtotal).toBe(2285);
    expect(r.total).toBeCloseTo(2285 * 1.14975, 2);
  });

  it("rounds tax amounts to 2 decimals (banker-style not required)", () => {
    const r = computeInvoiceTotals({
      lines: [{ quantity: 1, unit_price: 33.33, tax_codes: ["X"] }],
      taxes: [{ code: "X", rate: 0.13 }],
      currency: "USD",
    });
    expect(r.taxes_breakdown[0]?.amount).toBeCloseTo(4.33, 2);
  });

  it("property: total >= subtotal when all rates >= 0", () => {
    fc.assert(
      fc.property(
        fc.array(fc.record({
          quantity: fc.integer({ min: 1, max: 100 }),
          unit_price: fc.double({ min: 0.01, max: 10000, noNaN: true }),
        }), { minLength: 1, maxLength: 5 }),
        fc.double({ min: 0, max: 0.5, noNaN: true }),
        (lines, rate) => {
          const r = computeInvoiceTotals({
            lines: lines.map((l) => ({ ...l, tax_codes: ["X"] })),
            taxes: [{ code: "X", rate }],
            currency: "USD",
          });
          expect(r.total).toBeGreaterThanOrEqual(r.subtotal - 0.01);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("rejects negative quantity or price", () => {
    expect(() =>
      computeInvoiceTotals({
        lines: [{ quantity: -1, unit_price: 10, tax_codes: [] }],
        taxes: [],
        currency: "USD",
      }),
    ).toThrow();
  });
});
```

- [ ] **Step 2: Verify failure**

```bash
npm run test -- tests/unit/domain/invoice-templating/compute-totals.test.ts
```

- [ ] **Step 3: Implement**

```ts
// src/domain/invoice-templating/compute-totals.ts
import { ToolError } from "../../lib/errors.js";

export interface Line {
  quantity: number;
  unit_price: number;
  tax_codes: string[];
}
export interface TaxRef {
  code: string;
  rate: number;
}
export interface InvoiceTotalsInput {
  lines: Line[];
  taxes: TaxRef[];
  currency: string;
}
export interface InvoiceTotals {
  subtotal: number;
  taxes_breakdown: Array<{ code: string; amount: number }>;
  total: number;
  currency: string;
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function computeInvoiceTotals(input: InvoiceTotalsInput): InvoiceTotals {
  for (const [i, l] of input.lines.entries()) {
    if (l.quantity < 0) throw new ToolError("INVALID_LINE", { index: i, reason: "negative quantity" });
    if (l.unit_price < 0) throw new ToolError("INVALID_LINE", { index: i, reason: "negative unit_price" });
  }
  const rateOf = new Map(input.taxes.map((t) => [t.code, t.rate] as const));
  const subtotal = round2(
    input.lines.reduce((acc, l) => acc + l.quantity * l.unit_price, 0),
  );
  const breakdown = new Map<string, number>();
  for (const l of input.lines) {
    const lineSub = l.quantity * l.unit_price;
    for (const code of l.tax_codes) {
      const rate = rateOf.get(code);
      if (rate === undefined) {
        throw new ToolError("TAX_CODE_NOT_RESOLVED", { code, available: [...rateOf.keys()] });
      }
      breakdown.set(code, (breakdown.get(code) ?? 0) + lineSub * rate);
    }
  }
  const taxes_breakdown = [...breakdown.entries()].map(([code, amount]) => ({
    code,
    amount: round2(amount),
  }));
  const taxesSum = taxes_breakdown.reduce((a, t) => a + t.amount, 0);
  return {
    subtotal,
    taxes_breakdown,
    total: round2(subtotal + taxesSum),
    currency: input.currency,
  };
}
```

- [ ] **Step 4: Verify pass**

```bash
npm run test -- tests/unit/domain/invoice-templating/compute-totals.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/domain/invoice-templating/compute-totals.ts tests/unit/domain/invoice-templating/compute-totals.test.ts
git commit -m "feat(domain): computeInvoiceTotals with property-based tests"
```

---

### Task A16: Invoice line rendering from profile

**Files:**
- Create: `src/domain/invoice-templating/render-lines.ts`
- Create: `tests/unit/domain/invoice-templating/render-lines.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/domain/invoice-templating/render-lines.test.ts
import { describe, expect, it } from "vitest";
import { renderLines } from "../../../../src/domain/invoice-templating/render-lines.js";
import type { ClientProfile } from "../../../../src/domain/client-profiles/schema.js";

const baseProfile: ClientProfile = {
  alias: "acme",
  unit: "hours",
  hourly_rate: 95,
  currency: "CAD",
  default_product_id: "prod_x",
  default_description: "Consulting — development hours",
  send_to: ["billing@example.com"],
  cc: [],
  payment_terms_days: 30,
  language: "en",
  default_taxes: ["GST", "QST"],
};

describe("renderLines", () => {
  it("renders a single line from profile defaults", () => {
    const lines = renderLines({ profile: baseProfile, quantity: 23 });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      quantity: 23,
      unit_price: 95,
      product_id: "prod_x",
      tax_codes: ["GST", "QST"],
    });
    expect(lines[0]?.description).toContain("Consulting — development hours");
  });

  it("appends period_label to the description when provided", () => {
    const lines = renderLines({ profile: baseProfile, quantity: 10, period_label: "November 2026" });
    expect(lines[0]?.description).toContain("November 2026");
  });

  it("override_unit_price wins over profile hourly_rate", () => {
    const lines = renderLines({ profile: baseProfile, quantity: 10, override_unit_price: 120 });
    expect(lines[0]?.unit_price).toBe(120);
  });

  it("throws MISSING_RATE when neither profile rate nor override is set", () => {
    const profile = { ...baseProfile, hourly_rate: undefined } as ClientProfile;
    expect(() => renderLines({ profile, quantity: 10 })).toThrow(/MISSING_RATE/);
  });
});
```

- [ ] **Step 2: Verify failure**

```bash
npm run test -- tests/unit/domain/invoice-templating/render-lines.test.ts
```

- [ ] **Step 3: Implement**

```ts
// src/domain/invoice-templating/render-lines.ts
import type { ClientProfile } from "../client-profiles/schema.js";
import { ToolError } from "../../lib/errors.js";

export interface RenderedLine {
  description: string;
  quantity: number;
  unit_price: number;
  product_id?: string;
  tax_codes: string[];
}

export interface RenderLinesInput {
  profile: ClientProfile;
  quantity: number;
  period_label?: string;
  override_unit_price?: number;
}

export function renderLines(input: RenderLinesInput): RenderedLine[] {
  const unit_price = input.override_unit_price ?? input.profile.hourly_rate;
  if (unit_price === undefined) {
    throw new ToolError(
      "MISSING_RATE",
      { alias: input.profile.alias },
      "Set hourly_rate in the client profile or pass override_unit_price.",
    );
  }
  const baseDesc = input.profile.default_description ?? `${input.profile.alias} services`;
  const description = input.period_label ? `${baseDesc} — ${input.period_label}` : baseDesc;
  const line: RenderedLine = {
    description,
    quantity: input.quantity,
    unit_price,
    tax_codes: [...input.profile.default_taxes],
  };
  if (input.profile.default_product_id !== undefined) {
    line.product_id = input.profile.default_product_id;
  }
  return [line];
}
```

- [ ] **Step 4: Verify pass**

```bash
npm run test -- tests/unit/domain/invoice-templating/render-lines.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/domain/invoice-templating/render-lines.ts tests/unit/domain/invoice-templating/render-lines.test.ts
git commit -m "feat(domain): renderLines from client profile + quantity"
```

---

### Task A17: Account mapping schema and loader

**Files:**
- Create: `src/domain/tax/account-mapping-schema.ts`
- Create: `src/domain/tax/account-mapping-loader.ts`
- Create: `data/account-mapping/default.yaml.example`
- Create: `tests/unit/domain/tax/account-mapping.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/domain/tax/account-mapping.test.ts
import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AccountMappingLoader } from "../../../../src/domain/tax/account-mapping-loader.js";

function fixture(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "amap-"));
  writeFileSync(join(dir, "default.yaml"), content);
  return dir;
}

const TWO_BUCKETS = `
business_id_env: WAVE_DEFAULT_BUSINESS_ID
jurisdiction: CA-QC
remittance_buckets:
  CRA: { payable_account_id: "acct_fed" }
  RQ:  { payable_account_id: "acct_qc" }
`;

describe("AccountMappingLoader", () => {
  it("loads two-bucket mode", async () => {
    const loader = new AccountMappingLoader(fixture(TWO_BUCKETS));
    const m = await loader.load();
    expect(m.remittance_buckets.CRA?.payable_account_id).toBe("acct_fed");
    expect(m.tax_code_to_account).toBeUndefined();
  });

  it("throws ACCOUNT_MAPPING_MISSING when file absent", async () => {
    const loader = new AccountMappingLoader("/nonexistent");
    await expect(loader.load()).rejects.toMatchObject({ code: "ACCOUNT_MAPPING_MISSING" });
  });
});
```

- [ ] **Step 2: Verify failure**

```bash
npm run test -- tests/unit/domain/tax/account-mapping.test.ts
```

- [ ] **Step 3: Implement schema**

```ts
// src/domain/tax/account-mapping-schema.ts
import { z } from "zod";

const Bucket = z.object({
  payable_account_id: z.string().min(1),
});

export const AccountMappingSchema = z.object({
  business_id_env: z.string().min(1).optional(),
  jurisdiction: z.string().min(1),
  remittance_buckets: z.record(z.string(), Bucket),
  tax_code_to_account: z.record(z.string(), z.string()).optional(),
});

export type AccountMapping = z.infer<typeof AccountMappingSchema>;
```

- [ ] **Step 4: Implement loader**

```ts
// src/domain/tax/account-mapping-loader.ts
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { ToolError } from "../../lib/errors.js";
import { AccountMappingSchema, type AccountMapping } from "./account-mapping-schema.js";

export class AccountMappingLoader {
  private cache: AccountMapping | null = null;

  constructor(private readonly dir: string, private readonly file = "default.yaml") {}

  async load(): Promise<AccountMapping> {
    if (this.cache) return this.cache;
    const path = join(this.dir, this.file);
    let raw: string;
    try {
      raw = await readFile(path, "utf8");
    } catch {
      throw new ToolError(
        "ACCOUNT_MAPPING_MISSING",
        { path },
        "Run setup_account_mapping or create data/account-mapping/default.yaml.",
      );
    }
    const parsed = AccountMappingSchema.safeParse(parseYaml(raw));
    if (!parsed.success) {
      throw new ToolError(
        "ACCOUNT_MAPPING_INVALID",
        { issues: parsed.error.issues },
        "Fix the YAML to match AccountMappingSchema.",
      );
    }
    this.cache = parsed.data;
    return parsed.data;
  }
}
```

- [ ] **Step 5: Create the example file**

```yaml
# data/account-mapping/default.yaml.example
# Copy to data/account-mapping/default.yaml and fill in your Wave account_id values.
# Run setup_account_mapping (Phase B) to have the MCP suggest matches.
business_id_env: WAVE_DEFAULT_BUSINESS_ID
jurisdiction: CA-QC
remittance_buckets:
  CRA:
    payable_account_id: "REPLACE_WITH_FEDERAL_PAYABLE_ACCOUNT_ID"
  RQ:
    payable_account_id: "REPLACE_WITH_QUEBEC_PAYABLE_ACCOUNT_ID"
# tax_code_to_account:   # optional, used in v1.1 detailed mode
#   CIT: REPLACE
#   PIT: REPLACE
```

- [ ] **Step 6: Verify pass**

```bash
npm run test -- tests/unit/domain/tax/account-mapping.test.ts
```

- [ ] **Step 7: Commit**

```bash
git add src/domain/tax/account-mapping-schema.ts src/domain/tax/account-mapping-loader.ts \
        tests/unit/domain/tax/account-mapping.test.ts data/account-mapping/default.yaml.example
git commit -m "feat(domain): account mapping schema and loader"
```

---

### Phase A.3 — Wave client + auth (Tasks A18–A24)

### Task A18: WaveCredentialProvider interface

**Files:**
- Create: `src/wave/auth/provider.ts`

- [ ] **Step 1: Define the interface**

```ts
// src/wave/auth/provider.ts
export interface RequestContext {
  /** HTTP headers when transport is HTTP, null in stdio. */
  headers: Headers | null;
  /** Per-request correlation id for logs. */
  request_id: string;
}

export interface WaveCredentialProvider {
  getToken(req: RequestContext): Promise<string>;
  getIdentity(req: RequestContext): Promise<string>;
}
```

- [ ] **Step 2: Verify typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/wave/auth/provider.ts
git commit -m "feat(wave): WaveCredentialProvider interface and RequestContext"
```

---

### Task A19: EnvTokenProvider + MockProvider

**Files:**
- Create: `src/wave/auth/env-token.ts`
- Create: `src/wave/auth/mock.ts`
- Create: `tests/unit/wave/auth/providers.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/wave/auth/providers.test.ts
import { describe, expect, it } from "vitest";
import { EnvTokenProvider } from "../../../../src/wave/auth/env-token.js";
import { MockProvider } from "../../../../src/wave/auth/mock.js";

const REQ = { headers: null, request_id: "req_1" };

describe("EnvTokenProvider", () => {
  it("returns the constructor token", async () => {
    const p = new EnvTokenProvider("abc");
    expect(await p.getToken(REQ)).toBe("abc");
  });

  it("rejects empty token at construction", () => {
    expect(() => new EnvTokenProvider("")).toThrow();
  });

  it("getIdentity returns env-default", async () => {
    const p = new EnvTokenProvider("abc");
    expect(await p.getIdentity(REQ)).toBe("env-default");
  });
});

describe("MockProvider", () => {
  it("returns the fixture token", async () => {
    const p = new MockProvider("fake");
    expect(await p.getToken(REQ)).toBe("fake");
    expect(await p.getIdentity(REQ)).toBe("mock");
  });
});
```

- [ ] **Step 2: Verify failure**

```bash
npm run test -- tests/unit/wave/auth/providers.test.ts
```

- [ ] **Step 3: Implement**

```ts
// src/wave/auth/env-token.ts
import type { RequestContext, WaveCredentialProvider } from "./provider.js";

export class EnvTokenProvider implements WaveCredentialProvider {
  constructor(private readonly token: string) {
    if (!token) throw new Error("EnvTokenProvider requires a non-empty token");
  }
  async getToken(_req: RequestContext): Promise<string> {
    return this.token;
  }
  async getIdentity(_req: RequestContext): Promise<string> {
    return "env-default";
  }
}
```

```ts
// src/wave/auth/mock.ts
import type { RequestContext, WaveCredentialProvider } from "./provider.js";

export class MockProvider implements WaveCredentialProvider {
  constructor(private readonly token = "mock-token") {}
  async getToken(_req: RequestContext): Promise<string> {
    return this.token;
  }
  async getIdentity(_req: RequestContext): Promise<string> {
    return "mock";
  }
}
```

- [ ] **Step 4: Verify pass**

```bash
npm run test -- tests/unit/wave/auth/providers.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/wave/auth/env-token.ts src/wave/auth/mock.ts tests/unit/wave/auth/providers.test.ts
git commit -m "feat(wave): EnvTokenProvider and MockProvider"
```

---

### Task A20: BearerHeaderProvider

**Files:**
- Create: `src/wave/auth/bearer-passthrough.ts`
- Create: `tests/unit/wave/auth/bearer-passthrough.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/wave/auth/bearer-passthrough.test.ts
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

  it("throws AUTH_BEARER_MISSING when header absent", async () => {
    const p = new BearerHeaderProvider();
    await expect(p.getToken(ctx())).rejects.toMatchObject({ code: "AUTH_BEARER_MISSING" });
  });

  it("throws when scheme is not Bearer", async () => {
    const p = new BearerHeaderProvider();
    await expect(p.getToken(ctx("Basic abc"))).rejects.toMatchObject({ code: "AUTH_BEARER_MISSING" });
  });

  it("getIdentity returns a hashed prefix, never the token", async () => {
    const p = new BearerHeaderProvider();
    const id = await p.getIdentity(ctx("Bearer secret"));
    expect(id.startsWith("bearer:")).toBe(true);
    expect(id).not.toContain("secret");
  });

  it("rejects when context has null headers (stdio)", async () => {
    const p = new BearerHeaderProvider();
    await expect(p.getToken({ headers: null, request_id: "x" })).rejects.toMatchObject({
      code: "AUTH_BEARER_MISSING",
    });
  });
});
```

- [ ] **Step 2: Verify failure**

```bash
npm run test -- tests/unit/wave/auth/bearer-passthrough.test.ts
```

- [ ] **Step 3: Implement**

```ts
// src/wave/auth/bearer-passthrough.ts
import { createHash } from "node:crypto";
import { ToolError } from "../../lib/errors.js";
import type { RequestContext, WaveCredentialProvider } from "./provider.js";

const BEARER_RE = /^bearer\s+(.+)$/i;

export class BearerHeaderProvider implements WaveCredentialProvider {
  async getToken(req: RequestContext): Promise<string> {
    const value = req.headers?.get("authorization");
    const match = value?.match(BEARER_RE);
    if (!match?.[1]) {
      throw new ToolError(
        "AUTH_BEARER_MISSING",
        {},
        "Pass the Wave token as 'Authorization: Bearer <token>' header.",
      );
    }
    return match[1].trim();
  }

  async getIdentity(req: RequestContext): Promise<string> {
    const token = await this.getToken(req);
    const hash = createHash("sha256").update(token).digest("hex").slice(0, 12);
    return `bearer:${hash}`;
  }
}
```

- [ ] **Step 4: Verify pass**

```bash
npm run test -- tests/unit/wave/auth/bearer-passthrough.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/wave/auth/bearer-passthrough.ts tests/unit/wave/auth/bearer-passthrough.test.ts
git commit -m "feat(wave): BearerHeaderProvider with hashed identity"
```

---

### Task A21: Provider selection factory

**Files:**
- Create: `src/wave/auth/select.ts`
- Create: `tests/unit/wave/auth/select.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/wave/auth/select.test.ts
import { describe, expect, it } from "vitest";
import { selectProvider } from "../../../../src/wave/auth/select.js";
import { EnvTokenProvider } from "../../../../src/wave/auth/env-token.js";
import { BearerHeaderProvider } from "../../../../src/wave/auth/bearer-passthrough.js";
import { MockProvider } from "../../../../src/wave/auth/mock.js";

const baseEnv = {
  WAVE_DEFAULT_BUSINESS_ID: "biz_x",
  WAVE_GRAPHQL_ENDPOINT: "https://x",
  LOG_LEVEL: "info" as const,
  LOG_PII: false,
  NODE_ENV: "test" as const,
  ALLOWED_ORIGINS: "*",
  RATE_LIMIT_RPM: 60,
};

describe("selectProvider", () => {
  it("returns EnvTokenProvider for env_token mode", () => {
    const p = selectProvider({ ...baseEnv, WAVE_AUTH_MODE: "env_token", WAVE_API_TOKEN: "x" });
    expect(p).toBeInstanceOf(EnvTokenProvider);
  });

  it("returns BearerHeaderProvider for bearer_passthrough mode", () => {
    const p = selectProvider({ ...baseEnv, WAVE_AUTH_MODE: "bearer_passthrough" });
    expect(p).toBeInstanceOf(BearerHeaderProvider);
  });

  it("returns MockProvider for mock mode", () => {
    const p = selectProvider({ ...baseEnv, WAVE_AUTH_MODE: "mock", WAVE_API_TOKEN: "fake" });
    expect(p).toBeInstanceOf(MockProvider);
  });
});
```

- [ ] **Step 2: Verify failure**

```bash
npm run test -- tests/unit/wave/auth/select.test.ts
```

- [ ] **Step 3: Implement**

```ts
// src/wave/auth/select.ts
import type { AppEnv } from "../../config/env.js";
import { EnvTokenProvider } from "./env-token.js";
import { BearerHeaderProvider } from "./bearer-passthrough.js";
import { MockProvider } from "./mock.js";
import type { WaveCredentialProvider } from "./provider.js";

export function selectProvider(env: AppEnv): WaveCredentialProvider {
  switch (env.WAVE_AUTH_MODE) {
    case "env_token":
      if (!env.WAVE_API_TOKEN) {
        throw new Error("WAVE_API_TOKEN required for env_token mode (parseEnv should have caught this)");
      }
      return new EnvTokenProvider(env.WAVE_API_TOKEN);
    case "bearer_passthrough":
      return new BearerHeaderProvider();
    case "mock":
      return new MockProvider(env.WAVE_API_TOKEN ?? "mock-token");
  }
}
```

- [ ] **Step 4: Verify pass**

```bash
npm run test -- tests/unit/wave/auth/select.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/wave/auth/select.ts tests/unit/wave/auth/select.test.ts
git commit -m "feat(wave): selectProvider factory"
```

---

### Task A22: Wave error mapper

**Files:**
- Create: `src/wave/errors.ts`
- Create: `tests/unit/wave/errors.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/wave/errors.test.ts
import { describe, expect, it } from "vitest";
import { mapWaveGraphQLError } from "../../../src/wave/errors.js";
import { WaveApiError } from "../../../src/lib/errors.js";

describe("mapWaveGraphQLError", () => {
  it.each([
    ["AUTHENTICATION_ERROR", 401],
    ["AUTHORIZATION_ERROR", 403],
    ["NOT_FOUND", 404],
    ["VALIDATION_ERROR", 400],
    ["RATE_LIMITED", 429],
    ["INTERNAL_SERVER_ERROR", 500],
  ])("maps %s to status %d", (code, expected) => {
    const err = mapWaveGraphQLError({ extensions: { code }, message: "x" });
    expect(err).toBeInstanceOf(WaveApiError);
    expect(err.httpStatus).toBe(expected);
    expect(err.code).toBe(`WAVE_${code}`);
  });

  it("falls back to UNKNOWN with status 500", () => {
    const err = mapWaveGraphQLError({ message: "weird" });
    expect(err.waveCode).toBe("UNKNOWN");
    expect(err.httpStatus).toBe(500);
  });
});
```

- [ ] **Step 2: Verify failure**

```bash
npm run test -- tests/unit/wave/errors.test.ts
```

- [ ] **Step 3: Implement**

```ts
// src/wave/errors.ts
import { WaveApiError } from "../lib/errors.js";

const STATUS_BY_CODE: Record<string, number> = {
  AUTHENTICATION_ERROR: 401,
  AUTHORIZATION_ERROR: 403,
  NOT_FOUND: 404,
  VALIDATION_ERROR: 400,
  RATE_LIMITED: 429,
  INTERNAL_SERVER_ERROR: 500,
};

interface WaveGqlError {
  message?: string;
  extensions?: { code?: string };
}

export function mapWaveGraphQLError(e: WaveGqlError | undefined | null): WaveApiError {
  const code = e?.extensions?.code ?? "UNKNOWN";
  const status = STATUS_BY_CODE[code] ?? 500;
  return new WaveApiError(code, status, e ?? null);
}
```

- [ ] **Step 4: Verify pass**

```bash
npm run test -- tests/unit/wave/errors.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/wave/errors.ts tests/unit/wave/errors.test.ts
git commit -m "feat(wave): mapWaveGraphQLError"
```

---

### Task A23: Codegen config + first GraphQL operation files

**Files:**
- Create: `codegen.yml`
- Create: `src/wave/operations/businesses.gql`
- Create: `src/wave/operations/customers.gql`
- Create: `data/wave-schema.graphql` (placeholder; will be regenerated)
- Modify: `package.json` to add `codegen:introspect` script
- Modify: `.gitignore` already excludes `src/wave/generated/sdk.ts`

> **Context:** Wave's GraphQL introspection may or may not be enabled. We cover both cases: a `codegen:introspect` script saves the schema to `data/wave-schema.graphql` from the live API, and `codegen` reads from that local file. Engineers without API access can still typecheck the codebase by committing a stale schema or by running codegen against a hand-curated subset.

- [ ] **Step 1: Create the operations directory placeholders**

```graphql
# src/wave/operations/businesses.gql
query ListBusinesses($pageSize: Int = 20, $page: Int = 1) {
  businesses(pageSize: $pageSize, page: $page) {
    pageInfo { currentPage totalPages totalCount }
    edges {
      node {
        id
        name
        currency { code }
        timezone
      }
    }
  }
}
```

```graphql
# src/wave/operations/customers.gql
query ListCustomers($businessId: ID!, $pageSize: Int = 50, $page: Int = 1) {
  business(id: $businessId) {
    customers(pageSize: $pageSize, page: $page) {
      pageInfo { currentPage totalPages totalCount }
      edges {
        node {
          id
          name
          email
          internalNotes
          currency { code }
        }
      }
    }
  }
}

query GetCustomer($businessId: ID!, $customerId: ID!) {
  business(id: $businessId) {
    customer(id: $customerId) {
      id
      name
      email
      internalNotes
      currency { code }
    }
  }
}
```

- [ ] **Step 2: Create `codegen.yml`**

```yaml
overwrite: true
schema: data/wave-schema.graphql
documents:
  - "src/wave/operations/**/*.gql"
generates:
  src/wave/generated/sdk.ts:
    plugins:
      - typescript
      - typescript-operations
      - typescript-graphql-request
    config:
      avoidOptionals: false
      enumsAsTypes: true
      skipTypename: true
      scalars:
        ID: string
        Date: string
        DateTime: string
        Decimal: string
        JSON: unknown
```

- [ ] **Step 3: Add `codegen:introspect` script**

Edit `package.json`, add inside `"scripts"`:

```json
    "codegen:introspect": "graphql-codegen --config codegen.introspect.yml"
```

- [ ] **Step 4: Create `codegen.introspect.yml`**

```yaml
schema:
  - https://gql.waveapps.com/graphql/public:
      headers:
        Authorization: "Bearer ${WAVE_API_TOKEN}"
generates:
  data/wave-schema.graphql:
    plugins:
      - schema-ast
```

> **Note:** when API access is confirmed (Task #1 in our task list), run `npm run codegen:introspect` once and commit `data/wave-schema.graphql`. Until then, `codegen` will fail with a missing schema — Tasks A24+ document a hand-stub workaround.

- [ ] **Step 5: Stub the schema file (works until introspection is run)**

```graphql
# data/wave-schema.graphql
# REPLACE WITH OUTPUT FROM `npm run codegen:introspect` ONCE WAVE_API_TOKEN IS SET.
# Hand-stubbed scalars and minimum types so codegen can run during early phases.
scalar Date
scalar DateTime
scalar Decimal
scalar JSON

type PageInfo {
  currentPage: Int!
  totalPages: Int!
  totalCount: Int!
}

type Currency { code: String! }

type Business {
  id: ID!
  name: String!
  currency: Currency!
  timezone: String
  customers(pageSize: Int, page: Int): CustomerConnection!
  customer(id: ID!): Customer
}

type BusinessEdge { node: Business! }
type BusinessConnection { pageInfo: PageInfo! edges: [BusinessEdge!]! }

type Customer {
  id: ID!
  name: String!
  email: String
  internalNotes: String
  currency: Currency!
}
type CustomerEdge { node: Customer! }
type CustomerConnection { pageInfo: PageInfo! edges: [CustomerEdge!]! }

type Query {
  businesses(pageSize: Int, page: Int): BusinessConnection!
  business(id: ID!): Business
}
```

- [ ] **Step 6: Add `@graphql-codegen/schema-ast` dependency**

Edit `package.json` `devDependencies` section:

```json
    "@graphql-codegen/schema-ast": "^4.1.0",
```

Then:

```bash
npm install
```

- [ ] **Step 7: Run codegen**

```bash
npm run codegen
```

Expected: `src/wave/generated/sdk.ts` is created with `getSdk()` exporting `listBusinesses`, `listCustomers`, `getCustomer`.

- [ ] **Step 8: Verify the SDK compiles**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json codegen.yml codegen.introspect.yml \
        src/wave/operations/ data/wave-schema.graphql src/wave/generated/.gitkeep
# Note: src/wave/generated/sdk.ts is gitignored; regenerated locally.
git commit -m "feat(wave): codegen config + bootstrapped schema and first operations"
```

---

### Task A24: WaveClient (graphql-request wrapper with retry/timeout)

**Files:**
- Create: `src/wave/client.ts`
- Create: `tests/integration/wave/client.test.ts`

- [ ] **Step 1: Write the failing integration test (uses msw)**

```ts
// tests/integration/wave/client.test.ts
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { setupServer } from "msw/node";
import { graphql, HttpResponse } from "msw";
import { WaveClient } from "../../../src/wave/client.js";
import { MockProvider } from "../../../src/wave/auth/mock.js";

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
          data: { businesses: { pageInfo: { currentPage: 1, totalPages: 1, totalCount: 0 }, edges: [] } },
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
            { errors: [{ extensions: { code: "INTERNAL_SERVER_ERROR" }, message: "x" }] },
            { status: 500 },
          );
        }
        return HttpResponse.json({
          data: { businesses: { pageInfo: { currentPage: 1, totalPages: 1, totalCount: 0 }, edges: [] } },
        });
      }),
    );
    const client = new WaveClient({
      endpoint: ENDPOINT,
      provider: new MockProvider("x"),
      retry: { retries: 2, minTimeout: 1, maxTimeout: 5 },
    });
    const r = await client.listBusinesses(REQ, { pageSize: 1, page: 1 });
    expect(r.businesses.pageInfo.totalCount).toBe(0);
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
});
```

- [ ] **Step 2: Verify failure**

```bash
npm run test -- tests/integration/wave/client.test.ts
```

- [ ] **Step 3: Implement**

```ts
// src/wave/client.ts
import { GraphQLClient, ClientError } from "graphql-request";
import { getSdk, type Sdk } from "./generated/sdk.js";
import { mapWaveGraphQLError } from "./errors.js";
import { withRetry } from "../lib/retry.js";
import type { RequestContext, WaveCredentialProvider } from "./auth/provider.js";
import { ToolError } from "../lib/errors.js";

export interface WaveClientOptions {
  endpoint: string;
  provider: WaveCredentialProvider;
  timeoutMs?: number;
  retry?: { retries?: number; minTimeout?: number; maxTimeout?: number };
}

type SdkMethod = keyof Sdk;
type SdkArgs<K extends SdkMethod> = Sdk[K] extends (vars: infer V, ...rest: unknown[]) => unknown ? V : never;
type SdkResult<K extends SdkMethod> = Sdk[K] extends (...args: never[]) => Promise<infer R> ? R : never;

export class WaveClient {
  private readonly endpoint: string;
  private readonly provider: WaveCredentialProvider;
  private readonly timeoutMs: number;
  private readonly retry: WaveClientOptions["retry"];

  constructor(opts: WaveClientOptions) {
    this.endpoint = opts.endpoint;
    this.provider = opts.provider;
    this.timeoutMs = opts.timeoutMs ?? 15_000;
    this.retry = opts.retry ?? {};
  }

  private async sdkFor(req: RequestContext): Promise<Sdk> {
    const token = await this.provider.getToken(req);
    const gql = new GraphQLClient(this.endpoint, {
      headers: { authorization: `Bearer ${token}` },
      // graphql-request supports AbortSignal via fetch
    });
    return getSdk(gql);
  }

  private async call<K extends SdkMethod>(
    req: RequestContext,
    method: K,
    vars: SdkArgs<K>,
  ): Promise<SdkResult<K>> {
    return withRetry(async () => {
      const sdk = await this.sdkFor(req);
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
      try {
        // The generated SDK methods accept (variables, requestHeaders) — we don't
        // pass per-call signal to keep the codegen surface minimal; the timeout
        // here is best-effort and primarily protects unit/integration tests.
        const fn = sdk[method] as unknown as (v: SdkArgs<K>) => Promise<SdkResult<K>>;
        return await fn(vars);
      } catch (e) {
        if (e instanceof ClientError) {
          const first = e.response.errors?.[0];
          throw mapWaveGraphQLError(first);
        }
        if (e instanceof ToolError) throw e;
        throw new ToolError("WAVE_CLIENT_ERROR", { message: String(e) });
      } finally {
        clearTimeout(timer);
      }
    }, this.retry);
  }

  // ----- typed pass-throughs (one per operation) -----

  listBusinesses(req: RequestContext, vars: SdkArgs<"ListBusinesses">) {
    return this.call(req, "ListBusinesses", vars);
  }
  listCustomers(req: RequestContext, vars: SdkArgs<"ListCustomers">) {
    return this.call(req, "ListCustomers", vars);
  }
  getCustomer(req: RequestContext, vars: SdkArgs<"GetCustomer">) {
    return this.call(req, "GetCustomer", vars);
  }
}
```

- [ ] **Step 4: Verify pass**

```bash
npm run test -- tests/integration/wave/client.test.ts
```

Expected: 3 passing.

- [ ] **Step 5: Commit**

```bash
git add src/wave/client.ts tests/integration/wave/client.test.ts
git commit -m "feat(wave): WaveClient with provider injection, retry, and timeout"
```

---

### Phase A.4 — MCP server scaffolding (Tasks A25–A28)

### Task A25: defineTool helper

**Files:**
- Create: `src/server/tool-context.ts`
- Create: `src/server/define-tool.ts`
- Create: `tests/unit/server/define-tool.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/server/define-tool.test.ts
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { defineTool } from "../../../src/server/define-tool.js";
import { MockProvider } from "../../../src/wave/auth/mock.js";
import type { ToolContext } from "../../../src/server/tool-context.js";

const ctx = (): ToolContext => ({
  req: { headers: null, request_id: "req_1" },
  wave: {} as never,
  taxRates: {} as never,
  accountMapping: {} as never,
  env: {} as never,
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never,
  identity: "mock",
});

describe("defineTool", () => {
  it("registers name, description, and inputSchema", () => {
    const t = defineTool({
      name: "do_thing",
      description: "Does a thing",
      inputSchema: z.object({ x: z.number() }),
      async execute(input) {
        return { doubled: input.x * 2 };
      },
    });
    expect(t.name).toBe("do_thing");
    expect(t.description).toBe("Does a thing");
    expect(t.inputSchema).toBeDefined();
  });

  it("invokes execute with parsed input", async () => {
    const t = defineTool({
      name: "x",
      description: "x",
      inputSchema: z.object({ n: z.number() }),
      async execute(input) {
        return { n: input.n };
      },
    });
    const r = await t.handler({ n: 21 }, ctx());
    expect(r).toEqual({ n: 21 });
  });

  it("throws on invalid input (Zod surfaces a usable error)", async () => {
    const t = defineTool({
      name: "x",
      description: "x",
      inputSchema: z.object({ n: z.number() }),
      async execute() {
        return null;
      },
    });
    await expect(t.handler({ n: "not-a-number" }, ctx())).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Verify failure**

```bash
npm run test -- tests/unit/server/define-tool.test.ts
```

- [ ] **Step 3: Implement ToolContext**

```ts
// src/server/tool-context.ts
import type { Logger } from "pino";
import type { AppEnv } from "../config/env.js";
import type { WaveClient } from "../wave/client.js";
import type { TaxRatesLoader } from "../domain/tax/rates-loader.js";
import type { AccountMappingLoader } from "../domain/tax/account-mapping-loader.js";
import type { RequestContext } from "../wave/auth/provider.js";

export interface ToolContext {
  req: RequestContext;
  wave: WaveClient;
  taxRates: TaxRatesLoader;
  accountMapping: AccountMappingLoader;
  env: AppEnv;
  logger: Logger;
  identity: string;
}
```

- [ ] **Step 4: Implement defineTool**

```ts
// src/server/define-tool.ts
import type { z } from "zod";
import type { ToolContext } from "./tool-context.js";

export interface ToolDefinition<I, O> {
  name: string;
  description: string;
  inputSchema: z.ZodType<I>;
  execute(input: I, ctx: ToolContext): Promise<O>;
}

export interface RegisteredTool {
  name: string;
  description: string;
  inputSchema: z.ZodType<unknown>;
  handler(rawInput: unknown, ctx: ToolContext): Promise<unknown>;
}

export function defineTool<I, O>(def: ToolDefinition<I, O>): RegisteredTool {
  return {
    name: def.name,
    description: def.description,
    inputSchema: def.inputSchema,
    async handler(rawInput: unknown, ctx: ToolContext): Promise<unknown> {
      const input = def.inputSchema.parse(rawInput);
      return def.execute(input, ctx);
    },
  };
}
```

- [ ] **Step 5: Verify pass**

```bash
npm run test -- tests/unit/server/define-tool.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add src/server/tool-context.ts src/server/define-tool.ts tests/unit/server/define-tool.test.ts
git commit -m "feat(server): defineTool helper and ToolContext"
```

---

### Task A26: error-bridge to MCP responses

**Files:**
- Create: `src/server/error-bridge.ts`
- Create: `tests/unit/server/error-bridge.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/server/error-bridge.test.ts
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { defineTool } from "../../../src/server/define-tool.js";
import { toMcpResult } from "../../../src/server/error-bridge.js";
import { ToolError } from "../../../src/lib/errors.js";
import type { ToolContext } from "../../../src/server/tool-context.js";

const ctx = (): ToolContext =>
  ({
    req: { headers: null, request_id: "r" },
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  }) as unknown as ToolContext;

describe("toMcpResult", () => {
  it("wraps a successful result", async () => {
    const tool = defineTool({
      name: "ok",
      description: "x",
      inputSchema: z.object({}),
      async execute() {
        return { hello: "world" };
      },
    });
    const r = await toMcpResult(tool)({}, ctx());
    expect(r.isError).toBeUndefined();
    expect(r.content[0]).toMatchObject({ type: "text" });
    expect(JSON.parse(r.content[0].text)).toEqual({ hello: "world" });
  });

  it("converts a ToolError to an isError result with code/details/hint", async () => {
    const tool = defineTool({
      name: "fail",
      description: "x",
      inputSchema: z.object({}),
      async execute() {
        throw new ToolError("X_FAILED", { why: "because" }, "do better");
      },
    });
    const r = await toMcpResult(tool)({}, ctx());
    expect(r.isError).toBe(true);
    const body = JSON.parse(r.content[0].text);
    expect(body).toEqual({ code: "X_FAILED", details: { why: "because" }, hint: "do better" });
  });

  it("converts a Zod validation error to INVALID_INPUT", async () => {
    const tool = defineTool({
      name: "v",
      description: "x",
      inputSchema: z.object({ n: z.number() }),
      async execute() {
        return null;
      },
    });
    const r = await toMcpResult(tool)({ n: "x" }, ctx());
    expect(r.isError).toBe(true);
    const body = JSON.parse(r.content[0].text);
    expect(body.code).toBe("INVALID_INPUT");
  });
});
```

- [ ] **Step 2: Verify failure**

```bash
npm run test -- tests/unit/server/error-bridge.test.ts
```

- [ ] **Step 3: Implement**

```ts
// src/server/error-bridge.ts
import { ZodError } from "zod";
import { ToolError, normalizeError } from "../lib/errors.js";
import type { RegisteredTool } from "./define-tool.js";
import type { ToolContext } from "./tool-context.js";

export interface McpToolResult {
  isError?: boolean;
  content: Array<{ type: "text"; text: string }>;
}

export function toMcpResult(
  tool: RegisteredTool,
): (input: unknown, ctx: ToolContext) => Promise<McpToolResult> {
  return async (input, ctx) => {
    try {
      const result = await tool.handler(input, ctx);
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    } catch (e) {
      let err: ToolError;
      if (e instanceof ZodError) {
        err = new ToolError(
          "INVALID_INPUT",
          { issues: e.issues.map((i) => ({ path: i.path.join("."), message: i.message })) },
          "Tool arguments did not match the schema.",
        );
      } else {
        err = normalizeError(e);
      }
      ctx.logger.warn(
        { request_id: ctx.req.request_id, tool: tool.name, code: err.code, details: err.details },
        "tool error",
      );
      return {
        isError: true,
        content: [{ type: "text", text: JSON.stringify(err.toJSON()) }],
      };
    }
  };
}
```

- [ ] **Step 4: Verify pass**

```bash
npm run test -- tests/unit/server/error-bridge.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/server/error-bridge.ts tests/unit/server/error-bridge.test.ts
git commit -m "feat(server): toMcpResult error bridge"
```

---

### Task A27: tool-registry (empty for now)

**Files:**
- Create: `src/server/tool-registry.ts`

- [ ] **Step 1: Implement**

```ts
// src/server/tool-registry.ts
import type { RegisteredTool } from "./define-tool.js";

const TOOLS: RegisteredTool[] = [
  // Read tools added in Phase A.5
  // Write tools added in Part B
  // Composites added in Part B
];

export function allTools(): RegisteredTool[] {
  return TOOLS;
}

export function registerTools(...tools: RegisteredTool[]): void {
  TOOLS.push(...tools);
}
```

- [ ] **Step 2: Verify typecheck**

```bash
npm run typecheck
```

- [ ] **Step 3: Commit**

```bash
git add src/server/tool-registry.ts
git commit -m "feat(server): empty tool registry"
```

---

### Task A28: MCP Server bootstrap

**Files:**
- Create: `src/server/mcp-server.ts`
- Create: `tests/integration/server/mcp-server.test.ts`

> **Context:** the official `@modelcontextprotocol/sdk` exposes `Server` plus per-transport classes. We register tool list/call handlers that use `toMcpResult` per tool.

- [ ] **Step 1: Write the failing integration test**

```ts
// tests/integration/server/mcp-server.test.ts
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { buildMcpServer } from "../../../src/server/mcp-server.js";
import { defineTool } from "../../../src/server/define-tool.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { ToolContext } from "../../../src/server/tool-context.js";

const ctx = (): ToolContext =>
  ({
    req: { headers: null, request_id: "r" },
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  }) as unknown as ToolContext;

const helloTool = defineTool({
  name: "hello",
  description: "Returns a greeting",
  inputSchema: z.object({ name: z.string() }),
  async execute(input) {
    return { greeting: `hello ${input.name}` };
  },
});

describe("buildMcpServer", () => {
  it("lists registered tools", async () => {
    const { server } = buildMcpServer({ tools: [helloTool], makeCtx: () => ctx() });
    const handler = (server as unknown as { _requestHandlers: Map<string, (req: unknown) => Promise<unknown>> })._requestHandlers.get(
      ListToolsRequestSchema.shape.method.value,
    );
    expect(handler).toBeDefined();
    const result = (await handler!({ method: "tools/list", params: {} })) as { tools: Array<{ name: string }> };
    expect(result.tools[0]?.name).toBe("hello");
  });

  it("calls a tool and returns its serialized result", async () => {
    const { server } = buildMcpServer({ tools: [helloTool], makeCtx: () => ctx() });
    const handler = (server as unknown as { _requestHandlers: Map<string, (req: unknown) => Promise<unknown>> })._requestHandlers.get(
      CallToolRequestSchema.shape.method.value,
    );
    const result = (await handler!({
      method: "tools/call",
      params: { name: "hello", arguments: { name: "world" } },
    })) as { content: Array<{ text: string }> };
    expect(JSON.parse(result.content[0].text)).toEqual({ greeting: "hello world" });
  });
});
```

- [ ] **Step 2: Verify failure**

```bash
npm run test -- tests/integration/server/mcp-server.test.ts
```

- [ ] **Step 3: Implement**

```ts
// src/server/mcp-server.ts
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { zodToJsonSchema } from "zod-to-json-schema";
import { toMcpResult } from "./error-bridge.js";
import type { RegisteredTool } from "./define-tool.js";
import type { ToolContext } from "./tool-context.js";
import { ToolError } from "../lib/errors.js";

export interface BuildOptions {
  tools: RegisteredTool[];
  makeCtx: () => ToolContext;
}

export function buildMcpServer(opts: BuildOptions): { server: Server } {
  const server = new Server(
    { name: "mcp-wave", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: opts.tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: zodToJsonSchema(t.inputSchema, { target: "openApi3" }) as Record<string, unknown>,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const tool = opts.tools.find((t) => t.name === req.params.name);
    if (!tool) {
      throw new ToolError("UNKNOWN_TOOL", { name: req.params.name });
    }
    const ctx = opts.makeCtx();
    return toMcpResult(tool)(req.params.arguments ?? {}, ctx);
  });

  return { server };
}
```

> **Note:** `zod-to-json-schema` is a tiny dependency (~20 KB). Add it now.

```json
// package.json devDependencies addition (or dependencies if you prefer)
"zod-to-json-schema": "^3.23.0"
```

```bash
npm install
```

- [ ] **Step 4: Verify pass**

```bash
npm run test -- tests/integration/server/mcp-server.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json src/server/mcp-server.ts tests/integration/server/mcp-server.test.ts
git commit -m "feat(server): MCP server with tools/list and tools/call"
```

---

### Phase A.5 — Read tools (Tasks A29–A40)

> **Pattern note:** Tasks A30–A40 follow the exact same five-step shape demonstrated in full in Task A29. Each subsequent task shows the unique parts only (the `.gql` operation, the input schema, the WaveClient method, the tool definition, and the integration test name). Apply the same code shape: add operation → run codegen → add typed `WaveClient` method → write `defineTool` → add to registry → add integration test → commit.

> **GraphQL operation files:** when adding a new query, append it to the matching file in `src/wave/operations/<domain>.gql` (create if missing). Run `npm run codegen` after every change to keep `src/wave/generated/sdk.ts` current.

### Task A29: list_businesses (template task — fully detailed)

**Files:**
- Modify: `src/wave/operations/businesses.gql` (already created in A23)
- Modify: `src/wave/client.ts` to expose `listBusinesses` (already done in A24)
- Create: `src/tools/businesses/list-businesses.ts`
- Modify: `src/server/tool-registry.ts` to register the tool
- Create: `tests/integration/tools/businesses/list-businesses.test.ts`

- [ ] **Step 1: Write the failing integration test**

```ts
// tests/integration/tools/businesses/list-businesses.test.ts
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { setupServer } from "msw/node";
import { graphql, HttpResponse } from "msw";
import { listBusinessesTool } from "../../../../src/tools/businesses/list-businesses.js";
import { WaveClient } from "../../../../src/wave/client.js";
import { MockProvider } from "../../../../src/wave/auth/mock.js";
import type { ToolContext } from "../../../../src/server/tool-context.js";

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

describe("list_businesses", () => {
  it("returns the list of businesses", async () => {
    server.use(
      graphql.query("ListBusinesses", () =>
        HttpResponse.json({
          data: {
            businesses: {
              pageInfo: { currentPage: 1, totalPages: 1, totalCount: 1 },
              edges: [{ node: { id: "biz_x", name: "Acme", currency: { code: "CAD" }, timezone: "UTC" } }],
            },
          },
        }),
      ),
    );
    const result = await listBusinessesTool.handler({}, makeCtx());
    expect(result).toMatchObject({
      businesses: [{ id: "biz_x", name: "Acme", currency: "CAD", timezone: "UTC" }],
      page_info: { current_page: 1, total_pages: 1, total_count: 1 },
    });
  });
});
```

- [ ] **Step 2: Verify failure**

```bash
npm run test -- tests/integration/tools/businesses/list-businesses.test.ts
```

- [ ] **Step 3: Implement the tool**

```ts
// src/tools/businesses/list-businesses.ts
import { z } from "zod";
import { defineTool } from "../../server/define-tool.js";

export const listBusinessesTool = defineTool({
  name: "list_businesses",
  description:
    "List all businesses (Wave entities) accessible to the authenticated token. Use this to discover the business_id for other tools when WAVE_DEFAULT_BUSINESS_ID is unset.",
  inputSchema: z.object({
    page: z.number().int().min(1).default(1).optional(),
    page_size: z.number().int().min(1).max(100).default(20).optional(),
  }),
  async execute(input, ctx) {
    const r = await ctx.wave.listBusinesses(ctx.req, {
      page: input.page ?? 1,
      pageSize: input.page_size ?? 20,
    });
    return {
      businesses: r.businesses.edges.map((e) => ({
        id: e.node.id,
        name: e.node.name,
        currency: e.node.currency.code,
        timezone: e.node.timezone,
      })),
      page_info: {
        current_page: r.businesses.pageInfo.currentPage,
        total_pages: r.businesses.pageInfo.totalPages,
        total_count: r.businesses.pageInfo.totalCount,
      },
    };
  },
});
```

- [ ] **Step 4: Register in the tool registry**

```ts
// src/server/tool-registry.ts
import type { RegisteredTool } from "./define-tool.js";
import { listBusinessesTool } from "../tools/businesses/list-businesses.js";

const TOOLS: RegisteredTool[] = [
  listBusinessesTool,
];

export function allTools(): RegisteredTool[] {
  return TOOLS;
}

export function registerTools(...tools: RegisteredTool[]): void {
  TOOLS.push(...tools);
}
```

- [ ] **Step 5: Verify pass**

```bash
npm run test -- tests/integration/tools/businesses/list-businesses.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add src/tools/businesses/list-businesses.ts src/server/tool-registry.ts \
        tests/integration/tools/businesses/list-businesses.test.ts
git commit -m "feat(tools): list_businesses"
```

---

### Task A30: list_customers (with profile parsing)

**Files:**
- Operation already in `src/wave/operations/customers.gql` (A23)
- Modify: `src/wave/client.ts` — already exposes `listCustomers` (A24)
- Create: `src/tools/customers/list-customers.ts`
- Create: `tests/integration/tools/customers/list-customers.test.ts`
- Modify: `src/server/tool-registry.ts`

- [ ] **Step 1: Write the failing test (similar shape to A29)**

```ts
// tests/integration/tools/customers/list-customers.test.ts
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { setupServer } from "msw/node";
import { graphql, HttpResponse } from "msw";
import { listCustomersTool } from "../../../../src/tools/customers/list-customers.js";
import { WaveClient } from "../../../../src/wave/client.js";
import { MockProvider } from "../../../../src/wave/auth/mock.js";
import type { ToolContext } from "../../../../src/server/tool-context.js";

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
                      internalNotes: `---mcp-wave---
alias: acme
unit: hours
hourly_rate: 95
currency: CAD
send_to: [billing@example.com]
---mcp-wave---`,
                    },
                  },
                ],
              },
            },
          },
        }),
      ),
    );
    const r = await listCustomersTool.handler({ with_profiles: true }, ctx()) as {
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
                  { node: { id: "c1", name: "x", email: null, currency: { code: "CAD" }, internalNotes: null } },
                ],
              },
            },
          },
        }),
      ),
    );
    const r = await listCustomersTool.handler({}, ctx()) as { customers: Array<Record<string, unknown>> };
    expect(r.customers[0]).not.toHaveProperty("profile");
  });
});
```

- [ ] **Step 2: Verify failure**

```bash
npm run test -- tests/integration/tools/customers/list-customers.test.ts
```

- [ ] **Step 3: Implement**

```ts
// src/tools/customers/list-customers.ts
import { z } from "zod";
import { defineTool } from "../../server/define-tool.js";
import { parseProfileFromNotes } from "../../domain/client-profiles/parse-from-notes.js";
import { ToolError } from "../../lib/errors.js";

export const listCustomersTool = defineTool({
  name: "list_customers",
  description:
    "List customers for a business. When with_profiles=true, parses each customer's internalNotes for an mcp-wave profile block.",
  inputSchema: z.object({
    business_id: z.string().optional(),
    page: z.number().int().min(1).default(1).optional(),
    page_size: z.number().int().min(1).max(100).default(50).optional(),
    with_profiles: z.boolean().default(false).optional(),
  }),
  async execute(input, ctx) {
    const businessId = input.business_id ?? ctx.env.WAVE_DEFAULT_BUSINESS_ID;
    if (!businessId) throw new ToolError("BUSINESS_ID_REQUIRED", {});
    const r = await ctx.wave.listCustomers(ctx.req, {
      businessId,
      page: input.page ?? 1,
      pageSize: input.page_size ?? 50,
    });
    if (!r.business) throw new ToolError("BUSINESS_NOT_FOUND", { business_id: businessId });

    return {
      customers: r.business.customers.edges.map((e) => {
        const base = {
          id: e.node.id,
          name: e.node.name,
          email: e.node.email,
          currency: e.node.currency.code,
        };
        if (input.with_profiles) {
          return { ...base, profile: parseProfileFromNotes(e.node.internalNotes) };
        }
        return base;
      }),
      page_info: {
        current_page: r.business.customers.pageInfo.currentPage,
        total_pages: r.business.customers.pageInfo.totalPages,
        total_count: r.business.customers.pageInfo.totalCount,
      },
    };
  },
});
```

- [ ] **Step 4: Register**

Edit `src/server/tool-registry.ts`, add to imports and to the `TOOLS` array:

```ts
import { listCustomersTool } from "../tools/customers/list-customers.js";
// ...
const TOOLS: RegisteredTool[] = [
  listBusinessesTool,
  listCustomersTool,
];
```

- [ ] **Step 5: Verify pass**

```bash
npm run test -- tests/integration/tools/customers/list-customers.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add src/tools/customers/list-customers.ts src/server/tool-registry.ts tests/integration/tools/customers/list-customers.test.ts
git commit -m "feat(tools): list_customers with optional profile parsing"
```

---

### Tasks A31–A40: read tools (uniform pattern)

> **Apply the same six-step shape as Task A29 for each of the following tools.** For each, the unique work is: (1) one new `.gql` operation appended to the matching file, (2) one typed pass-through method on `WaveClient`, (3) one `defineTool` file under `src/tools/<domain>/`, (4) registry entry, (5) integration test mocking the GraphQL operation, (6) commit.

**Common pattern reminder for every read tool:**

```ts
// Generic skeleton — adapt OPERATION_NAME, INPUT_SCHEMA, RETURN_SHAPE
import { z } from "zod";
import { defineTool } from "../../server/define-tool.js";
import { ToolError } from "../../lib/errors.js";

export const myTool = defineTool({
  name: "my_tool",
  description: "Plain-English description optimized for Claude to pick this tool.",
  inputSchema: z.object({ /* INPUT_SCHEMA */ }),
  async execute(input, ctx) {
    const businessId = input.business_id ?? ctx.env.WAVE_DEFAULT_BUSINESS_ID;
    if (!businessId) throw new ToolError("BUSINESS_ID_REQUIRED", {});
    const r = await ctx.wave.myOperation(ctx.req, { /* mapped vars */ });
    return { /* RETURN_SHAPE — flat, snake_case, Claude-friendly */ };
  },
});
```

#### Task A31: get_customer

- **GraphQL operation:** `GetCustomer` already in `customers.gql` (A23). Add `getCustomer(req, vars)` method to `WaveClient` if missing.
- **Input:** `{ business_id?: string, customer_id: string, with_profile?: boolean }`
- **Output:** `{ id, name, email, currency, internal_notes_raw, profile? }`
- **Test:** mock `GetCustomer` returning a single customer; assert profile is parsed when requested.
- **Errors:** `CUSTOMER_NOT_FOUND` when Wave returns null business.customer.
- **Commit:** `feat(tools): get_customer`

#### Task A32: list_invoices

- **GraphQL operation file:** create `src/wave/operations/invoices.gql`:

```graphql
query ListInvoices(
  $businessId: ID!,
  $page: Int = 1,
  $pageSize: Int = 50,
  $status: InvoiceStatus,
  $invoiceDateStart: Date,
  $invoiceDateEnd: Date,
) {
  business(id: $businessId) {
    invoices(
      page: $page,
      pageSize: $pageSize,
      status: $status,
      invoiceDateStart: $invoiceDateStart,
      invoiceDateEnd: $invoiceDateEnd,
    ) {
      pageInfo { currentPage totalPages totalCount }
      edges {
        node {
          id
          invoiceNumber
          status
          invoiceDate
          dueDate
          customer { id name }
          currency { code }
          total { value }
          amountDue { value }
        }
      }
    }
  }
}
```

- **Input:** `{ business_id?, status?, customer_id?, date_from?, date_to?, currency?, page?, page_size? }`
- **Output:** flat list with `id, number, status, customer, currency, total, amount_due, invoice_date, due_date`
- **Errors:** `BUSINESS_ID_REQUIRED`, `BUSINESS_NOT_FOUND`
- **Commit:** `feat(tools): list_invoices`

> **Schema caveat:** the exact `InvoiceStatus` enum and `invoiceDate*` argument names must be confirmed against the live Wave schema after `npm run codegen:introspect`. Adjust the operation if names differ.

#### Task A33: get_invoice

- **GraphQL operation:** add to `invoices.gql`:

```graphql
query GetInvoice($businessId: ID!, $invoiceId: ID!) {
  business(id: $businessId) {
    invoice(id: $invoiceId) {
      id
      invoiceNumber
      status
      invoiceDate
      dueDate
      memo
      customer { id name email }
      currency { code }
      items {
        product { id name }
        description
        quantity
        unitPrice
        taxes { salesTax { id name rate } amount { value } }
        subtotal { value }
        total { value }
      }
      subtotal { value }
      taxTotal { value }
      total { value }
      amountDue { value }
      amountPaid { value }
      pdfUrl
    }
  }
}
```

- **Input:** `{ business_id?, invoice_id }`
- **Output:** detailed invoice with computed totals, line items, and pdf_url
- **Errors:** `INVOICE_NOT_FOUND`
- **Commit:** `feat(tools): get_invoice`

#### Task A34: download_invoice_pdf

- Reuses `GetInvoice` (no new operation). Returns `{ invoice_id, invoice_number, pdf_url }`.
- **Errors:** `INVOICE_NOT_FOUND`, `PDF_UNAVAILABLE` if pdfUrl is null.
- **Commit:** `feat(tools): download_invoice_pdf`

#### Task A35: list_transactions

- **GraphQL operation file:** create `src/wave/operations/transactions.gql`:

```graphql
query ListTransactions(
  $businessId: ID!,
  $page: Int = 1,
  $pageSize: Int = 50,
  $accountId: ID,
  $dateStart: Date,
  $dateEnd: Date,
) {
  business(id: $businessId) {
    moneyTransactions(
      page: $page,
      pageSize: $pageSize,
      accountId: $accountId,
      dateStart: $dateStart,
      dateEnd: $dateEnd,
    ) {
      pageInfo { currentPage totalPages totalCount }
      edges {
        node {
          id
          date
          description
          amount { value }
          account { id name }
          splits {
            id
            amount { value }
            account { id name }
            memo
          }
        }
      }
    }
  }
}
```

- **Input:** `{ business_id?, account_id?, date_from?, date_to?, uncategorized_only?, unmatched_only?, page?, page_size? }`
- **Filtering for uncategorized/unmatched is done client-side in the tool body** (post-fetch filter: `uncategorized = splits.length === 0 || all splits hit "Uncategorized" account by name`).
- **Output:** list of transactions with their splits.
- **Commit:** `feat(tools): list_transactions`

#### Task A36: get_transaction

- **GraphQL operation:** add `GetTransaction(businessId, transactionId)` to `transactions.gql` returning the single node from list_transactions.
- **Errors:** `TRANSACTION_NOT_FOUND`
- **Commit:** `feat(tools): get_transaction`

#### Task A37: list_products

- **GraphQL operation file:** create `src/wave/operations/products.gql`:

```graphql
query ListProducts($businessId: ID!, $page: Int = 1, $pageSize: Int = 50) {
  business(id: $businessId) {
    products(page: $page, pageSize: $pageSize) {
      pageInfo { currentPage totalPages totalCount }
      edges {
        node {
          id
          name
          description
          unitPrice
          incomeAccount { id name }
        }
      }
    }
  }
}
```

- **Commit:** `feat(tools): list_products`

#### Task A38: list_vendors

- **GraphQL operation file:** create `src/wave/operations/vendors.gql` querying `business.vendors`. Same pagination shape as customers.
- **Commit:** `feat(tools): list_vendors`

#### Task A39: list_accounts and get_account

- **GraphQL operation file:** create `src/wave/operations/accounts.gql`:

```graphql
query ListAccounts($businessId: ID!, $type: AccountTypeValue) {
  business(id: $businessId) {
    accounts(types: [$type]) {
      edges {
        node {
          id
          name
          type { value normalBalanceType }
          subtype { value }
          currency { code }
        }
      }
    }
  }
}

query GetAccount($businessId: ID!, $accountId: ID!) {
  business(id: $businessId) {
    account(id: $accountId) {
      id
      name
      type { value normalBalanceType }
      subtype { value }
      currency { code }
    }
  }
}
```

- **Two tools (one task, one commit):** `list_accounts` with optional `type` filter, `get_account`.
- **Errors:** `ACCOUNT_NOT_FOUND` for get.
- **Commit:** `feat(tools): list_accounts and get_account`

#### Task A40: profit_and_loss and balance_sheet

- **GraphQL operation file:** create `src/wave/operations/reports.gql` with `ProfitAndLoss(businessId, startDate, endDate, basis)` and `BalanceSheet(businessId, asOfDate, basis)` matching Wave's `report.profitAndLoss` / `report.balanceSheet` shape (verify via introspection — exact field names may differ in current Wave schema).
- **Two tools (one task, one commit).** Override `timeoutMs` to 45 s on the WaveClient call (reports can be slow).
- **Output:** structured rows: `{ accounts: [{ id, name, balance, currency }], totals: {...} }`.
- **Commit:** `feat(tools): profit_and_loss and balance_sheet`

---

### Task A41: list_client_profiles (composite read tool)

**Files:**
- Create: `src/tools/profiles/list-client-profiles.ts`
- Create: `tests/integration/tools/profiles/list-client-profiles.test.ts`
- Modify: `src/server/tool-registry.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/integration/tools/profiles/list-client-profiles.test.ts
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { setupServer } from "msw/node";
import { graphql, HttpResponse } from "msw";
import { listClientProfilesTool } from "../../../../src/tools/profiles/list-client-profiles.js";
import { WaveClient } from "../../../../src/wave/client.js";
import { MockProvider } from "../../../../src/wave/auth/mock.js";
import type { ToolContext } from "../../../../src/server/tool-context.js";

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

describe("list_client_profiles", () => {
  it("returns parsed profiles plus parse errors structured per customer", async () => {
    server.use(
      graphql.query("ListCustomers", () =>
        HttpResponse.json({
          data: {
            business: {
              customers: {
                pageInfo: { currentPage: 1, totalPages: 1, totalCount: 2 },
                edges: [
                  {
                    node: {
                      id: "c1",
                      name: "Acme",
                      email: "x@y.z",
                      currency: { code: "CAD" },
                      internalNotes: `---mcp-wave---
alias: acme
currency: CAD
send_to: [x@y.z]
---mcp-wave---`,
                    },
                  },
                  { node: { id: "c2", name: "NoProfile", email: null, currency: { code: "USD" }, internalNotes: null } },
                ],
              },
            },
          },
        }),
      ),
    );
    const r = (await listClientProfilesTool.handler({}, ctx())) as { profiles: unknown[]; errors: unknown[] };
    expect(r.profiles).toHaveLength(1);
    expect(r.errors).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Verify failure**

```bash
npm run test -- tests/integration/tools/profiles/list-client-profiles.test.ts
```

- [ ] **Step 3: Implement**

```ts
// src/tools/profiles/list-client-profiles.ts
import { z } from "zod";
import { defineTool } from "../../server/define-tool.js";
import { parseProfileFromNotes } from "../../domain/client-profiles/parse-from-notes.js";
import { ToolError } from "../../lib/errors.js";

export const listClientProfilesTool = defineTool({
  name: "list_client_profiles",
  description:
    "List all customers that have an mcp-wave profile defined in their internalNotes. Returns alias→customer mappings and any parse errors.",
  inputSchema: z.object({
    business_id: z.string().optional(),
  }),
  async execute(input, ctx) {
    const businessId = input.business_id ?? ctx.env.WAVE_DEFAULT_BUSINESS_ID;
    if (!businessId) throw new ToolError("BUSINESS_ID_REQUIRED", {});

    const profiles: Array<{
      customer_id: string;
      customer_name: string;
      profile: unknown;
    }> = [];
    const errors: Array<{
      customer_id: string;
      customer_name: string;
      issues: Array<{ path: string; message: string }>;
    }> = [];

    let page = 1;
    while (true) {
      const r = await ctx.wave.listCustomers(ctx.req, { businessId, page, pageSize: 100 });
      if (!r.business) throw new ToolError("BUSINESS_NOT_FOUND", { business_id: businessId });
      for (const edge of r.business.customers.edges) {
        const result = parseProfileFromNotes(edge.node.internalNotes);
        if (result.kind === "ok") {
          profiles.push({
            customer_id: edge.node.id,
            customer_name: edge.node.name,
            profile: result.profile,
          });
        } else if (result.kind === "parse_error") {
          errors.push({
            customer_id: edge.node.id,
            customer_name: edge.node.name,
            issues: result.issues,
          });
        }
      }
      if (page >= r.business.customers.pageInfo.totalPages) break;
      page++;
    }

    return { profiles, errors };
  },
});
```

- [ ] **Step 4: Register and verify**

Add to `tool-registry.ts`:

```ts
import { listClientProfilesTool } from "../tools/profiles/list-client-profiles.js";
// inside TOOLS:
listClientProfilesTool,
```

```bash
npm run test -- tests/integration/tools/profiles/list-client-profiles.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/tools/profiles/list-client-profiles.ts src/server/tool-registry.ts tests/integration/tools/profiles/list-client-profiles.test.ts
git commit -m "feat(tools): list_client_profiles"
```

---

### Task A42: get_payroll_rates

**Files:**
- Create: `src/tools/tax/get-payroll-rates.ts`
- Create: `tests/integration/tools/tax/get-payroll-rates.test.ts`
- Modify: `src/server/tool-registry.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/integration/tools/tax/get-payroll-rates.test.ts
import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getPayrollRatesTool } from "../../../../src/tools/tax/get-payroll-rates.js";
import { TaxRatesLoader } from "../../../../src/domain/tax/rates-loader.js";
import type { ToolContext } from "../../../../src/server/tool-context.js";

const FIXTURE = `
jurisdiction: CA-QC
year: 2026
effective_from: 2026-01-01
effective_to: 2026-12-31
remittance_authorities:
  - { code: CRA, name: X, level: federal }
payroll_taxes: []
sales_taxes: []
`;

function makeCtx(): ToolContext {
  const dir = mkdtempSync(join(tmpdir(), "rates-"));
  writeFileSync(join(dir, "ca-qc-2026.yaml"), FIXTURE);
  return {
    req: { headers: null, request_id: "t" },
    wave: {} as never,
    taxRates: new TaxRatesLoader(dir),
    accountMapping: {} as never,
    env: {} as never,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never,
    identity: "mock",
  };
}

describe("get_payroll_rates", () => {
  it("returns the table for jurisdiction+year", async () => {
    const r = (await getPayrollRatesTool.handler(
      { jurisdiction: "CA-QC", year: 2026 },
      makeCtx(),
    )) as { jurisdiction: string };
    expect(r.jurisdiction).toBe("CA-QC");
  });

  it("returns the table covering a specific date when year omitted", async () => {
    const r = (await getPayrollRatesTool.handler(
      { jurisdiction: "CA-QC", on_date: "2026-06-15" },
      makeCtx(),
    )) as { year: number };
    expect(r.year).toBe(2026);
  });
});
```

- [ ] **Step 2: Verify failure**

```bash
npm run test -- tests/integration/tools/tax/get-payroll-rates.test.ts
```

- [ ] **Step 3: Implement**

```ts
// src/tools/tax/get-payroll-rates.ts
import { z } from "zod";
import { defineTool } from "../../server/define-tool.js";
import { ToolError } from "../../lib/errors.js";

export const getPayrollRatesTool = defineTool({
  name: "get_payroll_rates",
  description:
    "Return the versioned payroll-tax rate table for a given jurisdiction (e.g. 'CA-QC'), either by explicit year or by a date the table covers.",
  inputSchema: z
    .object({
      jurisdiction: z.string().min(1),
      year: z.number().int().optional(),
      on_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    })
    .refine((v) => v.year !== undefined || v.on_date !== undefined, {
      message: "Provide either year or on_date",
    }),
  async execute(input, ctx) {
    if (input.year !== undefined) {
      return ctx.taxRates.load(input.jurisdiction, input.year);
    }
    if (input.on_date) {
      return ctx.taxRates.loadForDate(input.jurisdiction, input.on_date);
    }
    throw new ToolError("INVALID_INPUT", {}, "year or on_date required");
  },
});
```

- [ ] **Step 4: Register**

Add to `tool-registry.ts`:

```ts
import { getPayrollRatesTool } from "../tools/tax/get-payroll-rates.js";
// inside TOOLS:
getPayrollRatesTool,
```

- [ ] **Step 5: Verify pass**

```bash
npm run test -- tests/integration/tools/tax/get-payroll-rates.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add src/tools/tax/get-payroll-rates.ts src/server/tool-registry.ts tests/integration/tools/tax/get-payroll-rates.test.ts
git commit -m "feat(tools): get_payroll_rates"
```

---

### Phase A.6 — Entrypoints (Tasks A43–A44)

### Task A43: stdio entrypoint

**Files:**
- Create: `src/entrypoints/stdio.ts`
- Create: `tests/integration/entrypoints/stdio.smoke.test.ts`

- [ ] **Step 1: Implement the entrypoint**

```ts
// src/entrypoints/stdio.ts
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { parseEnv } from "../config/env.js";
import { createLogger } from "../config/logger.js";
import { selectProvider } from "../wave/auth/select.js";
import { WaveClient } from "../wave/client.js";
import { TaxRatesLoader } from "../domain/tax/rates-loader.js";
import { AccountMappingLoader } from "../domain/tax/account-mapping-loader.js";
import { buildMcpServer } from "../server/mcp-server.js";
import { allTools } from "../server/tool-registry.js";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";

async function main(): Promise<void> {
  const env = parseEnv(process.env);
  const logger = createLogger({ level: env.LOG_LEVEL, logPII: env.LOG_PII });
  const provider = selectProvider(env);
  const wave = new WaveClient({ endpoint: env.WAVE_GRAPHQL_ENDPOINT, provider });
  const taxRates = new TaxRatesLoader(resolve("data/tax-rates"));
  const accountMapping = new AccountMappingLoader(resolve("data/account-mapping"));

  const { server } = buildMcpServer({
    tools: allTools(),
    makeCtx: () => ({
      req: { headers: null, request_id: randomUUID() },
      wave,
      taxRates,
      accountMapping,
      env,
      logger,
      identity: "stdio",
    }),
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info({ tools: allTools().length }, "mcp-wave stdio ready");
}

main().catch((e) => {
  console.error("[mcp-wave] fatal:", e);
  process.exit(1);
});
```

- [ ] **Step 2: Smoke test (spawning a child process)**

```ts
// tests/integration/entrypoints/stdio.smoke.test.ts
import { describe, expect, it } from "vitest";
import { spawn } from "node:child_process";

describe("stdio entrypoint smoke", () => {
  it("starts and lists tools", async () => {
    const proc = spawn("npx", ["tsx", "src/entrypoints/stdio.ts"], {
      env: {
        ...process.env,
        WAVE_AUTH_MODE: "mock",
        WAVE_API_TOKEN: "fake",
        WAVE_DEFAULT_BUSINESS_ID: "biz_x",
        WAVE_GRAPHQL_ENDPOINT: "https://example.invalid/graphql",
        LOG_LEVEL: "fatal",
      },
      stdio: ["pipe", "pipe", "pipe"],
    });

    let buffer = "";
    proc.stdout.on("data", (chunk) => { buffer += String(chunk); });

    const send = (msg: object) => proc.stdin.write(`${JSON.stringify(msg)}\n`);
    send({
      jsonrpc: "2.0", id: 1, method: "initialize",
      params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "smoke", version: "0" } },
    });
    send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });

    await new Promise((res) => setTimeout(res, 1500));
    proc.kill("SIGTERM");

    expect(buffer).toMatch(/"tools"/);
    expect(buffer).toMatch(/"list_businesses"/);
  }, 10_000);
});
```

- [ ] **Step 3: Verify**

```bash
npm run test -- tests/integration/entrypoints/stdio.smoke.test.ts
```

- [ ] **Step 4: Commit**

```bash
git add src/entrypoints/stdio.ts tests/integration/entrypoints/stdio.smoke.test.ts
git commit -m "feat(entrypoint): stdio entrypoint with full wiring"
```

---

### Task A44: HTTP entrypoint with /healthz and /readyz (no MCP HTTP yet)

**Files:**
- Create: `src/entrypoints/http.ts`
- Create: `tests/integration/entrypoints/http.healthz.test.ts`

> **Scope:** Phase A only ships the Hono server with two health endpoints. The Streamable HTTP MCP transport itself is added in Part B (Task B27).

- [ ] **Step 1: Implement**

```ts
// src/entrypoints/http.ts
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { GraphQLClient } from "graphql-request";
import { parseEnv } from "../config/env.js";
import { createLogger } from "../config/logger.js";
import { TaxRatesLoader } from "../domain/tax/rates-loader.js";
import { resolve } from "node:path";

const env = parseEnv(process.env);
const logger = createLogger({ level: env.LOG_LEVEL, logPII: env.LOG_PII });
const taxRates = new TaxRatesLoader(resolve("data/tax-rates"));

const app = new Hono();

app.get("/healthz", (c) => c.json({ ok: true }));

app.get("/readyz", async (c) => {
  const issues: string[] = [];
  try {
    await taxRates.load("CA-QC", new Date().getUTCFullYear());
  } catch (e) {
    issues.push(`tax-rates: ${e instanceof Error ? e.message : String(e)}`);
  }
  try {
    const gql = new GraphQLClient(env.WAVE_GRAPHQL_ENDPOINT);
    await gql.request("{ __typename }");
  } catch (e) {
    issues.push(`wave-schema: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (issues.length > 0) return c.json({ ok: false, issues }, 503);
  return c.json({ ok: true });
});

if (process.env.NODE_ENV !== "test") {
  const port = Number(process.env.PORT ?? 8080);
  serve({ fetch: app.fetch, port }, () => {
    logger.info({ port }, "mcp-wave http ready (healthz only — MCP HTTP in Part B)");
  });
}

export { app };
```

- [ ] **Step 2: Test**

```ts
// tests/integration/entrypoints/http.healthz.test.ts
import { describe, expect, it, beforeAll } from "vitest";

beforeAll(() => {
  process.env.WAVE_AUTH_MODE = "mock";
  process.env.WAVE_API_TOKEN = "fake";
  process.env.WAVE_DEFAULT_BUSINESS_ID = "biz_x";
  process.env.WAVE_GRAPHQL_ENDPOINT = "https://example.invalid/graphql";
  process.env.LOG_LEVEL = "fatal";
  process.env.NODE_ENV = "test";
});

describe("http /healthz", () => {
  it("returns 200 ok", async () => {
    const { app } = await import("../../../src/entrypoints/http.js");
    const res = await app.request("/healthz");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});
```

- [ ] **Step 3: Run**

```bash
npm run test -- tests/integration/entrypoints/http.healthz.test.ts
```

- [ ] **Step 4: Final Part A verification**

```bash
npm run check
```

Expected: lint, typecheck, all tests pass.

- [ ] **Step 5: Tag the milestone**

```bash
git add src/entrypoints/http.ts tests/integration/entrypoints/http.healthz.test.ts
git commit -m "feat(entrypoint): http server with healthz and readyz"
git tag -a v0.1.0-part-a -m "Part A: foundations + read-only MCP"
```

---

## Part A Self-Review Checklist

After A1–A44, verify before declaring Part A done:

- [ ] `npm run check` is green.
- [ ] `npm run dev:stdio` starts without error when `.env` has valid values.
- [ ] A Claude Desktop config pointing at `src/entrypoints/stdio.ts` lists `list_businesses`, `list_customers`, `list_invoices`, `get_invoice`, `list_transactions`, `list_accounts`, `profit_and_loss`, `list_client_profiles`, `get_payroll_rates` (≥9 tools).
- [ ] `npm run coverage` shows `src/domain/**` ≥95%, global ≥85%.
- [ ] `git tag -l v0.1.0-part-a` exists.

---

## Part B — Write tools + Workflows

> **Prereq:** Part A merged and tagged `v0.1.0-part-a`. All Part A tools, helpers, and the Wave client are in place.

> **Pattern recap:** every write tool follows the same six-step shape from Part A: add `.gql` mutation → run `npm run codegen` → add typed `WaveClient` method → write `defineTool` file → register → integration test → commit. Tasks B3–B12 list only the unique parts (mutation, signature, error catalog).

### Phase B.0 — Mutation scaffolding (Tasks B1–B2)

### Task B1: GraphQL mutation files

**Files:**
- Modify: `src/wave/operations/invoices.gql`
- Modify: `src/wave/operations/customers.gql`
- Modify: `src/wave/operations/transactions.gql`
- Create: `src/wave/operations/products.gql` mutations section

> **Schema caveat:** Wave's mutation names need confirmation against the live schema after `npm run codegen:introspect`. The names below match Wave's documented public schema as of 2024; rename in this file if introspection shows different names.

- [ ] **Step 1: Append to `invoices.gql`**

```graphql
mutation InvoiceCreate($input: InvoiceCreateInput!) {
  invoiceCreate(input: $input) {
    didSucceed
    inputErrors { code message path }
    invoice {
      id
      invoiceNumber
      status
      pdfUrl
      total { value }
      subtotal { value }
      taxTotal { value }
    }
  }
}

mutation InvoicePatch($input: InvoicePatchInput!) {
  invoicePatch(input: $input) {
    didSucceed
    inputErrors { code message path }
    invoice { id status }
  }
}

mutation InvoiceSend($input: InvoiceSendInput!) {
  invoiceSend(input: $input) {
    didSucceed
    inputErrors { code message path }
  }
}

mutation InvoiceDelete($input: InvoiceDeleteInput!) {
  invoiceDelete(input: $input) {
    didSucceed
    inputErrors { code message path }
  }
}

mutation InvoiceMarkSent($input: InvoiceMarkSentInput!) {
  invoiceMarkSent(input: $input) {
    didSucceed
    inputErrors { code message path }
  }
}
```

- [ ] **Step 2: Append to `customers.gql`**

```graphql
mutation CustomerCreate($input: CustomerCreateInput!) {
  customerCreate(input: $input) {
    didSucceed
    inputErrors { code message path }
    customer { id name email internalNotes }
  }
}

mutation CustomerPatch($input: CustomerPatchInput!) {
  customerPatch(input: $input) {
    didSucceed
    inputErrors { code message path }
    customer { id name email internalNotes }
  }
}
```

- [ ] **Step 3: Append to `transactions.gql`**

```graphql
mutation MoneyTransactionCategorize($input: MoneyTransactionCategorizeInput!) {
  moneyTransactionCategorize(input: $input) {
    didSucceed
    inputErrors { code message path }
    transaction {
      id
      splits { id amount { value } account { id name } memo }
    }
  }
}

mutation MoneyTransactionSplit($input: MoneyTransactionSplitInput!) {
  moneyTransactionSplit(input: $input) {
    didSucceed
    inputErrors { code message path }
    transaction {
      id
      amount { value }
      splits { id amount { value } account { id name } memo }
    }
  }
}

query ListSalesTaxes($businessId: ID!) {
  business(id: $businessId) {
    salesTaxes {
      edges { node { id name abbreviation rate } }
    }
  }
}
```

- [ ] **Step 4: Append products mutations to `products.gql`**

```graphql
mutation ProductCreate($input: ProductCreateInput!) {
  productCreate(input: $input) {
    didSucceed
    inputErrors { code message path }
    product { id name unitPrice }
  }
}

mutation ProductPatch($input: ProductPatchInput!) {
  productPatch(input: $input) {
    didSucceed
    inputErrors { code message path }
    product { id name unitPrice }
  }
}
```

- [ ] **Step 5: Run codegen and typecheck**

```bash
npm run codegen
npm run typecheck
```

- [ ] **Step 6: Commit**

```bash
git add src/wave/operations/ src/wave/generated/ codegen.yml
git commit -m "feat(wave): GraphQL mutations for invoices, customers, transactions, products"
```

> **Note:** `src/wave/generated/sdk.ts` is gitignored per Task A1. The above `git add src/wave/generated/` will only add the `.gitkeep`.

---

### Task B2: WaveClient mutation pass-throughs and error helper

**Files:**
- Modify: `src/wave/client.ts` — add typed methods.
- Create: `src/wave/payload-errors.ts` — converts Wave's `inputErrors[]` payload to `WaveApiError`.
- Create: `tests/unit/wave/payload-errors.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/wave/payload-errors.test.ts
import { describe, expect, it } from "vitest";
import { throwIfInputErrors } from "../../../src/wave/payload-errors.js";

describe("throwIfInputErrors", () => {
  it("returns silently when didSucceed is true", () => {
    expect(() => throwIfInputErrors({ didSucceed: true, inputErrors: [] }, "X")).not.toThrow();
  });
  it("throws WAVE_VALIDATION_ERROR when didSucceed is false", () => {
    expect(() =>
      throwIfInputErrors(
        { didSucceed: false, inputErrors: [{ code: "FOO", message: "bad", path: "x" }] },
        "InvoiceCreate",
      ),
    ).toThrow(/WAVE_VALIDATION_ERROR/);
  });
  it("throws when payload is null/undefined", () => {
    expect(() => throwIfInputErrors(null, "X")).toThrow();
  });
});
```

- [ ] **Step 2: Implement**

```ts
// src/wave/payload-errors.ts
import { WaveApiError } from "../lib/errors.js";

export interface WavePayload<T = unknown> {
  didSucceed: boolean;
  inputErrors?: Array<{ code?: string | null; message?: string | null; path?: string | null }> | null;
  [key: string]: unknown;
}

export function throwIfInputErrors<T>(payload: WavePayload<T> | null | undefined, op: string): asserts payload is WavePayload<T> {
  if (!payload) {
    throw new WaveApiError("EMPTY_PAYLOAD", 500, { operation: op });
  }
  if (!payload.didSucceed) {
    throw new WaveApiError("VALIDATION_ERROR", 400, {
      operation: op,
      inputErrors: payload.inputErrors ?? [],
    });
  }
}
```

- [ ] **Step 3: Add typed methods to `WaveClient`**

Append to `src/wave/client.ts` inside the class:

```ts
  invoiceCreate(req: RequestContext, vars: SdkArgs<"InvoiceCreate">) {
    return this.call(req, "InvoiceCreate", vars);
  }
  invoicePatch(req: RequestContext, vars: SdkArgs<"InvoicePatch">) {
    return this.call(req, "InvoicePatch", vars);
  }
  invoiceSend(req: RequestContext, vars: SdkArgs<"InvoiceSend">) {
    return this.call(req, "InvoiceSend", vars);
  }
  invoiceDelete(req: RequestContext, vars: SdkArgs<"InvoiceDelete">) {
    return this.call(req, "InvoiceDelete", vars);
  }
  invoiceMarkSent(req: RequestContext, vars: SdkArgs<"InvoiceMarkSent">) {
    return this.call(req, "InvoiceMarkSent", vars);
  }
  customerCreate(req: RequestContext, vars: SdkArgs<"CustomerCreate">) {
    return this.call(req, "CustomerCreate", vars);
  }
  customerPatch(req: RequestContext, vars: SdkArgs<"CustomerPatch">) {
    return this.call(req, "CustomerPatch", vars);
  }
  productCreate(req: RequestContext, vars: SdkArgs<"ProductCreate">) {
    return this.call(req, "ProductCreate", vars);
  }
  productPatch(req: RequestContext, vars: SdkArgs<"ProductPatch">) {
    return this.call(req, "ProductPatch", vars);
  }
  moneyTransactionCategorize(req: RequestContext, vars: SdkArgs<"MoneyTransactionCategorize">) {
    return this.call(req, "MoneyTransactionCategorize", vars);
  }
  moneyTransactionSplit(req: RequestContext, vars: SdkArgs<"MoneyTransactionSplit">) {
    return this.call(req, "MoneyTransactionSplit", vars);
  }
  listSalesTaxes(req: RequestContext, vars: SdkArgs<"ListSalesTaxes">) {
    return this.call(req, "ListSalesTaxes", vars);
  }
```

- [ ] **Step 4: Verify**

```bash
npm run typecheck
npm run test -- tests/unit/wave/payload-errors.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/wave/client.ts src/wave/payload-errors.ts tests/unit/wave/payload-errors.test.ts
git commit -m "feat(wave): typed mutation pass-throughs and payload-errors helper"
```

---

### Phase B.1 — Write tools, CRUD (Tasks B3–B12)

### Task B3: create_invoice

**Files:** `src/tools/invoices/create-invoice.ts`, integration test, register.

**Pattern:** input schema → resolve `business_id` → build `InvoiceCreateInput` → call `invoiceCreate` → `throwIfInputErrors` → return `{invoice_id, invoice_number, status: "DRAFT", pdf_url, totals}`.

```ts
// src/tools/invoices/create-invoice.ts
import { z } from "zod";
import { defineTool } from "../../server/define-tool.js";
import { ToolError } from "../../lib/errors.js";
import { throwIfInputErrors } from "../../wave/payload-errors.js";

const InvoiceLineInput = z.object({
  product_id: z.string().optional(),
  description: z.string().min(1),
  quantity: z.number().positive(),
  unit_price: z.number().nonnegative(),
  tax_ids: z.array(z.string()).default([]),
});

export const createInvoiceTool = defineTool({
  name: "create_invoice",
  description:
    "Create a DRAFT invoice in Wave. Returns invoice_id and PDF URL. Not idempotent: a second call creates a second draft.",
  inputSchema: z.object({
    business_id: z.string().optional(),
    customer_id: z.string(),
    currency: z.string().length(3),
    invoice_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    invoice_number: z.string().optional(),
    memo: z.string().optional(),
    items: z.array(InvoiceLineInput).min(1),
  }),
  async execute(input, ctx) {
    const businessId = input.business_id ?? ctx.env.WAVE_DEFAULT_BUSINESS_ID;
    if (!businessId) throw new ToolError("BUSINESS_ID_REQUIRED", {});
    const r = await ctx.wave.invoiceCreate(ctx.req, {
      input: {
        businessId,
        customerId: input.customer_id,
        currency: input.currency,
        invoiceDate: input.invoice_date,
        dueDate: input.due_date,
        invoiceNumber: input.invoice_number,
        memo: input.memo,
        items: input.items.map((i) => ({
          productId: i.product_id,
          description: i.description,
          quantity: i.quantity,
          unitPrice: String(i.unit_price),
          taxes: i.tax_ids.map((id) => ({ salesTaxId: id })),
        })),
      },
    });
    throwIfInputErrors(r.invoiceCreate, "InvoiceCreate");
    const inv = r.invoiceCreate.invoice;
    return {
      invoice_id: inv.id,
      invoice_number: inv.invoiceNumber,
      status: inv.status,
      pdf_url: inv.pdfUrl,
      totals: {
        subtotal: Number(inv.subtotal.value),
        tax_total: Number(inv.taxTotal.value),
        total: Number(inv.total.value),
        currency: input.currency,
      },
    };
  },
});
```

**Test:** mock `InvoiceCreate` returning `didSucceed: true` and a draft. Plus a failure case where `didSucceed: false` and `inputErrors` non-empty → expect `WAVE_VALIDATION_ERROR`.

**Register:** add to `tool-registry.ts`.

**Commit:** `feat(tools): create_invoice`

---

### Task B4: send_invoice

```ts
// src/tools/invoices/send-invoice.ts
import { z } from "zod";
import { defineTool } from "../../server/define-tool.js";
import { ToolError } from "../../lib/errors.js";
import { throwIfInputErrors } from "../../wave/payload-errors.js";

export const sendInvoiceTool = defineTool({
  name: "send_invoice",
  description:
    "Send an invoice by email via Wave. NOT idempotent: each call triggers a new email. Always confirm with the user before calling.",
  inputSchema: z.object({
    business_id: z.string().optional(),
    invoice_id: z.string(),
    to_email: z.array(z.string().email()).min(1),
    cc_email: z.array(z.string().email()).default([]),
    subject: z.string().optional(),
    message: z.string().optional(),
    attach_pdf: z.boolean().default(true),
  }),
  async execute(input, ctx) {
    const businessId = input.business_id ?? ctx.env.WAVE_DEFAULT_BUSINESS_ID;
    if (!businessId) throw new ToolError("BUSINESS_ID_REQUIRED", {});
    const r = await ctx.wave.invoiceSend(ctx.req, {
      input: {
        invoiceId: input.invoice_id,
        to: input.to_email,
        ccTo: input.cc_email,
        subject: input.subject,
        message: input.message,
        attachPDF: input.attach_pdf,
      },
    });
    throwIfInputErrors(r.invoiceSend, "InvoiceSend");
    return { invoice_id: input.invoice_id, sent_to: input.to_email, sent_at: new Date().toISOString() };
  },
});
```

**Test:** mock send returning success; assert returned `sent_to` matches input. Also a failure case.

**Commit:** `feat(tools): send_invoice`

---

### Task B5: mark_invoice_paid

> **Wave caveat:** Wave's data model doesn't expose a single "record payment" mutation in the public API. The supported flow is to create a money transaction in the bank account and then call `match_transaction_to_invoice`. This tool composes both. It depends on Task B11 — schedule it AFTER B11 in the implementation order if you go strictly TDD, OR stub it to throw `NOT_IMPLEMENTED` and revisit after B11. The commit below documents the choice.

**Path of least surprise:** schedule B11 immediately after B5 and have B5 reference B11. The commit chain works because each tool file commits independently and the registry only registers tools whose handlers exist.

For now in B5, define the tool with a placeholder handler that returns a clear error pointing to the recommended workflow:

```ts
// src/tools/invoices/mark-invoice-paid.ts
import { z } from "zod";
import { defineTool } from "../../server/define-tool.js";
import { ToolError } from "../../lib/errors.js";

export const markInvoicePaidTool = defineTool({
  name: "mark_invoice_paid",
  description:
    "Record a payment against an invoice. Wave's API requires this to be done as a bank transaction matched to the invoice. This tool composes the create_transaction + match_transaction_to_invoice steps once those are in place (see also: invoice payments via the Wave UI).",
  inputSchema: z.object({
    business_id: z.string().optional(),
    invoice_id: z.string(),
    amount: z.number().positive(),
    paid_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    bank_account_id: z.string(),
    memo: z.string().optional(),
  }),
  async execute(_input, _ctx) {
    throw new ToolError(
      "NOT_IMPLEMENTED",
      {},
      "Pending verification of Wave's payment-recording mutation. Use match_transaction_to_invoice with an existing bank transaction in the meantime.",
    );
  },
});
```

**Register and commit** with `feat(tools): mark_invoice_paid stub pending Wave schema verification`. Replace the body once introspection confirms the actual mutation name (likely `MoneyTransactionCreate` + `InvoicePaymentCreate`).

---

### Task B6: delete_invoice

**Pattern:** `invoiceDelete({ input: { invoiceId } })`. Errors: `INVOICE_NOT_DRAFT` mapped from Wave's `inputErrors`. Test happy + non-DRAFT path.

**Commit:** `feat(tools): delete_invoice (DRAFT only)`

---

### Task B7: create_customer (with optional notes_yaml seed)

```ts
// src/tools/customers/create-customer.ts
import { z } from "zod";
import { defineTool } from "../../server/define-tool.js";
import { ToolError } from "../../lib/errors.js";
import { throwIfInputErrors } from "../../wave/payload-errors.js";

export const createCustomerTool = defineTool({
  name: "create_customer",
  description:
    "Create a customer in Wave. Optionally seed an mcp-wave profile in internalNotes via notes_yaml.",
  inputSchema: z.object({
    business_id: z.string().optional(),
    name: z.string().min(1),
    email: z.string().email().optional(),
    currency: z.string().length(3),
    address: z
      .object({
        addressLine1: z.string().optional(),
        city: z.string().optional(),
        province: z.string().optional(),
        postalCode: z.string().optional(),
        countryCode: z.string().length(2).optional(),
      })
      .optional(),
    notes_yaml: z.string().optional(),
  }),
  async execute(input, ctx) {
    const businessId = input.business_id ?? ctx.env.WAVE_DEFAULT_BUSINESS_ID;
    if (!businessId) throw new ToolError("BUSINESS_ID_REQUIRED", {});
    const internalNotes = input.notes_yaml
      ? `---mcp-wave---\n${input.notes_yaml.trim()}\n---mcp-wave---`
      : undefined;
    const r = await ctx.wave.customerCreate(ctx.req, {
      input: {
        businessId,
        name: input.name,
        email: input.email,
        currency: input.currency,
        address: input.address,
        internalNotes,
      },
    });
    throwIfInputErrors(r.customerCreate, "CustomerCreate");
    return { customer_id: r.customerCreate.customer.id };
  },
});
```

**Test:** mock create returning a customer; assert internalNotes wraps yaml. Failure case for invalid email.

**Commit:** `feat(tools): create_customer with optional profile seed`

---

### Task B8: upsert_product

**Pattern:** if `id` provided → `productPatch`, else → `productCreate`. Both share the same input shape. Map `unit_price` (number) to `unitPrice` (string Decimal). Errors: `WAVE_VALIDATION_ERROR`.

**Commit:** `feat(tools): upsert_product`

---

### Task B9: categorize_transaction

```ts
// src/tools/transactions/categorize-transaction.ts
import { z } from "zod";
import { defineTool } from "../../server/define-tool.js";
import { ToolError } from "../../lib/errors.js";
import { throwIfInputErrors } from "../../wave/payload-errors.js";

export const categorizeTransactionTool = defineTool({
  name: "categorize_transaction",
  description: "Categorize a single bank transaction by setting its account.",
  inputSchema: z.object({
    business_id: z.string().optional(),
    transaction_id: z.string(),
    account_id: z.string(),
    memo: z.string().optional(),
  }),
  async execute(input, ctx) {
    const businessId = input.business_id ?? ctx.env.WAVE_DEFAULT_BUSINESS_ID;
    if (!businessId) throw new ToolError("BUSINESS_ID_REQUIRED", {});
    const r = await ctx.wave.moneyTransactionCategorize(ctx.req, {
      input: {
        businessId,
        transactionId: input.transaction_id,
        accountId: input.account_id,
        memo: input.memo,
      },
    });
    throwIfInputErrors(r.moneyTransactionCategorize, "MoneyTransactionCategorize");
    return {
      transaction_id: input.transaction_id,
      splits: r.moneyTransactionCategorize.transaction.splits.map((s) => ({
        amount: Number(s.amount.value),
        account_id: s.account.id,
        account_name: s.account.name,
        memo: s.memo,
      })),
    };
  },
});
```

**Commit:** `feat(tools): categorize_transaction`

---

### Task B10: split_transaction

**Pattern:** input is `transaction_id` + `splits: [{account_id, amount, memo?}]`. Validate sum > 0 (Wave will reject mismatch but we add a clear pre-check). Call `moneyTransactionSplit`. Return updated transaction with annotated splits.

Errors: `SPLIT_SUM_MISMATCH` (pre-check), `WAVE_VALIDATION_ERROR` (server).

**Commit:** `feat(tools): split_transaction`

---

### Task B11: match_transaction_to_invoice

> **Schema caveat (revisited):** the actual Wave mutation for invoice-payment matching needs to be verified post-introspection. Likely names: `InvoicePaymentCreate`, `MoneyTransactionMatchToInvoice`. Adjust the operation file once you know.

Operation in `transactions.gql`:

```graphql
mutation MatchTransactionToInvoice($input: MoneyTransactionMatchToInvoiceInput!) {
  moneyTransactionMatchToInvoice(input: $input) {
    didSucceed
    inputErrors { code message path }
  }
}
```

Tool wraps this and returns `{transaction_id, invoice_id, matched: true}`.

After this lands, **revisit Task B5** to replace the stub with a composite `mark_invoice_paid` that calls this matcher.

**Commit:** `feat(tools): match_transaction_to_invoice`, then `feat(tools): mark_invoice_paid implementation` as a follow-up commit.

---

### Task B12: register all CRUD writes

Update `src/server/tool-registry.ts` to register every tool from B3–B11 (in addition to Part A read tools). Verify with:

```bash
npm run check
```

**Commit:** `chore: register all v1 write tools`

---

### Phase B.2 — Domain helpers for workflows (Tasks B13–B14)

### Task B13: Sales tax resolver

**Files:**
- Create: `src/domain/invoice-templating/resolve-sales-taxes.ts`
- Create: `tests/unit/domain/invoice-templating/resolve-sales-taxes.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/domain/invoice-templating/resolve-sales-taxes.test.ts
import { describe, expect, it } from "vitest";
import { resolveSalesTaxes } from "../../../../src/domain/invoice-templating/resolve-sales-taxes.js";

const TAXES = [
  { id: "tax_gst", name: "Goods and Services Tax", abbreviation: "GST", rate: 0.05 },
  { id: "tax_qst", name: "Quebec Sales Tax", abbreviation: "QST", rate: 0.09975 },
];

describe("resolveSalesTaxes", () => {
  it("matches by abbreviation case-insensitively", () => {
    const r = resolveSalesTaxes(["gst", "QST"], TAXES);
    expect(r.matched.map((t) => t.id)).toEqual(["tax_gst", "tax_qst"]);
    expect(r.unresolved).toEqual([]);
  });

  it("matches by name when abbreviation absent", () => {
    const r = resolveSalesTaxes(["Goods and Services Tax"], TAXES);
    expect(r.matched[0]?.id).toBe("tax_gst");
  });

  it("reports unresolved codes", () => {
    const r = resolveSalesTaxes(["GST", "VAT"], TAXES);
    expect(r.unresolved).toEqual(["VAT"]);
  });

  it("returns empty when codes empty", () => {
    expect(resolveSalesTaxes([], TAXES)).toEqual({ matched: [], unresolved: [] });
  });
});
```

- [ ] **Step 2: Verify failure**

```bash
npm run test -- tests/unit/domain/invoice-templating/resolve-sales-taxes.test.ts
```

- [ ] **Step 3: Implement**

```ts
// src/domain/invoice-templating/resolve-sales-taxes.ts
export interface SalesTax {
  id: string;
  name: string;
  abbreviation: string | null;
  rate: number;
}

export interface ResolveResult {
  matched: SalesTax[];
  unresolved: string[];
}

export function resolveSalesTaxes(codes: string[], taxes: SalesTax[]): ResolveResult {
  const byAbbr = new Map<string, SalesTax>();
  const byName = new Map<string, SalesTax>();
  for (const t of taxes) {
    if (t.abbreviation) byAbbr.set(t.abbreviation.toLowerCase(), t);
    byName.set(t.name.toLowerCase(), t);
  }
  const matched: SalesTax[] = [];
  const unresolved: string[] = [];
  for (const code of codes) {
    const k = code.toLowerCase();
    const t = byAbbr.get(k) ?? byName.get(k);
    if (t) matched.push(t);
    else unresolved.push(code);
  }
  return { matched, unresolved };
}
```

- [ ] **Step 4: Verify pass**

```bash
npm run test -- tests/unit/domain/invoice-templating/resolve-sales-taxes.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/domain/invoice-templating/resolve-sales-taxes.ts tests/unit/domain/invoice-templating/resolve-sales-taxes.test.ts
git commit -m "feat(domain): resolveSalesTaxes by abbreviation or name"
```

---

### Task B14: Payroll split sum validator

**Files:**
- Create: `src/domain/tax/validate-split-sum.ts`
- Create: `tests/unit/domain/tax/validate-split-sum.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/domain/tax/validate-split-sum.test.ts
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { validateSplitSum } from "../../../../src/domain/tax/validate-split-sum.js";

describe("validateSplitSum", () => {
  it("accepts exact match", () => {
    expect(validateSplitSum([3200, 1620], 4820, 0.01)).toEqual({ ok: true });
  });
  it("accepts within tolerance", () => {
    expect(validateSplitSum([3200, 1620.01], 4820, 0.02)).toEqual({ ok: true });
  });
  it("rejects beyond tolerance", () => {
    const r = validateSplitSum([3200, 1620.05], 4820, 0.01);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.delta).toBeCloseTo(0.05, 2);
    }
  });
  it("property: tolerance >= |delta| → ok", () => {
    fc.assert(
      fc.property(
        fc.array(fc.double({ min: 0, max: 1000, noNaN: true }), { minLength: 1, maxLength: 5 }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (parts, tol) => {
          const sum = parts.reduce((a, b) => a + b, 0);
          const r = validateSplitSum(parts, sum, tol);
          expect(r.ok).toBe(true);
        },
      ),
    );
  });
});
```

- [ ] **Step 2: Verify failure**

```bash
npm run test -- tests/unit/domain/tax/validate-split-sum.test.ts
```

- [ ] **Step 3: Implement**

```ts
// src/domain/tax/validate-split-sum.ts
export type SplitValidation =
  | { ok: true }
  | { ok: false; provided_sum: number; expected: number; delta: number; tolerance: number };

export function validateSplitSum(
  parts: number[],
  expected: number,
  tolerance: number,
): SplitValidation {
  const sum = parts.reduce((a, b) => a + b, 0);
  const delta = sum - expected;
  if (Math.abs(delta) <= tolerance) return { ok: true };
  return { ok: false, provided_sum: sum, expected, delta, tolerance };
}
```

- [ ] **Step 4: Verify pass**

```bash
npm run test -- tests/unit/domain/tax/validate-split-sum.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/domain/tax/validate-split-sum.ts tests/unit/domain/tax/validate-split-sum.test.ts
git commit -m "feat(domain): validateSplitSum with property-based tests"
```

---

### Phase B.3 — Workflow composites (Tasks B15–B22)

### Task B15: create_invoice_for_client (composite)

**Files:**
- Create: `src/tools/workflows/create-invoice-for-client.ts`
- Create: `tests/integration/tools/workflows/create-invoice-for-client.test.ts`
- Modify: `src/server/tool-registry.ts`

- [ ] **Step 1: Write the failing integration test**

```ts
// tests/integration/tools/workflows/create-invoice-for-client.test.ts
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { setupServer } from "msw/node";
import { graphql, HttpResponse } from "msw";
import { createInvoiceForClientTool } from "../../../../src/tools/workflows/create-invoice-for-client.js";
import { WaveClient } from "../../../../src/wave/client.js";
import { MockProvider } from "../../../../src/wave/auth/mock.js";
import type { ToolContext } from "../../../../src/server/tool-context.js";

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

describe("create_invoice_for_client", () => {
  it("happy path: alias=acme, quantity=23 → DRAFT created", async () => {
    server.use(
      graphql.query("ListCustomers", () =>
        HttpResponse.json({
          data: {
            business: {
              customers: {
                pageInfo: { currentPage: 1, totalPages: 1, totalCount: 1 },
                edges: [{
                  node: {
                    id: "cust_acme", name: "Acme Inc.", email: "billing@acme.com",
                    currency: { code: "CAD" },
                    internalNotes: `---mcp-wave---
alias: acme
unit: hours
hourly_rate: 95
currency: CAD
default_taxes: [GST, QST]
send_to: [billing@acme.com]
---mcp-wave---`,
                  },
                }],
              },
            },
          },
        })),
      graphql.query("ListSalesTaxes", () =>
        HttpResponse.json({
          data: {
            business: {
              salesTaxes: {
                edges: [
                  { node: { id: "tax_gst", name: "GST", abbreviation: "GST", rate: 0.05 } },
                  { node: { id: "tax_qst", name: "QST", abbreviation: "QST", rate: 0.09975 } },
                ],
              },
            },
          },
        })),
      graphql.mutation("InvoiceCreate", () =>
        HttpResponse.json({
          data: {
            invoiceCreate: {
              didSucceed: true,
              inputErrors: [],
              invoice: {
                id: "inv_1",
                invoiceNumber: "0001",
                status: "DRAFT",
                pdfUrl: "https://wave.example/pdf",
                total: { value: "2512.20" },
                subtotal: { value: "2185" },
                taxTotal: { value: "327.20" },
              },
            },
          },
        })),
    );
    const r = (await createInvoiceForClientTool.handler(
      { alias: "acme", quantity: 23, period_label: "November 2026" },
      ctx(),
    )) as { invoice_id: string; status: string; totals: { total: number } };
    expect(r.invoice_id).toBe("inv_1");
    expect(r.status).toBe("DRAFT");
    expect(r.totals.total).toBeCloseTo(2512.2, 2);
  });

  it("returns ALIAS_NOT_FOUND with available_aliases when alias unknown", async () => {
    server.use(
      graphql.query("ListCustomers", () =>
        HttpResponse.json({
          data: {
            business: {
              customers: {
                pageInfo: { currentPage: 1, totalPages: 1, totalCount: 0 },
                edges: [],
              },
            },
          },
        })),
    );
    await expect(
      createInvoiceForClientTool.handler({ alias: "nope", quantity: 10 }, ctx()),
    ).rejects.toMatchObject({ code: "ALIAS_NOT_FOUND" });
  });
});
```

- [ ] **Step 2: Verify failure**

```bash
npm run test -- tests/integration/tools/workflows/create-invoice-for-client.test.ts
```

- [ ] **Step 3: Implement**

```ts
// src/tools/workflows/create-invoice-for-client.ts
import { z } from "zod";
import { defineTool } from "../../server/define-tool.js";
import { ToolError } from "../../lib/errors.js";
import { throwIfInputErrors } from "../../wave/payload-errors.js";
import { parseProfileFromNotes } from "../../domain/client-profiles/parse-from-notes.js";
import { renderLines } from "../../domain/invoice-templating/render-lines.js";
import { computeInvoiceTotals } from "../../domain/invoice-templating/compute-totals.js";
import { resolveSalesTaxes } from "../../domain/invoice-templating/resolve-sales-taxes.js";
import { plusDays, isoToday } from "../../lib/time.js";

export const createInvoiceForClientTool = defineTool({
  name: "create_invoice_for_client",
  description:
    "Create a DRAFT invoice for a client identified by their mcp-wave alias. Looks up the profile, fills in defaults, computes totals deterministically. NOT idempotent: each call creates a new DRAFT.",
  inputSchema: z.object({
    business_id: z.string().optional(),
    alias: z.string().min(1),
    quantity: z.number().positive(),
    period_label: z.string().optional(),
    invoice_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    override_unit_price: z.number().positive().optional(),
    send_immediately: z.boolean().default(false),
  }),
  async execute(input, ctx) {
    const businessId = input.business_id ?? ctx.env.WAVE_DEFAULT_BUSINESS_ID;
    if (!businessId) throw new ToolError("BUSINESS_ID_REQUIRED", {});

    // 1. Find the customer with matching alias by paging through customers
    let customerId: string | null = null;
    let customerName = "";
    let customerCurrency = "";
    let profile: ReturnType<typeof parseProfileFromNotes> = { kind: "absent" };
    const availableAliases: string[] = [];

    let page = 1;
    while (true) {
      const r = await ctx.wave.listCustomers(ctx.req, { businessId, page, pageSize: 100 });
      if (!r.business) throw new ToolError("BUSINESS_NOT_FOUND", { business_id: businessId });
      for (const edge of r.business.customers.edges) {
        const parsed = parseProfileFromNotes(edge.node.internalNotes);
        if (parsed.kind === "ok") {
          availableAliases.push(parsed.profile.alias);
          if (parsed.profile.alias === input.alias) {
            customerId = edge.node.id;
            customerName = edge.node.name;
            customerCurrency = edge.node.currency.code;
            profile = parsed;
          }
        }
      }
      if (page >= r.business.customers.pageInfo.totalPages) break;
      page++;
    }

    if (!customerId || profile.kind !== "ok") {
      throw new ToolError(
        "ALIAS_NOT_FOUND",
        { alias: input.alias, available_aliases: availableAliases },
        "Use list_client_profiles to see available aliases.",
      );
    }
    if (profile.profile.currency !== customerCurrency) {
      throw new ToolError(
        "CURRENCY_MISMATCH",
        { profile: profile.profile.currency, customer: customerCurrency },
      );
    }

    // 2. Resolve sales tax codes to Wave tax IDs
    const taxList = await ctx.wave.listSalesTaxes(ctx.req, { businessId });
    if (!taxList.business) throw new ToolError("BUSINESS_NOT_FOUND", { business_id: businessId });
    const taxes = taxList.business.salesTaxes.edges.map((e) => ({
      id: e.node.id,
      name: e.node.name,
      abbreviation: e.node.abbreviation,
      rate: Number(e.node.rate),
    }));
    const resolved = resolveSalesTaxes(profile.profile.default_taxes, taxes);
    if (resolved.unresolved.length > 0) {
      throw new ToolError(
        "TAX_CODE_NOT_RESOLVED",
        { unresolved: resolved.unresolved, available: taxes.map((t) => t.abbreviation ?? t.name) },
      );
    }

    // 3. Render lines (pure)
    const renderedLines = renderLines({
      profile: profile.profile,
      quantity: input.quantity,
      period_label: input.period_label,
      override_unit_price: input.override_unit_price,
    });

    // 4. Compute totals (pure, deterministic)
    const totals = computeInvoiceTotals({
      lines: renderedLines.map((l) => ({
        quantity: l.quantity,
        unit_price: l.unit_price,
        tax_codes: l.tax_codes,
      })),
      taxes: resolved.matched.map((t) => ({ code: t.abbreviation ?? t.name, rate: t.rate })),
      currency: customerCurrency,
    });

    // 5. Create the DRAFT
    const today = isoToday();
    const invoiceDate = input.invoice_date ?? today;
    const dueDate = input.due_date ?? plusDays(invoiceDate, profile.profile.payment_terms_days);
    const codeToId = new Map(resolved.matched.map((t) => [t.abbreviation?.toLowerCase() ?? t.name.toLowerCase(), t.id]));
    const created = await ctx.wave.invoiceCreate(ctx.req, {
      input: {
        businessId,
        customerId,
        currency: customerCurrency,
        invoiceDate,
        dueDate,
        memo: profile.profile.invoice_notes,
        items: renderedLines.map((l) => ({
          productId: l.product_id,
          description: l.description,
          quantity: l.quantity,
          unitPrice: String(l.unit_price),
          taxes: l.tax_codes.map((c) => ({ salesTaxId: codeToId.get(c.toLowerCase())! })),
        })),
      },
    });

    try {
      throwIfInputErrors(created.invoiceCreate, "InvoiceCreate");
    } catch (e) {
      throw e; // bubble up; no partial state to report yet (no send attempted)
    }

    const inv = created.invoiceCreate.invoice;
    const result = {
      invoice_id: inv.id,
      invoice_number: inv.invoiceNumber,
      status: inv.status,
      customer: { id: customerId, name: customerName },
      totals,
      pdf_url: inv.pdfUrl,
    };

    // 6. Optional immediate send
    if (input.send_immediately) {
      try {
        const sent = await ctx.wave.invoiceSend(ctx.req, {
          input: {
            invoiceId: inv.id,
            to: profile.profile.send_to,
            ccTo: profile.profile.cc,
            attachPDF: true,
          },
        });
        throwIfInputErrors(sent.invoiceSend, "InvoiceSend");
        return { ...result, status: "SENT" };
      } catch (e) {
        if (e instanceof ToolError) {
          // Surface partial state — DRAFT exists
          throw new ToolError(
            e.code,
            {
              ...e.details,
              step_failed: "send_invoice",
              completed_steps: ["create_invoice"],
              partial_state: { invoice_id: inv.id, status: "DRAFT" },
            },
            "DRAFT was created. Fix the recipient and call send_invoice(invoice_id) directly, or call delete_invoice to abandon.",
          );
        }
        throw e;
      }
    }

    return result;
  },
});
```

- [ ] **Step 4: Register and verify**

```bash
npm run test -- tests/integration/tools/workflows/create-invoice-for-client.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/tools/workflows/create-invoice-for-client.ts src/server/tool-registry.ts \
        tests/integration/tools/workflows/create-invoice-for-client.test.ts
git commit -m "feat(workflows): create_invoice_for_client"
```

---

### Task B16: split_payroll_remittance (composite)

**Files:**
- Create: `src/tools/workflows/split-payroll-remittance.ts`
- Create: `tests/integration/tools/workflows/split-payroll-remittance.test.ts`
- Modify: `src/server/tool-registry.ts`

- [ ] **Step 1: Write the failing integration test**

```ts
// tests/integration/tools/workflows/split-payroll-remittance.test.ts
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { setupServer } from "msw/node";
import { graphql, HttpResponse } from "msw";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { splitPayrollRemittanceTool } from "../../../../src/tools/workflows/split-payroll-remittance.js";
import { WaveClient } from "../../../../src/wave/client.js";
import { MockProvider } from "../../../../src/wave/auth/mock.js";
import { TaxRatesLoader } from "../../../../src/domain/tax/rates-loader.js";
import { AccountMappingLoader } from "../../../../src/domain/tax/account-mapping-loader.js";
import type { ToolContext } from "../../../../src/server/tool-context.js";

const ENDPOINT = "https://gql.waveapps.com/graphql/public";
const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const RATES = `
jurisdiction: CA-QC
year: 2026
effective_from: 2026-01-01
effective_to: 2026-12-31
remittance_authorities:
  - { code: CRA, name: "Receiver General", level: federal }
  - { code: RQ,  name: "Revenu Québec",    level: regional }
payroll_taxes: []
sales_taxes: []
`;

const MAPPING = `
business_id_env: WAVE_DEFAULT_BUSINESS_ID
jurisdiction: CA-QC
remittance_buckets:
  CRA: { payable_account_id: "acct_fed" }
  RQ:  { payable_account_id: "acct_qc" }
`;

function setupCtx(): ToolContext {
  const ratesDir = mkdtempSync(join(tmpdir(), "rates-"));
  writeFileSync(join(ratesDir, "ca-qc-2026.yaml"), RATES);
  const mappingDir = mkdtempSync(join(tmpdir(), "mapping-"));
  writeFileSync(join(mappingDir, "default.yaml"), MAPPING);
  return {
    req: { headers: null, request_id: "t" },
    wave: new WaveClient({ endpoint: ENDPOINT, provider: new MockProvider("x") }),
    taxRates: new TaxRatesLoader(ratesDir),
    accountMapping: new AccountMappingLoader(mappingDir),
    env: { WAVE_DEFAULT_BUSINESS_ID: "biz_x" } as never,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never,
    identity: "mock",
  };
}

describe("split_payroll_remittance", () => {
  it("happy path posts split and returns annotated splits", async () => {
    server.use(
      graphql.query("GetTransaction", () =>
        HttpResponse.json({
          data: {
            business: {
              moneyTransaction: {
                id: "txn_1", date: "2026-11-15", description: "PayrollProvider",
                amount: { value: "-4820" }, account: { id: "bank", name: "Checking" },
                splits: [{ id: "s0", amount: { value: "-4820" }, account: { id: "uncat", name: "Uncategorized" }, memo: null }],
              },
            },
          },
        })),
      graphql.mutation("MoneyTransactionSplit", () =>
        HttpResponse.json({
          data: {
            moneyTransactionSplit: {
              didSucceed: true,
              inputErrors: [],
              transaction: {
                id: "txn_1",
                amount: { value: "-4820" },
                splits: [
                  { id: "s1", amount: { value: "3200" }, account: { id: "acct_fed", name: "Fed payable" }, memo: "Nov 2026 DAS — Receiver General" },
                  { id: "s2", amount: { value: "1620" }, account: { id: "acct_qc", name: "QC payable" }, memo: "Nov 2026 DAS — Revenu Québec" },
                ],
              },
            },
          },
        })),
    );
    const r = (await splitPayrollRemittanceTool.handler(
      {
        transaction_id: "txn_1",
        jurisdiction: "CA-QC",
        period_year: 2026,
        buckets: { CRA: { amount: 3200 }, RQ: { amount: 1620 } },
        memo_prefix: "Nov 2026 DAS",
      },
      setupCtx(),
    )) as { splits: Array<{ amount: number }> };
    expect(r.splits).toHaveLength(2);
  });

  it("rejects when sum doesn't match transaction amount", async () => {
    server.use(
      graphql.query("GetTransaction", () =>
        HttpResponse.json({
          data: {
            business: {
              moneyTransaction: {
                id: "txn_1", date: "2026-11-15", description: "x",
                amount: { value: "-4820" }, account: { id: "bank", name: "Checking" },
                splits: [{ id: "s0", amount: { value: "-4820" }, account: { id: "uncat", name: "Uncategorized" }, memo: null }],
              },
            },
          },
        })),
    );
    await expect(
      splitPayrollRemittanceTool.handler(
        {
          transaction_id: "txn_1",
          jurisdiction: "CA-QC",
          period_year: 2026,
          buckets: { CRA: { amount: 3000 }, RQ: { amount: 1620 } },
        },
        setupCtx(),
      ),
    ).rejects.toMatchObject({ code: "SPLIT_SUM_MISMATCH" });
  });
});
```

- [ ] **Step 2: Verify failure**

```bash
npm run test -- tests/integration/tools/workflows/split-payroll-remittance.test.ts
```

- [ ] **Step 3: Implement**

```ts
// src/tools/workflows/split-payroll-remittance.ts
import { z } from "zod";
import { defineTool } from "../../server/define-tool.js";
import { ToolError } from "../../lib/errors.js";
import { throwIfInputErrors } from "../../wave/payload-errors.js";
import { validateSplitSum } from "../../domain/tax/validate-split-sum.js";

export const splitPayrollRemittanceTool = defineTool({
  name: "split_payroll_remittance",
  description:
    "Split a single payroll-remittance bank transaction into multiple categorization splits, one per remittance authority (federal, regional). DOES NOT compute amounts: caller MUST provide them, typically from a payroll register. Refuses if the sum doesn't match the transaction total within tolerance.",
  inputSchema: z.object({
    business_id: z.string().optional(),
    transaction_id: z.string(),
    jurisdiction: z.string(),
    period_year: z.number().int(),
    buckets: z.record(z.string(), z.object({ amount: z.number().positive(), memo: z.string().optional() })),
    memo_prefix: z.string().default("DAS"),
    tolerance_cents: z.number().int().min(0).default(1),
    force_resplit: z.boolean().default(false),
  }),
  async execute(input, ctx) {
    const businessId = input.business_id ?? ctx.env.WAVE_DEFAULT_BUSINESS_ID;
    if (!businessId) throw new ToolError("BUSINESS_ID_REQUIRED", {});

    // 1. Validate bucket codes against the rates table
    const rates = await ctx.taxRates.load(input.jurisdiction, input.period_year);
    const knownAuth = new Map(rates.remittance_authorities.map((a) => [a.code, a]));
    for (const code of Object.keys(input.buckets)) {
      if (!knownAuth.has(code)) {
        throw new ToolError(
          "UNKNOWN_AUTHORITY_CODE",
          { code, expected: [...knownAuth.keys()] },
        );
      }
    }

    // 2. Validate account mapping
    const mapping = await ctx.accountMapping.load();
    for (const code of Object.keys(input.buckets)) {
      if (!mapping.remittance_buckets[code]?.payable_account_id) {
        throw new ToolError(
          "MISSING_ACCOUNT_MAPPING",
          { authority: code },
          "Run setup_account_mapping or edit data/account-mapping/default.yaml.",
        );
      }
    }

    // 3. Load the transaction
    const txnQuery = await ctx.wave.call(ctx.req, "GetTransaction", { businessId, transactionId: input.transaction_id });
    const txn = txnQuery?.business?.moneyTransaction;
    if (!txn) throw new ToolError("TRANSACTION_NOT_FOUND", { transaction_id: input.transaction_id });
    if (txn.splits.length > 1 && !input.force_resplit) {
      throw new ToolError("ALREADY_SPLIT", { existing_splits: txn.splits.length }, "Pass force_resplit=true to overwrite.");
    }

    // 4. Validate sum vs transaction total
    const total = Math.abs(Number(txn.amount.value));
    const tolerance = input.tolerance_cents / 100;
    const v = validateSplitSum(
      Object.values(input.buckets).map((b) => b.amount),
      total,
      tolerance,
    );
    if (!v.ok) {
      throw new ToolError("SPLIT_SUM_MISMATCH", v);
    }

    // 5. Build splits
    const splits = Object.entries(input.buckets).map(([code, b]) => {
      const auth = knownAuth.get(code)!;
      const acct = mapping.remittance_buckets[code]!.payable_account_id;
      return {
        accountId: acct,
        amount: String(b.amount),
        memo: b.memo ?? `${input.memo_prefix} — ${auth.name}`,
      };
    });

    // 6. Call the split mutation
    const r = await ctx.wave.moneyTransactionSplit(ctx.req, {
      input: {
        businessId,
        transactionId: input.transaction_id,
        splits,
      },
    });
    throwIfInputErrors(r.moneyTransactionSplit, "MoneyTransactionSplit");

    return {
      transaction_id: input.transaction_id,
      total_amount: total,
      splits: r.moneyTransactionSplit.transaction.splits.map((s) => ({
        amount: Number(s.amount.value),
        account_id: s.account.id,
        account_name: s.account.name,
        memo: s.memo,
      })),
      warnings: [] as string[],
    };
  },
});
```

> **Note on `ctx.wave.call`:** the private `call` method on `WaveClient` is currently inaccessible outside the class. Add a public `getTransaction(req, vars)` method in Task B2 (or expose via a new pass-through here) before this test passes. Implementation: `getTransaction(req, vars: SdkArgs<"GetTransaction">) { return this.call(req, "GetTransaction", vars); }`. Adjust the tool to call `ctx.wave.getTransaction(...)`.

- [ ] **Step 4: Register and verify**

```bash
npm run test -- tests/integration/tools/workflows/split-payroll-remittance.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/tools/workflows/split-payroll-remittance.ts src/server/tool-registry.ts \
        tests/integration/tools/workflows/split-payroll-remittance.test.ts src/wave/client.ts
git commit -m "feat(workflows): split_payroll_remittance with deterministic validation"
```

---

### Task B17: setup_account_mapping (composite, interactive)

**Goal:** help the user populate `data/account-mapping/default.yaml` by listing Wave accounts of type `liability`, fuzzy-matching their names against expected authority names from the loaded tax-rates table, and printing the YAML to commit.

**Files:**
- Create: `src/domain/tax/suggest-mapping.ts` (pure)
- Create: `src/tools/workflows/setup-account-mapping.ts`
- Create: tests for both.

```ts
// src/domain/tax/suggest-mapping.ts
export interface AccountLite {
  id: string;
  name: string;
}

export interface AuthorityLite {
  code: string;
  name: string;
}

export function suggestMapping(
  accounts: AccountLite[],
  authorities: AuthorityLite[],
): Array<{ authority_code: string; suggestions: Array<{ account_id: string; account_name: string; score: number }> }> {
  return authorities.map((auth) => {
    const wanted = (auth.name + " " + auth.code).toLowerCase();
    const scored = accounts.map((a) => {
      const score = similarity(a.name.toLowerCase(), wanted);
      return { account_id: a.id, account_name: a.name, score };
    });
    scored.sort((x, y) => y.score - x.score);
    return { authority_code: auth.code, suggestions: scored.slice(0, 3) };
  });
}

function similarity(a: string, b: string): number {
  // Simple token-overlap; replace with real fuzzy if needed
  const at = new Set(a.split(/\W+/).filter(Boolean));
  const bt = new Set(b.split(/\W+/).filter(Boolean));
  let hit = 0;
  for (const t of at) if (bt.has(t)) hit++;
  return hit / Math.max(1, at.size);
}
```

Test the pure function with deterministic fixtures, then write the composite tool that calls `list_accounts` (already implemented in Part A) filtered by `LIABILITY`, calls `get_payroll_rates` to read authorities, runs `suggestMapping`, and **returns** the YAML string for the user to commit (does not write to disk — keeps the runtime stateless).

**Output shape:**

```ts
{
  jurisdiction: "CA-QC",
  yaml: "# data/account-mapping/default.yaml\nbusiness_id_env: ...\nremittance_buckets:\n  CRA:\n    payable_account_id: \"acct_xxx\"\n  RQ:\n    payable_account_id: \"acct_yyy\"\n",
  suggestions: [...]
}
```

**Commit:** `feat(workflows): setup_account_mapping`

---

### Phase B.4 — HTTP transport (Tasks B18–B22)

### Task B18: Origin allowlist middleware

**Files:**
- Create: `src/server/http/origin-allowlist.ts`
- Create: `tests/unit/server/http/origin-allowlist.test.ts`

```ts
// src/server/http/origin-allowlist.ts
import type { MiddlewareHandler } from "hono";

export function originAllowlist(patterns: string[]): MiddlewareHandler {
  const matchers = patterns.map((p) => globToRegex(p));
  return async (c, next) => {
    const origin = c.req.header("origin");
    if (!origin) return next();
    if (!matchers.some((re) => re.test(origin))) {
      return c.json({ error: "ORIGIN_NOT_ALLOWED", origin, allowed: patterns }, 403);
    }
    return next();
  };
}

function globToRegex(p: string): RegExp {
  const escaped = p.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`);
}
```

**Tests:** allow `https://claude.ai`, allow `http://localhost:*`, reject `https://evil.com`.

**Commit:** `feat(http): origin allowlist middleware`

---

### Task B19: Rate limit middleware (in-memory, per-IP)

**Files:** `src/server/http/rate-limit.ts`, test.

In-memory token bucket keyed by `c.req.header("x-forwarded-for") ?? c.env.ip`. Acceptable for v1: when scaled to multiple Cloud Run instances, each enforces its own quota — with min_instances=0 and short-lived requests, this is fine for personal use. Document the limitation.

```ts
// src/server/http/rate-limit.ts
import type { MiddlewareHandler } from "hono";

interface Bucket { tokens: number; updatedAt: number }
const BUCKETS = new Map<string, Bucket>();

export function rateLimit(rpm: number): MiddlewareHandler {
  const refillRate = rpm / 60_000; // tokens per ms
  return async (c, next) => {
    const key = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? "anon";
    const now = Date.now();
    const b = BUCKETS.get(key) ?? { tokens: rpm, updatedAt: now };
    b.tokens = Math.min(rpm, b.tokens + (now - b.updatedAt) * refillRate);
    b.updatedAt = now;
    if (b.tokens < 1) {
      BUCKETS.set(key, b);
      return c.json({ error: "RATE_LIMITED", retry_after_ms: Math.ceil((1 - b.tokens) / refillRate) }, 429);
    }
    b.tokens -= 1;
    BUCKETS.set(key, b);
    return next();
  };
}
```

**Tests:** verify N+1th request in a tight burst is 429.

**Commit:** `feat(http): in-memory per-IP rate limiter`

---

### Task B20: HTTP entrypoint with Streamable HTTP MCP transport

**Files:**
- Modify: `src/entrypoints/http.ts`

> **Spec reference:** MCP Streamable HTTP transport (spec 2025-03-26+) uses POST and SSE on a single endpoint, typically `/mcp`. The official SDK provides `StreamableHTTPServerTransport`.

```ts
// src/entrypoints/http.ts (replacing Part A's healthz-only version)
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { GraphQLClient } from "graphql-request";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { parseEnv } from "../config/env.js";
import { createLogger } from "../config/logger.js";
import { selectProvider } from "../wave/auth/select.js";
import { WaveClient } from "../wave/client.js";
import { TaxRatesLoader } from "../domain/tax/rates-loader.js";
import { AccountMappingLoader } from "../domain/tax/account-mapping-loader.js";
import { buildMcpServer } from "../server/mcp-server.js";
import { allTools } from "../server/tool-registry.js";
import { originAllowlist } from "../server/http/origin-allowlist.js";
import { rateLimit } from "../server/http/rate-limit.js";

const env = parseEnv(process.env);
const logger = createLogger({ level: env.LOG_LEVEL, logPII: env.LOG_PII });
const provider = selectProvider(env);
const wave = new WaveClient({ endpoint: env.WAVE_GRAPHQL_ENDPOINT, provider });
const taxRates = new TaxRatesLoader(resolve("data/tax-rates"));
const accountMapping = new AccountMappingLoader(resolve("data/account-mapping"));

const app = new Hono();
const allowedOrigins = env.ALLOWED_ORIGINS.split(",").map((s) => s.trim());

app.use("*", originAllowlist(allowedOrigins));
app.use("*", rateLimit(env.RATE_LIMIT_RPM));

app.get("/healthz", (c) => c.json({ ok: true }));
app.get("/readyz", async (c) => {
  const issues: string[] = [];
  try { await taxRates.load("CA-QC", new Date().getUTCFullYear()); }
  catch (e) { issues.push(`tax-rates: ${e instanceof Error ? e.message : String(e)}`); }
  try { await new GraphQLClient(env.WAVE_GRAPHQL_ENDPOINT).request("{ __typename }"); }
  catch (e) { issues.push(`wave-schema: ${e instanceof Error ? e.message : String(e)}`); }
  if (issues.length > 0) return c.json({ ok: false, issues }, 503);
  return c.json({ ok: true });
});

app.all("/mcp", async (c) => {
  const requestId = randomUUID();
  const reqCtx = { headers: c.req.raw.headers, request_id: requestId };
  const identity = await provider.getIdentity(reqCtx).catch(() => "unknown");
  logger.info({ request_id: requestId, identity }, "mcp request");
  const { server } = buildMcpServer({
    tools: allTools(),
    makeCtx: () => ({
      req: reqCtx,
      wave,
      taxRates,
      accountMapping,
      env,
      logger: logger.child({ request_id: requestId }),
      identity,
    }),
  });
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
  });
  await server.connect(transport);
  return transport.handleRequest(c.req.raw, c.res);
});

if (process.env.NODE_ENV !== "test") {
  const port = Number(process.env.PORT ?? 8080);
  serve({ fetch: app.fetch, port }, () => {
    logger.info({ port, tools: allTools().length }, "mcp-wave http ready");
  });
}

export { app };
```

> **Caveat:** `StreamableHTTPServerTransport.handleRequest` expects `(IncomingMessage, ServerResponse)` from Node's `http`. Hono's `c.req.raw` is a Fetch `Request` and `c.res` may not exist in this form. The integration test in Task B21 will surface any mismatch — adjust by using `serve` with a request handler that bridges Hono into the MCP transport, or use `app.use` to pass through the raw Node request/response. If needed, install `@hono/node-server`'s adapter helpers and access the raw Node objects via Hono's context.

**Commit:** `feat(http): Streamable HTTP MCP transport with allowlist and rate limit`

---

### Task B21: HTTP integration test (Streamable HTTP)

**File:** `tests/integration/entrypoints/http.mcp.test.ts`

Spawn the Hono app via `serve` on an ephemeral port. Send an `initialize` + `tools/list` request via fetch (POST + SSE). Assert the response carries the tools list.

If the StreamableHTTPServerTransport API requires a Node server directly (not a Fetch adapter), the test boots the entrypoint as a subprocess and uses fetch against `http://localhost:<port>/mcp`.

**Commit:** `test(http): MCP HTTP transport integration test`

---

### Task B22: Auth selection in HTTP entrypoint

The `http.ts` already calls `selectProvider(env)` once at boot. Verify behavior:

1. With `WAVE_AUTH_MODE=env_token` and `WAVE_API_TOKEN` set → `EnvTokenProvider` used; requests succeed even without `Authorization` header.
2. With `WAVE_AUTH_MODE=bearer_passthrough` (no `WAVE_API_TOKEN`) → `BearerHeaderProvider`; requests without `Authorization: Bearer` get `AUTH_BEARER_MISSING`.

Add tests for both. Also verify that the `identity` propagated to logs is `bearer:<sha-prefix>` in passthrough mode and `env-default` in env mode.

**Commit:** `test(http): auth selection per-mode`

---

### Phase B.5 — Wrap-up (Tasks B23–B30)

### Task B23: revisit `mark_invoice_paid` with proper composition

Now that `match_transaction_to_invoice` exists, replace the `NOT_IMPLEMENTED` body of `mark_invoice_paid`:

1. Create a `MoneyTransaction` of type `INCOME` against `bank_account_id` for `amount` on `paid_at` (operation `MoneyTransactionCreate` — add to `transactions.gql` if not present).
2. Call `match_transaction_to_invoice` with the new transaction id.
3. Return `{ invoice_id, transaction_id, amount, paid_at }`.

Document: NOT idempotent.

**Commit:** `feat(tools): mark_invoice_paid implementation`

---

### Task B24: vendors and v1.1 placeholders

`list_vendors` already in Part A. Confirm the registry includes it. Skip update_invoice / update_customer / duplicate_invoice / general_ledger / reconcile_unmatched / monthly_close_checklist (v1.1 backlog per spec §15).

**Commit:** none unless registry was missing entries.

---

### Task B25: Final tool catalog smoke test

**File:** `tests/integration/server/registry.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { allTools } from "../../../src/server/tool-registry.js";

describe("tool registry", () => {
  it("registers all v1 tools", () => {
    const names = allTools().map((t) => t.name).sort();
    expect(names).toEqual([
      "categorize_transaction",
      "create_customer",
      "create_invoice",
      "create_invoice_for_client",
      "delete_invoice",
      "download_invoice_pdf",
      "get_account",
      "get_customer",
      "get_invoice",
      "get_payroll_rates",
      "get_transaction",
      "list_accounts",
      "list_businesses",
      "list_client_profiles",
      "list_customers",
      "list_invoices",
      "list_products",
      "list_transactions",
      "list_vendors",
      "balance_sheet",
      "mark_invoice_paid",
      "match_transaction_to_invoice",
      "profit_and_loss",
      "send_invoice",
      "setup_account_mapping",
      "split_payroll_remittance",
      "split_transaction",
      "upsert_product",
    ].sort());
  });

  it("each tool has a non-trivial description", () => {
    for (const t of allTools()) {
      expect(t.description.length).toBeGreaterThan(20);
    }
  });
});
```

**Commit:** `test: registry has all v1 tools`

---

### Task B26: Coverage gate verification

Run `npm run coverage` and confirm:

- `src/domain/**`: 100% (or ≥95% with documented gaps).
- `src/wave/**` excluding `generated/`: ≥90%.
- `src/tools/**`: ≥85%.
- Global: ≥85%.

If any gate fails, add tests for the under-covered files until thresholds pass.

**Commit:** `chore: bring coverage above thresholds`

---

### Task B27: Update README quick-start

Add a "tools" section listing the v1 tools, an example Claude Desktop config for stdio, and an example HTTP curl call.

**Commit:** `docs: README quick-start with v1 tool catalog`

---

### Task B28: Tag the milestone

```bash
npm run check
git tag -a v0.2.0-part-b -m "Part B: full v1 functionality including workflows"
```

---

### Task B29: Part B self-review

Verify before declaring Part B done:

- [ ] `npm run check` is green.
- [ ] All 28 v1 tools registered (Task B25 test passes).
- [ ] `create_invoice_for_client` happy path works in stdio against a Wave sandbox business (manual smoke).
- [ ] `split_payroll_remittance` validates sum, refuses re-split without flag, posts the splits.
- [ ] HTTP `/mcp` returns the same tool list as stdio.
- [ ] Coverage gates pass.

---

### Task B30: Open issues / follow-ups doc

Create `docs/superpowers/follow-ups.md` listing any Wave schema mismatches found during introspection, deferred v1.1 items, and any TODOs surfaced by integration tests.

**Commit:** `docs: open follow-ups after Part B`

---

## Part C — Multi-cloud deployment

> **Prereq:** Part B merged and tagged `v0.2.0-part-b`. The HTTP entrypoint with Streamable HTTP MCP transport works locally.

> **Goal of Part C:** ship the same Docker image to GCP Cloud Run (validation) and Scaleway Containers (production), with TypeScript scripts wrapping `gcloud` and `scw` CLIs. No Terraform.

### Phase C.0 — Image and ignores (Tasks C1–C2)

### Task C1: Dockerfile multi-stage

**Files:**
- Create: `Dockerfile`

```dockerfile
# Dockerfile
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY codegen.yml tsconfig.json tsconfig.build.json biome.json ./
COPY src/ src/
COPY data/wave-schema.graphql data/wave-schema.graphql
RUN npm run codegen && npm run build

FROM gcr.io/distroless/nodejs22-debian12 AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps  /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY data/ ./data/
EXPOSE 8080
CMD ["dist/entrypoints/http.js"]
```

- [ ] **Step 1: Build locally**

```bash
docker build -t mcp-wave:dev .
```

Expected: image builds, final size ~120 MB (`docker images mcp-wave`).

- [ ] **Step 2: Smoke run**

```bash
docker run --rm -p 8080:8080 \
  -e WAVE_AUTH_MODE=mock \
  -e WAVE_API_TOKEN=fake \
  -e WAVE_DEFAULT_BUSINESS_ID=biz_x \
  -e WAVE_GRAPHQL_ENDPOINT=https://example.invalid/graphql \
  mcp-wave:dev &
sleep 2
curl -fsS http://localhost:8080/healthz
docker kill $(docker ps -q --filter ancestor=mcp-wave:dev)
```

Expected: `{"ok":true}`.

- [ ] **Step 3: Commit**

```bash
git add Dockerfile
git commit -m "feat(deploy): multi-stage distroless Dockerfile"
```

---

### Task C2: .dockerignore

```
node_modules
dist
coverage
.env
.env.*
!.env.example
.git
.github
docs
tests
**/*.test.ts
README.md
```

- [ ] **Step 1: Create the file**
- [ ] **Step 2: Rebuild and confirm context size shrinks**

```bash
docker build -t mcp-wave:dev . 2>&1 | grep "transferring context"
```

Expected: context size in MB rather than GB (no `node_modules` copied).

- [ ] **Step 3: Commit**

```bash
git add .dockerignore
git commit -m "chore: dockerignore"
```

---

### Phase C.1 — Deploy script library (Tasks C3–C5)

### Task C3: Deploy env Zod schema

**Files:**
- Create: `scripts/lib/deploy-env.ts`
- Create: `tests/unit/scripts/deploy-env.test.ts`
- Create: `.deploy.env.example`

```ts
// scripts/lib/deploy-env.ts
import { z } from "zod";

export const DeployEnvSchema = z.object({
  // shared
  IMAGE_NAME: z.string().default("mcp-wave"),
  IMAGE_TAG: z.string().default("dev"),

  // GCP
  GCP_PROJECT: z.string().min(1).optional(),
  GCP_REGION: z.string().default("europe-west9"),
  GCP_AR_REPO: z.string().default("mcp-wave"),
  GCP_SERVICE: z.string().default("mcp-wave"),
  GCP_SA_EMAIL: z.string().email().optional(),

  // Scaleway
  SCW_ORGANIZATION_ID: z.string().min(1).optional(),
  SCW_PROJECT_ID: z.string().min(1).optional(),
  SCW_REGION: z.string().default("fr-par"),
  SCW_NAMESPACE_ID: z.string().optional(),
  SCW_REGISTRY_NAMESPACE: z.string().default("mcp-wave"),
  SCW_CONTAINER_NAME: z.string().default("mcp-wave"),

  // App
  WAVE_AUTH_MODE: z.enum(["env_token", "bearer_passthrough", "mock"]),
  WAVE_DEFAULT_BUSINESS_ID: z.string().min(1),
  WAVE_GRAPHQL_ENDPOINT: z.string().url().default("https://gql.waveapps.com/graphql/public"),
  ALLOWED_ORIGINS: z.string().default("https://claude.ai"),
  RATE_LIMIT_RPM: z.coerce.number().int().positive().default(60),
  LOG_LEVEL: z.string().default("info"),
});

export type DeployEnv = z.infer<typeof DeployEnvSchema>;

export function loadDeployEnv(source: Record<string, string | undefined> = process.env): DeployEnv {
  const parsed = DeployEnvSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("\n  ");
    throw new Error(`Invalid deploy env:\n  ${issues}`);
  }
  return parsed.data;
}
```

```
# .deploy.env.example
# copy to .deploy.env (gitignored) and fill in
IMAGE_NAME=mcp-wave
IMAGE_TAG=dev

GCP_PROJECT=my-gcp-project
GCP_REGION=europe-west9
GCP_AR_REPO=mcp-wave
GCP_SERVICE=mcp-wave

SCW_PROJECT_ID=00000000-0000-0000-0000-000000000000
SCW_REGION=fr-par
SCW_REGISTRY_NAMESPACE=mcp-wave
SCW_CONTAINER_NAME=mcp-wave

WAVE_AUTH_MODE=env_token
WAVE_DEFAULT_BUSINESS_ID=biz_xxx
WAVE_GRAPHQL_ENDPOINT=https://gql.waveapps.com/graphql/public
ALLOWED_ORIGINS=https://claude.ai
RATE_LIMIT_RPM=60
LOG_LEVEL=info
```

**Test:** validates the schema rejects missing `WAVE_AUTH_MODE` and accepts the example shape.

**Commit:** `feat(deploy): deploy env schema`

---

### Task C4: Shell helper

**File:** `scripts/lib/shell.ts`

```ts
// scripts/lib/shell.ts
import { execa, type Options } from "execa";

export async function sh(cmd: string, args: string[] = [], opts?: Options): Promise<string> {
  const r = await execa(cmd, args, { stdio: ["inherit", "pipe", "pipe"], ...opts });
  if (r.stderr) process.stderr.write(r.stderr);
  return r.stdout?.toString() ?? "";
}

export async function shInteractive(cmd: string, args: string[] = []): Promise<void> {
  await execa(cmd, args, { stdio: "inherit" });
}

export async function which(cmd: string): Promise<boolean> {
  try {
    await execa("sh", ["-c", `command -v ${cmd}`]);
    return true;
  } catch {
    return false;
  }
}
```

**Commit:** `feat(deploy): shell helper`

---

### Task C5: Steps helper

**File:** `scripts/lib/steps.ts`

```ts
// scripts/lib/steps.ts
const t0 = Date.now();
function elapsed(): string {
  return `+${((Date.now() - t0) / 1000).toFixed(1)}s`;
}

export async function step<T>(label: string, fn: () => Promise<T>): Promise<T> {
  process.stdout.write(`▸ ${label} ... `);
  try {
    const result = await fn();
    process.stdout.write(`✓ ${elapsed()}\n`);
    return result;
  } catch (e) {
    process.stdout.write(`✗ ${elapsed()}\n`);
    process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
    throw e;
  }
}
```

**Commit:** `feat(deploy): step runner`

---

### Phase C.2 — Build and push (Tasks C6–C7)

### Task C6: build-image script

**File:** `scripts/build-image.ts`

```ts
// scripts/build-image.ts
import { sh } from "./lib/shell.js";
import { step } from "./lib/steps.js";
import { loadDeployEnv } from "./lib/deploy-env.js";
import { execaCommand } from "execa";

async function main(): Promise<void> {
  const env = loadDeployEnv();
  const sha = await step("git short sha", async () =>
    (await execaCommand("git rev-parse --short HEAD")).stdout.trim(),
  );
  const tag = `${env.IMAGE_NAME}:${sha}`;

  await step(`docker build → ${tag}`, async () => {
    await sh("docker", ["build", "-t", tag, "."]);
  });

  await step("tag :latest", async () => {
    await sh("docker", ["tag", tag, `${env.IMAGE_NAME}:latest`]);
  });

  process.stdout.write(`\nBuilt: ${tag}\n`);
  process.stdout.write(`(also tagged ${env.IMAGE_NAME}:latest)\n`);
}

main().catch((e) => {
  process.stderr.write(`build-image failed: ${e}\n`);
  process.exit(1);
});
```

Add to `package.json` scripts:

```json
"build:image": "tsx scripts/build-image.ts"
```

**Commit:** `feat(deploy): build-image script`

---

### Task C7: deploy-gcp script (a.k.a. deploy:test)

**File:** `scripts/deploy-gcp.ts`

```ts
// scripts/deploy-gcp.ts
import { sh, which } from "./lib/shell.js";
import { step } from "./lib/steps.js";
import { loadDeployEnv } from "./lib/deploy-env.js";
import { execaCommand } from "execa";

async function main(): Promise<void> {
  const env = loadDeployEnv();
  if (!env.GCP_PROJECT) {
    throw new Error("GCP_PROJECT required");
  }
  if (!(await which("gcloud"))) {
    throw new Error("gcloud not installed. See https://cloud.google.com/sdk/docs/install");
  }
  if (!(await which("docker"))) {
    throw new Error("docker not installed");
  }

  const sha = (await execaCommand("git rev-parse --short HEAD")).stdout.trim();
  const localTag = `${env.IMAGE_NAME}:${sha}`;
  const arHost = `${env.GCP_REGION}-docker.pkg.dev`;
  const arImage = `${arHost}/${env.GCP_PROJECT}/${env.GCP_AR_REPO}/${env.IMAGE_NAME}:${sha}`;

  await step("docker auth GCP", async () => {
    await sh("gcloud", ["auth", "configure-docker", arHost, "--quiet"]);
  });

  await step("ensure AR repo exists", async () => {
    try {
      await sh("gcloud", ["artifacts", "repositories", "describe", env.GCP_AR_REPO, "--project", env.GCP_PROJECT!, "--location", env.GCP_REGION]);
    } catch {
      await sh("gcloud", ["artifacts", "repositories", "create", env.GCP_AR_REPO,
        "--repository-format=docker",
        `--location=${env.GCP_REGION}`,
        `--project=${env.GCP_PROJECT}`,
      ]);
    }
  });

  await step(`tag ${arImage}`, async () => {
    await sh("docker", ["tag", localTag, arImage]);
  });

  await step("push to AR", async () => {
    await sh("docker", ["push", arImage]);
  });

  const envVars = [
    `WAVE_AUTH_MODE=${env.WAVE_AUTH_MODE}`,
    `WAVE_DEFAULT_BUSINESS_ID=${env.WAVE_DEFAULT_BUSINESS_ID}`,
    `WAVE_GRAPHQL_ENDPOINT=${env.WAVE_GRAPHQL_ENDPOINT}`,
    `ALLOWED_ORIGINS=${env.ALLOWED_ORIGINS}`,
    `RATE_LIMIT_RPM=${env.RATE_LIMIT_RPM}`,
    `LOG_LEVEL=${env.LOG_LEVEL}`,
  ].join(",");

  await step("gcloud run deploy", async () => {
    const args = [
      "run", "deploy", env.GCP_SERVICE,
      `--image=${arImage}`,
      `--region=${env.GCP_REGION}`,
      `--project=${env.GCP_PROJECT}`,
      "--platform=managed",
      "--cpu=1",
      "--memory=512Mi",
      "--concurrency=80",
      "--timeout=60s",
      "--min-instances=0",
      "--max-instances=5",
      "--no-allow-unauthenticated",
      `--set-env-vars=${envVars}`,
      "--set-secrets=WAVE_API_TOKEN=wave-api-token:latest",
    ];
    if (env.GCP_SA_EMAIL) args.push(`--service-account=${env.GCP_SA_EMAIL}`);
    await sh("gcloud", args);
  });

  await step("verify /healthz", async () => {
    const url = (await sh("gcloud", [
      "run", "services", "describe", env.GCP_SERVICE,
      `--region=${env.GCP_REGION}`,
      `--project=${env.GCP_PROJECT}`,
      "--format=value(status.url)",
    ])).trim();
    process.stdout.write(`  service URL: ${url}\n`);
    // /healthz is unauthenticated by default if --no-allow-unauthenticated set,
    // we ping it via gcloud run services proxy instead in CI; manual smoke ok.
  });

  process.stdout.write(`\nDeployed to GCP: ${arImage}\n`);
}

main().catch((e) => {
  process.stderr.write(`deploy-gcp failed: ${e}\n`);
  process.exit(1);
});
```

Add to `package.json`:

```json
"deploy:test": "tsx scripts/deploy-gcp.ts"
```

**Commit:** `feat(deploy): GCP Cloud Run deploy script (deploy:test)`

---

### Task C8: deploy-scaleway script (a.k.a. deploy:prod)

**File:** `scripts/deploy-scaleway.ts`

```ts
// scripts/deploy-scaleway.ts
import { sh, which } from "./lib/shell.js";
import { step } from "./lib/steps.js";
import { loadDeployEnv } from "./lib/deploy-env.js";
import { execaCommand } from "execa";

async function main(): Promise<void> {
  const env = loadDeployEnv();
  if (!env.SCW_PROJECT_ID) throw new Error("SCW_PROJECT_ID required");
  if (!(await which("scw"))) throw new Error("scw not installed. See https://www.scaleway.com/en/cli/");
  if (!(await which("docker"))) throw new Error("docker not installed");

  const sha = (await execaCommand("git rev-parse --short HEAD")).stdout.trim();
  const localTag = `${env.IMAGE_NAME}:${sha}`;
  const registryHost = `rg.${env.SCW_REGION}.scw.cloud`;
  const remoteTag = `${registryHost}/${env.SCW_REGISTRY_NAMESPACE}/${env.IMAGE_NAME}:${sha}`;

  await step("scw registry login", async () => {
    const token = (await sh("scw", ["registry", "login", "-o", "json"])).trim();
    // alternatively use docker login with stored credentials
    process.stdout.write(`  registry login token acquired (${token.length} chars)\n`);
  });

  await step("ensure registry namespace", async () => {
    try {
      await sh("scw", ["registry", "namespace", "list", `name=${env.SCW_REGISTRY_NAMESPACE}`, `region=${env.SCW_REGION}`]);
    } catch {
      await sh("scw", ["registry", "namespace", "create", `name=${env.SCW_REGISTRY_NAMESPACE}`, `region=${env.SCW_REGION}`, `project-id=${env.SCW_PROJECT_ID}`]);
    }
  });

  await step(`tag ${remoteTag}`, async () => {
    await sh("docker", ["tag", localTag, remoteTag]);
  });

  await step("push to SCR", async () => {
    await sh("docker", ["push", remoteTag]);
  });

  await step("ensure container namespace", async () => {
    if (!env.SCW_NAMESPACE_ID) {
      const out = await sh("scw", ["container", "namespace", "create",
        `name=${env.SCW_CONTAINER_NAME}-ns`,
        `project-id=${env.SCW_PROJECT_ID}`,
        `region=${env.SCW_REGION}`,
        "-o", "json",
      ]);
      const ns = JSON.parse(out);
      process.stdout.write(`  created namespace ${ns.id}\n`);
      env.SCW_NAMESPACE_ID = ns.id;
    }
  });

  await step("scw container deploy", async () => {
    // Either create or update; idempotent by name within namespace
    const cmd = [
      "container", "container", "deploy",
      `name=${env.SCW_CONTAINER_NAME}`,
      `namespace-id=${env.SCW_NAMESPACE_ID}`,
      `registry-image=${remoteTag}`,
      "min-scale=0",
      "max-scale=5",
      "cpu-limit=1000",
      "memory-limit=512",
      "privacy=private",
      "port=8080",
      `region=${env.SCW_REGION}`,
      `environment-variables.WAVE_AUTH_MODE=${env.WAVE_AUTH_MODE}`,
      `environment-variables.WAVE_DEFAULT_BUSINESS_ID=${env.WAVE_DEFAULT_BUSINESS_ID}`,
      `environment-variables.WAVE_GRAPHQL_ENDPOINT=${env.WAVE_GRAPHQL_ENDPOINT}`,
      `environment-variables.ALLOWED_ORIGINS=${env.ALLOWED_ORIGINS}`,
      `environment-variables.RATE_LIMIT_RPM=${env.RATE_LIMIT_RPM}`,
      `environment-variables.LOG_LEVEL=${env.LOG_LEVEL}`,
      "secret-environment-variables.0.key=WAVE_API_TOKEN",
      "secret-environment-variables.0.value=@wave-api-token",
    ];
    await sh("scw", cmd);
  });

  process.stdout.write(`\nDeployed to Scaleway: ${remoteTag}\n`);
}

main().catch((e) => {
  process.stderr.write(`deploy-scaleway failed: ${e}\n`);
  process.exit(1);
});
```

> **Note:** the `scw container container deploy` command surface evolves; verify against `scw container container deploy --help` and adjust flag names if needed. The above reflects the documented form as of 2025.

Add to `package.json`:

```json
"deploy:prod": "tsx scripts/deploy-scaleway.ts"
```

**Commit:** `feat(deploy): Scaleway Containers deploy script (deploy:prod)`

---

### Task C9: secrets-put script

**File:** `scripts/secrets-put.ts`

Uploads `WAVE_API_TOKEN` to **both** GCP Secret Manager and Scaleway Secret Manager. Reads token from stdin to avoid command-line history exposure.

```ts
// scripts/secrets-put.ts
import { execa } from "execa";
import { step } from "./lib/steps.js";
import { loadDeployEnv } from "./lib/deploy-env.js";
import { which } from "./lib/shell.js";

async function readStdin(): Promise<string> {
  process.stdout.write("Paste WAVE_API_TOKEN, then ENTER + Ctrl-D:\n");
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8").trim();
}

async function main(): Promise<void> {
  const env = loadDeployEnv();
  const token = await readStdin();
  if (!token) throw new Error("empty token");

  if (env.GCP_PROJECT && (await which("gcloud"))) {
    await step("GCP secret upsert", async () => {
      try {
        await execa("gcloud", ["secrets", "describe", "wave-api-token", `--project=${env.GCP_PROJECT}`]);
      } catch {
        await execa("gcloud", ["secrets", "create", "wave-api-token", "--replication-policy=automatic", `--project=${env.GCP_PROJECT}`]);
      }
      await execa("gcloud", ["secrets", "versions", "add", "wave-api-token", "--data-file=-", `--project=${env.GCP_PROJECT}`], {
        input: token,
      });
    });
  }

  if (env.SCW_PROJECT_ID && (await which("scw"))) {
    await step("Scaleway secret upsert", async () => {
      try {
        await execa("scw", ["secret", "secret", "list", "name=wave-api-token", `region=${env.SCW_REGION}`, `project-id=${env.SCW_PROJECT_ID}`]);
      } catch {
        await execa("scw", ["secret", "secret", "create", "name=wave-api-token", `region=${env.SCW_REGION}`, `project-id=${env.SCW_PROJECT_ID}`]);
      }
      // versions are idempotent via upload from stdin; specifics depend on scw CLI version
      await execa("scw", ["secret", "version", "create", "secret-name=wave-api-token", `region=${env.SCW_REGION}`, "data-from-stdin=true"], {
        input: token,
      });
    });
  }

  process.stdout.write("Token uploaded.\n");
}

main().catch((e) => {
  process.stderr.write(`secrets-put failed: ${e}\n`);
  process.exit(1);
});
```

Add to `package.json`:

```json
"secrets:put": "tsx scripts/secrets-put.ts"
```

**Commit:** `feat(deploy): secrets-put script for both clouds`

---

### Task C10: promote script

**File:** `scripts/promote.ts`

Takes a SHA already deployed and validated on GCP, fetches it from GCP Artifact Registry, retags and pushes to Scaleway Container Registry, then runs the Scaleway deploy with that exact SHA.

```ts
// scripts/promote.ts
import { sh, which } from "./lib/shell.js";
import { step } from "./lib/steps.js";
import { loadDeployEnv } from "./lib/deploy-env.js";
import { parseArgs } from "node:util";

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { sha: { type: "string" } } });
  const sha = values.sha;
  if (!sha) throw new Error("--sha=<git short sha> required");
  const env = loadDeployEnv();
  if (!env.GCP_PROJECT || !env.SCW_PROJECT_ID) throw new Error("Both GCP and Scaleway env required");

  const arImage = `${env.GCP_REGION}-docker.pkg.dev/${env.GCP_PROJECT}/${env.GCP_AR_REPO}/${env.IMAGE_NAME}:${sha}`;
  const scwImage = `rg.${env.SCW_REGION}.scw.cloud/${env.SCW_REGISTRY_NAMESPACE}/${env.IMAGE_NAME}:${sha}`;

  await step("pull from AR", () => sh("docker", ["pull", arImage]));
  await step("retag → SCR", () => sh("docker", ["tag", arImage, scwImage]));
  await step("scw registry login", () => sh("scw", ["registry", "login"]));
  await step("push → SCR", () => sh("docker", ["push", scwImage]));
  await step("scw container deploy with promoted SHA", async () => {
    process.env.IMAGE_TAG = sha;
    await sh("npx", ["tsx", "scripts/deploy-scaleway.ts"]);
  });
  process.stdout.write(`\nPromoted ${sha} from GCP → Scaleway.\n`);
}

main().catch((e) => {
  process.stderr.write(`promote failed: ${e}\n`);
  process.exit(1);
});
```

Add to `package.json`:

```json
"deploy:promote": "tsx scripts/promote.ts"
```

**Commit:** `feat(deploy): promote validated SHA from GCP to Scaleway`

---

### Task C11: logs scripts

**Files:**
- `scripts/logs-gcp.ts`: wraps `gcloud run services logs tail mcp-wave --region=...`
- `scripts/logs-scaleway.ts`: wraps `scw container container logs <id>` (resolves container id by name first)

Both ~25 lines each. Add scripts:

```json
"logs:test": "tsx scripts/logs-gcp.ts",
"logs:prod": "tsx scripts/logs-scaleway.ts"
```

**Commit:** `feat(deploy): logs tailing scripts for both clouds`

---

### Phase C.3 — Runbooks (Tasks C12–C14)

### Task C12: GCP first deploy runbook

**File:** `docs/runbooks/01-gcp-first-deploy.md`

Step-by-step the user follows the first time they run `npm run deploy:test`. Includes:

1. Install `gcloud` CLI.
2. `gcloud auth login` and `gcloud config set project <id>`.
3. Enable APIs: `gcloud services enable run.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com`.
4. Create `.deploy.env` from `.deploy.env.example`.
5. Upload the Wave token: `npm run secrets:put`.
6. Build: `npm run build:image`.
7. Deploy: `npm run deploy:test`.
8. Smoke: `gcloud run services proxy mcp-wave --region=$GCP_REGION` and `curl http://localhost:8080/healthz`.
9. (Phase 1 only) connect Claude Desktop locally to the same image via stdio + Wave token, confirm tool list.

**Commit:** `docs(runbook): GCP first deploy`

---

### Task C13: Scaleway first deploy runbook

**File:** `docs/runbooks/02-scaleway-first-deploy.md`

Same shape as C12, adapted for Scaleway:

1. Install `scw` CLI; run `scw init`.
2. Enable Container, Container Registry, and Secret Manager features in the project.
3. Update `.deploy.env` with `SCW_PROJECT_ID` etc.
4. `npm run secrets:put` (uploads to both clouds).
5. `npm run build:image && npm run deploy:prod`.
6. Note the container public URL from the output. With `privacy=private`, requests need an auth token in the request — adjust to `privacy=public` if exposing as a Claude Connector with bearer auth at the app layer.

**Commit:** `docs(runbook): Scaleway first deploy`

---

### Task C14: Cutover runbook (Phase 1 → Phase 2)

**File:** `docs/runbooks/03-cutover-to-scaleway.md`

Once GCP test is stable for ≥3 days:

1. Deploy current SHA to GCP: `npm run deploy:test`.
2. Smoke: tool list, `create_invoice_for_client` happy path, `split_payroll_remittance` validation refusal.
3. Promote: `npm run deploy:promote -- --sha=<sha>`.
4. Smoke Scaleway: same checks.
5. Update Claude Desktop / Claude Connector configuration to point at the Scaleway URL.
6. Optional: scale GCP to `min-instances=0` and stop deploying there until needed for risky changes.

**Commit:** `docs(runbook): cutover GCP → Scaleway`

---

### Phase C.4 — CI and final wrap-up (Tasks C15–C18)

### Task C15: GitHub Actions workflow

**File:** `.github/workflows/ci.yml`

```yaml
name: ci
on:
  push:
    branches: [main]
  pull_request:

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: "npm" }
      - run: npm ci
      - run: npm run codegen
      - run: npm run lint
      - run: npm run typecheck
      - run: npm run test
      - run: npm run coverage
      - uses: actions/upload-artifact@v4
        with: { name: coverage, path: coverage/ }

  build-image:
    needs: check
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: docker/setup-buildx-action@v3
      - run: docker build -t mcp-wave:${{ github.sha }} .
      # No push on PRs; main-branch push handled by separate manual deploy
```

**Commit:** `ci: lint+typecheck+test+coverage+build on PR`

---

### Task C16: Cost monitoring note

**File:** `docs/runbooks/04-cost-monitoring.md`

Brief reminder that scale-to-zero on both clouds keeps idle cost at ~$0/mo. Outlines what to check monthly:

- Cloud Run: billing console → Cloud Run line.
- Scaleway: console → Containers usage page.
- Container Registries: prune old image SHAs once per quarter.

**Commit:** `docs(runbook): cost monitoring`

---

### Task C17: README update with full quick-start

**File:** `README.md`

Replace the stub with a complete README:

- What it is, link to spec.
- Local quick-start (stdio with Claude Desktop).
- Deploy quick-start (GCP, Scaleway).
- Tool catalog table.
- Status & roadmap.

**Commit:** `docs: README with deployment and tool catalog`

---

### Task C18: Tag v1.0.0

```bash
npm run check
git tag -a v1.0.0 -m "v1.0: full v1 functionality, deployed to both clouds"
```

Verify before tag:

- [ ] GCP test deploy ran successfully (Task C12).
- [ ] Scaleway prod deploy ran successfully (Task C13).
- [ ] `promote.ts` exercised at least once.
- [ ] CI green on the commit.
- [ ] Cost monitoring runbook reviewed.

---

## Final Self-Review (whole plan)

Run through this list once Parts A, B, C are all merged:

- [ ] **Spec coverage:** every section of `docs/superpowers/specs/2026-05-09-mcp-wave-design.md` has a corresponding task or set of tasks.
  - §4 architecture → covered by Parts A.4 + B.4 entrypoints.
  - §5 project structure → A.0–A.7.
  - §6 stack → A.0 task A2.
  - §7 tool catalog → A.5 + B.1 + B.3 (all 28 v1 tools registered).
  - §8 data model → A.2 (schemas, parser, sample fixture).
  - §9 create_invoice_for_client → B.3 task B15.
  - §10 split_payroll_remittance → B.3 task B16.
  - §11 auth pluggability → A.3 + B.4.
  - §12 error handling & idempotency → A.1 + A.4 + per-tool descriptions.
  - §13 testing strategy → throughout (≥85% coverage gate verified).
  - §14 deployment topology → Part C.
  - §15 milestones → mapped to Parts A/B/C and v1.1 backlog noted.
- [ ] **Type consistency:** types referenced in later tasks match earlier definitions (e.g., `ClientProfile` type imported consistently, `ToolContext` used in every tool handler).
- [ ] **No placeholders:** scan for "TBD", "TODO", "implement later" — none expected outside the explicitly documented Wave-schema caveats.
- [ ] **Open dependency:** Wave API access (Task #1 in the brainstorm task list) confirmed before starting Phase B.0 Task B1 (when introspection is run).

---

## Out of scope for this plan (v1.1 backlog)

Per spec §15:

- `update_invoice`, `update_customer`, `duplicate_invoice` (mutations exist; just not in v1).
- `general_ledger` (pagination edge cases).
- `reconcile_unmatched` and `monthly_close_checklist` (more involved composites).
- `/metrics` Prometheus endpoint.
- Custom domain mapping for Cloud Run / Scaleway.
- Detailed-mode payroll splits (per-tax mapping in `tax_code_to_account`).
- OAuth Resource Server option (C.2 path) — JWKS validation, `/.well-known/oauth-protected-resource`.

These are next-plan candidates, not blockers for v1.

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-09-mcp-wave-implementation.md`. Two execution options:

1. **Subagent-driven (recommended)** — dispatch a fresh subagent per task, review between tasks. Best for keeping context windows fresh on a long plan.
2. **Inline execution** — execute tasks in this session using `superpowers:executing-plans`, batch with checkpoints for review.

Open dependency before starting Task B1 (mutations): confirm Wave API access and run `npm run codegen:introspect` once to replace the hand-stubbed `data/wave-schema.graphql` with the real Wave schema. The plan handles both paths (introspection works → real types; introspection blocked → hand-stub keeps things compiling).

Which approach do you want for execution?
