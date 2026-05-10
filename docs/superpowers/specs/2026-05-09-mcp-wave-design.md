# MCP Wave — Design Spec

**Date**: 2026-05-09
**Status**: Approved (brainstorm complete) — pending implementation plan
**Author**: brainstorm session with the user

---

## 1. Context & motivation

The user wants an MCP (Model Context Protocol) server exposing **Wave Accounting** (waveapps.com) operations to Claude, so Claude can:

- Keep books up to date (categorize transactions, split bank entries).
- Reconcile invoices against bank movements.
- Issue invoices with minimal input ("issue my Acme invoice for 23 hours").
- Split consolidated payroll remittances into federal/regional buckets.

The MCP must be deployable serverlessly on multiple clouds, with **GCP Cloud Run as the validation/test environment** and **Scaleway Containers as the daily-runtime production environment**.

Initial deployment is **option A — single tenant** (one Wave account, env-var token). The architecture must allow a future migration to **option C.1 — Claude Connector / Bearer passthrough** without rewriting tool code, so that the user can later expose the MCP for others to connect their own Wave accounts with **zero data-controller responsibility** on the user's side.

## 2. Goals & non-goals

### Goals

- TypeScript codebase, Node 22, strict mode.
- Single Docker image deployable to GCP Cloud Run and Scaleway Serverless Containers without code divergence.
- Two transports from day 1: **stdio** (local dev / Claude Desktop) and **Streamable HTTP** (remote / serverless).
- ~24 tools in v1: full CRUD coverage of invoices/transactions/customers/products/accounts/reports + 2 high-value workflow composites (`create_invoice_for_client`, `split_payroll_remittance`).
- Pluggable Wave authentication (env token now, Bearer passthrough later) — same interface, swap implementation at the entrypoint.
- Stateless runtime: no DB, no KV, no per-request side state. Wave is the source of truth; local files are read-only (tax tables, account mapping).
- Deterministic computation for all monetary arithmetic (taxes, totals, splits) — the LLM never does arithmetic on money.
- Tax rates table format is jurisdiction-agnostic; CA-QC ships first.

### Non-goals (v1)

- No payroll engine (no computing employee deductions from gross salaries — the user supplies the breakdown).
- No multi-tenant OAuth provider / authorization server (option C.2 deferred).
- No persistent state, no DB, no KV. Idempotency keys not implemented (Wave doesn't support them and stateless dedup would be a false guarantee).
- No infrastructure-as-code framework (Terraform, Pulumi). Cloud CLIs wrapped by TypeScript scripts are sufficient at v1 scale.
- No bundler. Plain `tsc` output runs natively on Node 22.
- No GraphQL Federation, no Apollo. `graphql-request` + codegen is enough.

## 3. Open question to resolve before implementation

**Wave API access status.** Wave Accounting closed new developer registrations in early 2024. We need to confirm, before starting implementation, that the user can still:

1. Generate a **Full Access Token** for their own Wave account (Settings → User Settings → API Access, or developer.waveapps.com → Manage Applications). This is what unblocks option A.
2. *(Future, not blocking v1)* Register an OAuth Application for option C.

If neither is available, the project must pivot (CSV import/export, headless browser scraping, third-party platform). The pluggable `WaveCredentialProvider` keeps the rest of the design stable across these scenarios.

This was tracked as the first task in the brainstorm and remains the single external dependency.

## 4. Architecture overview

```
                                         ┌──────────────────────────┐
                                         │  Wave Accounting (SaaS)  │
                                         │   GraphQL API endpoint   │
                                         └─────────────▲────────────┘
                                                       │ HTTPS
                                                       │ (Bearer = Wave token)
   ┌────────────┐    MCP        ┌──────────────────────┴──────────────────────┐
   │            │   stdio       │  mcp-wave (TypeScript, Node 22)             │
   │   Claude   │◀────────────▶│  ┌────────────┐  ┌──────────────────────┐  │
   │  Desktop / │   ou          │  │  MCP SDK   │──│  Tool registry       │  │
   │  Code CLI  │   Streamable  │  │  server    │  │  (zod-validated I/O) │  │
   │            │   HTTP        │  └────────────┘  └─────────┬────────────┘  │
   └────────────┘   (POST/SSE)  │                            │               │
                                │  ┌─────────────────────────▼────────────┐  │
                                │  │  Wave client (graphql-request)       │  │
                                │  │  + WaveCredentialProvider (pluggable)│  │
                                │  └──────────────────────────────────────┘  │
                                │  ┌──────────────────────────────────────┐  │
                                │  │  Local read-only data:               │  │
                                │  │  - tax-rates/*.yaml                  │  │
                                │  │  - account-mapping/*.yaml            │  │
                                │  │  - client-profiles parser (Wave Notes)│ │
                                │  └──────────────────────────────────────┘  │
                                └─────────────────────────────────────────────┘
                                  Deployed as: single Docker image
                                              → Cloud Run (GCP) — test/validation
                                              → Scaleway Containers (fr-par) — prod
                                              → stdio local (dev / Claude Desktop)
```

Three load-bearing properties:

1. **Stateless runtime.** No DB, no KV, no mutated files. The image carries `data/tax-rates` and `data/account-mapping` read-only. Client profiles live in the Wave customer's `internalNotes` field (parsed at request time, cached 60 s in process). Result: zero-config scale-to-zero, multi-instance, restart-safe.

2. **Auth injected, never hardcoded.** Tool handlers receive a `WaveCredentialProvider` via a request context. The concrete strategy (env token, Bearer passthrough, mock) is selected at the entrypoint by env var. Migrating option A → C.1 = changing the entrypoint env vars; zero touches to tool code.

3. **The LLM orchestrates, the MCP computes.** Any monetary arithmetic (invoice totals, tax application, payroll splits) is performed by deterministic TypeScript code in `src/domain/`. Tools return already-computed values. Claude composes; Claude never multiplies or sums currency.

## 5. Project structure

```
mcp-wave/
├── src/
│   ├── entrypoints/
│   │   ├── stdio.ts              # MCP stdio (local + Claude Desktop)
│   │   └── http.ts               # Hono + MCP Streamable HTTP (Cloud Run / Scaleway)
│   │
│   ├── server/
│   │   ├── mcp-server.ts         # builds the MCP Server, registers tools
│   │   ├── tool-registry.ts      # imports and exposes all tools
│   │   └── error-bridge.ts       # converts thrown ToolError to MCP isError result
│   │
│   ├── tools/                    # one file per tool, ~30-80 lines each
│   │   ├── invoices/             # list, get, create, update, send, mark_paid,
│   │   │                         # duplicate, download_pdf, delete (drafts)
│   │   ├── transactions/         # list, get, categorize, split,
│   │   │                         # match_to_invoice
│   │   ├── customers/            # list, get, create, update
│   │   ├── products/             # list, upsert
│   │   ├── vendors/              # list (v1), CRUD (v1.1)
│   │   ├── accounts/             # list_accounts, get_account
│   │   ├── reports/              # profit_and_loss, balance_sheet,
│   │   │                         # general_ledger (v1.1)
│   │   ├── workflows/            # composite tools
│   │   │   ├── create-invoice-for-client.ts
│   │   │   ├── split-payroll-remittance.ts
│   │   │   ├── reconcile-unmatched.ts            (v1.1)
│   │   │   ├── monthly-close-checklist.ts        (v1.1)
│   │   │   └── setup-account-mapping.ts
│   │   ├── businesses/list-businesses.ts
│   │   ├── profiles/list-client-profiles.ts
│   │   ├── tax/get-payroll-rates.ts
│   │   └── index.ts
│   │
│   ├── wave/
│   │   ├── client.ts             # GraphQL client wrapper, retry/timeout
│   │   ├── auth/
│   │   │   ├── provider.ts       # WaveCredentialProvider interface
│   │   │   ├── env-token.ts      # impl A: Full Access Token via env
│   │   │   ├── bearer-passthrough.ts  # impl C.1: token from request header
│   │   │   ├── mock.ts           # impl for tests
│   │   │   └── select.ts         # factory based on WAVE_AUTH_MODE
│   │   ├── operations/           # GraphQL .gql files
│   │   └── generated/            # graphql-codegen output (committed)
│   │
│   ├── domain/                   # pure logic, zero Wave/HTTP imports
│   │   ├── tax/
│   │   │   ├── rates-loader.ts
│   │   │   ├── compute-payroll-split.ts
│   │   │   └── schema.ts
│   │   ├── client-profiles/
│   │   │   ├── parse-from-notes.ts
│   │   │   └── schema.ts
│   │   └── invoice-templating/
│   │       ├── render-lines.ts
│   │       └── compute-totals.ts
│   │
│   ├── config/
│   │   ├── env.ts                # zod-validated env vars per entrypoint
│   │   └── logger.ts             # pino + redaction
│   │
│   └── lib/
│       ├── errors.ts             # ToolError, WaveApiError
│       ├── retry.ts              # p-retry wrapper, isRetryable
│       └── time.ts
│
├── data/
│   ├── tax-rates/
│   │   ├── _schema.json
│   │   └── ca-qc-2026.yaml       # CA-QC populated first; others added later
│   └── account-mapping/
│       └── default.yaml          # Wave account_id mapping per remittance bucket
│
├── tests/
│   ├── unit/                     # ~150 tests, no network
│   ├── integration/              # ~120 tests, msw-mocked Wave
│   ├── e2e/                      # ~5 smoke tests against Wave sandbox
│   └── fixtures/wave-graphql/
│
├── scripts/                      # TypeScript, run via tsx
│   ├── deploy-gcp.ts             # alias: deploy:test
│   ├── deploy-scaleway.ts        # alias: deploy:prod
│   ├── promote.ts                # GCP-validated SHA → Scaleway
│   ├── secrets-put.ts
│   ├── build-image.ts
│   ├── logs-gcp.ts / logs-scaleway.ts
│   └── lib/
│       ├── shell.ts              # execa wrapper
│       ├── deploy-env.ts         # Zod schema for deploy env
│       └── steps.ts
│
├── docs/superpowers/specs/
│   └── 2026-05-09-mcp-wave-design.md   # this file
│
├── Dockerfile                    # multi-stage, distroless final, ~120 MB
├── .dockerignore
├── codegen.yml                   # graphql-codegen config
├── biome.json
├── tsconfig.json                 # strict, ESNext, NodeNext
├── vitest.config.ts
└── package.json
```

Layering rules (enforced by lint or by review):

- `tools/` has no business logic. Each tool: parse args (Zod) → call `wave/` or `domain/` → format response.
- `domain/` imports neither `wave/` nor `tools/`. Pure TS, unit-testable, no I/O.
- `wave/generated/` is committed (auditable in PR; no opaque build step).

## 6. Stack choices

| Concern | Choice | Rationale |
|---|---|---|
| Language | TypeScript strict | user requirement |
| Runtime | Node 22 LTS | native ESM, current LTS in 2026 |
| MCP | `@modelcontextprotocol/sdk` (official) | single source of truth for protocol |
| Remote transport | Streamable HTTP (spec 2025-03-26+) | required for future Claude Connector |
| Local transport | stdio | dev + Claude Desktop config |
| HTTP framework | **Hono** | runtime-agnostic, small, idiomatic for serverless |
| Wave client | `graphql-request` + **graphql-codegen** | typed SDK from the Wave schema |
| Validation | **Zod** | runtime + JSON Schema export for MCP tool descriptions |
| Tests | Vitest + msw + fast-check | ESM-first, watch, property-based for arithmetic |
| Lint/format | **Biome** | replaces ESLint+Prettier, 10× faster |
| Logs | **pino** JSON to stdout | captured natively by Cloud Run / Scaleway Cockpit |
| Secrets | env vars + GCP Secret Manager + Scaleway Secret Manager | no tokens in repo |
| IaC | **TypeScript scripts (tsx) + execa wrapping cloud CLIs** | one-service-per-cloud doesn't justify Terraform |
| CI | GitHub Actions | standard, free for public/personal repos |

## 7. Tool catalog (v1 = ~24 tools)

Legend: 🔍 read · ✏️ write · 🧩 composite. All tools accept an optional `business_id`; default = `WAVE_DEFAULT_BUSINESS_ID`.

### Invoices

- `list_invoices` 🔍 — filters: status, customer_id, date range, currency.
- `get_invoice` 🔍
- `create_invoice` ✏️
- `send_invoice` ✏️
- `mark_invoice_paid` ✏️ — record payment against invoice.
- `download_invoice_pdf` 🔍 — signed URL or base64.
- `update_invoice` ✏️ *(v1.1)*
- `duplicate_invoice` ✏️ *(v1.1)*
- `delete_invoice` ✏️ — DRAFT only, Wave constraint.

### Transactions / Ledger

- `list_transactions` 🔍 — filters include `uncategorized_only`, `unmatched_only`.
- `get_transaction` 🔍
- `categorize_transaction` ✏️
- `split_transaction` ✏️ — splits sum to total, replaces existing splits.
- `match_transaction_to_invoice` ✏️

### Customers / Products / Vendors

- `list_customers` 🔍 — `with_profiles?: boolean` parses internalNotes.
- `get_customer` 🔍
- `create_customer` ✏️ — accepts `notes_yaml?` to seed a profile.
- `update_customer` ✏️ *(v1.1)*
- `list_products` 🔍, `upsert_product` ✏️
- `list_vendors` 🔍

### Accounts / Reports

- `list_accounts` 🔍, `get_account` 🔍
- `profit_and_loss` 🔍, `balance_sheet` 🔍
- `general_ledger` 🔍 *(v1.1)*
- `list_businesses` 🔍

### Local data tools

- `list_client_profiles` 🔍 — parses internalNotes across all customers, returns aliases + templates.
- `get_payroll_rates` 🔍 — exposes `data/tax-rates/<jurisdiction>-<year>.yaml` to Claude (for explainability).

### Workflow composites (🧩)

- `create_invoice_for_client` — alias-driven invoice creation, see §9.
- `split_payroll_remittance` — bank entry split into federal/regional payable accounts, see §10.
- `setup_account_mapping` — interactive helper that fuzzy-matches Wave accounts to remittance buckets and prints YAML to commit.
- `reconcile_unmatched` *(v1.1)* — proposes transaction↔invoice matches.
- `monthly_close_checklist` *(v1.1)* — runs verifications and reports actionables.

### Caveats to confirm at codegen time

- `delete_invoice` likely DRAFT-only in Wave's API.
- `match_transaction_to_invoice` mutation exact name (e.g., `InvoicePaymentCreate`) verified once the Wave schema is fetched.
- `general_ledger` may need aggressive pagination.
- Multi-currency cross-business is **out of scope v1**: the MCP supports single-currency invoices per business.

## 8. Data model

### 8a. Client profiles — stored in Wave's `customer.internalNotes`

A delimited YAML block lives inside the customer's existing notes; free-form text outside the markers is preserved.

```
Free notes about the client : contact Marc, pays late, etc.

---mcp-wave---
alias: acme
unit: hours
hourly_rate: 95.00
currency: CAD
default_product_id: prod_abc123
default_description: "Consulting — development hours"
send_to:
  - billing@acme.com
cc:
  - finance@acme.com
payment_terms_days: 30
language: en
default_taxes: [GST, QST]
invoice_notes: "Per MSA 2026"
---mcp-wave---
```

Schema (Zod):

```ts
export const ClientProfileSchema = z.object({
  alias: z.string().regex(/^[a-z0-9-]+$/),
  unit: z.enum(['hours', 'days', 'fixed']).default('hours'),
  hourly_rate: z.number().positive().optional(),
  currency: z.string().length(3),
  default_product_id: z.string().optional(),
  default_description: z.string().optional(),
  send_to: z.array(z.string().email()).min(1),
  cc: z.array(z.string().email()).default([]),
  payment_terms_days: z.number().int().min(0).default(30),
  language: z.enum(['en', 'fr']).default('en'),
  default_taxes: z.array(z.string()).default([]),
  invoice_notes: z.string().optional(),
});
```

Parsing rules:

- Match `/---mcp-wave---\n([\s\S]*?)\n---mcp-wave---/`.
- No match → `null` (customer has no profile, normal).
- Match → `YAML.parse` → `Zod.safeParse`. On failure, return a structured error object Claude can read (`{customer_id, issues: [...]}`).
- In-process cache, 60 s TTL, keyed by `business_id`. Invalidated on any `create_customer` / `update_customer` mutation.

Tradeoffs of this storage:

- **Wins**: Wave is single source of truth, multi-machine, no extra cloud resource, redacted from logs by default.
- **Loss**: parsing all customer notes scales O(n customers). The `list_client_profiles` tool fetches `internalNotes` for all customers in one paginated GraphQL query and parses lazily.

### 8b. Tax rate tables — `data/tax-rates/<jurisdiction>-<year>.yaml`

Jurisdiction-agnostic schema; CA-QC is the first populated table.

```ts
export const TaxRatesSchema = z.object({
  jurisdiction: z.string(),
  year: z.number().int(),
  effective_from: z.string().date(),
  effective_to: z.string().date(),

  remittance_authorities: z.array(z.object({
    code: z.string(),
    name: z.string(),
    level: z.enum(['federal', 'regional', 'municipal', 'other']),
  })),

  payroll_taxes: z.array(z.object({
    code: z.string(),
    name: z.string(),
    remits_to: z.string(),
    type: z.enum(['withheld', 'employer_only', 'both']),
    employer_rate: z.number().optional(),
    employee_rate: z.number().optional(),
    employer_factor: z.number().optional(),
    insurable_max: z.number().optional(),
    pensionable_max: z.number().optional(),
    basic_exemption: z.number().optional(),
  })),

  sales_taxes: z.array(z.object({
    code: z.string(),
    name: z.string(),
    rate: z.number(),
    remits_to: z.string(),
  })),
});
```

`data/tax-rates/ca-qc-2026.yaml` (excerpt; numerical values to be confirmed at implementation time):

```yaml
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

Audit trail: this file is in git. Changes to rates ship as PRs with explicit effective dates. The `compute_payroll_split` function selects the table whose `[effective_from, effective_to]` covers the operation's period.

### 8c. Account mapping — `data/account-mapping/default.yaml`

Maps remittance buckets (or individual tax codes) to the user's actual Wave `account_id`s. Required for `split_payroll_remittance`.

```yaml
business_id_env: WAVE_DEFAULT_BUSINESS_ID
jurisdiction: CA-QC

# v1 — two-bucket mode
remittance_buckets:
  CRA:
    payable_account_id: "acct_abc111"
  RQ:
    payable_account_id: "acct_abc222"

# v1.1 — detailed mode (optional)
tax_code_to_account:
  # CIT: acct_xxx
  # PIT: acct_yyy
  # ...
```

Algorithm picks detailed mode when `tax_code_to_account` is filled, two-bucket otherwise. Same tool API in both cases.

The `setup_account_mapping` workflow tool helps populate this file: it lists liability accounts, fuzzy-matches them to authorities/codes, and prints YAML for the user to commit.

**Operational note**: the same `account-mapping/default.yaml` is used in both GCP test deploys and Scaleway prod, because option A has a single Wave account. To avoid polluting the real ledger during validation, the user should either (a) point GCP test at a Wave business marked `[E2E]`, or (b) only invoke read-only tools during GCP validation. This is a runbook concern, not an architecture concern.

## 9. Workflow: `create_invoice_for_client` ("Issue my Acme invoice")

### Scenario

User: *"Issue my Acme invoice for November, 23 hours."*

Claude calls:

```ts
create_invoice_for_client({
  alias: "acme",
  quantity: 23,
  period_label: "November 2026",
})
```

### Signature

```ts
// Input
{
  alias: string;
  quantity: number;
  period_label?: string;
  invoice_date?: string;          // default = today
  due_date?: string;              // default = invoice_date + profile.payment_terms_days
  override_unit_price?: number;
  send_immediately?: boolean;     // default = false (always DRAFT first)
  idempotency_hint?: string;      // free-form, used in logs only
}

// Output
{
  invoice_id: string;
  invoice_number: string;
  status: "DRAFT" | "SENT";
  customer: { id, name };
  lines: [{ description, quantity, unit_price, taxes }];
  totals: { subtotal, taxes_breakdown: [{code, amount}], total, currency };
  pdf_url: string;
  warnings: string[];
}
```

### Algorithm (~70 lines)

1. Resolve alias → profile (cached) → fetch fresh `customer` from Wave.
2. Resolve `default_taxes` codes → Wave sales-tax IDs (cached).
3. `renderLines({ profile, quantity, period_label, override_unit_price })` (pure, in `domain/`).
4. `computeInvoiceTotals(lines, taxIds, currency)` (pure, in `domain/`).
5. `wave.invoices.create(...)` with full payload → DRAFT.
6. If `send_immediately`: `wave.invoices.send(draftId, { to: profile.send_to, cc: profile.cc })`.
7. Return enriched payload (totals, PDF URL, warnings).

### Error catalog

| Code | Cause | Recovery |
|---|---|---|
| `ALIAS_NOT_FOUND` | profile unknown | output `available_aliases` for Claude to suggest closest |
| `PROFILE_PARSE_ERROR` | YAML invalid in Wave Notes | output Zod issues per field |
| `MISSING_RATE` | no `hourly_rate`, no `override_unit_price` | ask user |
| `TAX_CODE_NOT_RESOLVED` | profile references undefined tax | list available Wave taxes |
| `CURRENCY_MISMATCH` | profile vs customer currency disagree | ask user |
| `WAVE_GRAPHQL_ERROR` | Wave validation/rejection | re-throw with original message |

### Idempotency

Not idempotent. A second call creates a second DRAFT. Acceptable because DRAFTs are free, easy to delete, and the user always sees the summary before `send_invoice`. Documented in the tool's MCP description.

## 10. Workflow: `split_payroll_remittance`

### Scenario

User: *"Split the PayrollProvider Nov 15 transaction: $3,200 federal, $1,620 Quebec — total $4,820."*

```ts
split_payroll_remittance({
  transaction_id: "txn_xyz",
  jurisdiction: "CA-QC",
  buckets: {
    CRA: { amount: 3200.00 },
    RQ:  { amount: 1620.00 },
  },
  memo_prefix: "Nov 2026 payroll DAS",
})
```

### Accounting effect

Wave records the bank debit as a single line. The tool splits the categorization side into two payable accounts:

```
Before:                          After:
─────────                        ─────
CR Bank          4 820           CR Bank                       4 820
DR Uncategorized 4 820           DR Federal taxes payable      3 200
                                 DR Quebec taxes payable       1 620
```

### Signature

```ts
{
  transaction_id: string;
  jurisdiction: string;
  buckets: Record<string, { amount: number; memo?: string }>;
  memo_prefix?: string;
  tolerance_cents?: number;          // default 1
  force_resplit?: boolean;           // default false
}
```

### Algorithm (~90 lines)

1. Load `data/tax-rates/<jurisdiction>-<year>.yaml`. Validate every bucket key exists in `remittance_authorities`.
2. Load `data/account-mapping/default.yaml`. Validate every bucket has a `payable_account_id`.
3. Fetch transaction. If already split (>1 split) and `force_resplit` is false → reject.
4. Validate Σ buckets ≈ |transaction.amount|, tolerance = `tolerance_cents / 100`.
5. Build splits: one per bucket, `account_id` from mapping, `memo` from `memo_prefix + " — " + authority.name`.
6. `wave.transactions.split(transaction_id, splits)`.
7. Return updated transaction with annotated splits.

### Error catalog

| Code | Cause |
|---|---|
| `UNKNOWN_AUTHORITY_CODE` | bucket key not in jurisdiction table |
| `MISSING_ACCOUNT_MAPPING` | mapping file lacks the authority |
| `TRANSACTION_NOT_FOUND` | bad `transaction_id` |
| `ALREADY_SPLIT` | refuse without `force_resplit: true` |
| `SPLIT_SUM_MISMATCH` | Σ ≠ total, beyond tolerance |
| `WAVE_PERMISSION_DENIED` | token lacks transaction write |

### Safety contract

- **No tax math by the LLM.** The tool does not estimate the breakdown. If Claude does not know the amounts, it asks the user, who has them in their payroll register.
- **Sum tolerance** = 1¢ default. Multi-tax rounding can exceed this; the user can pass `tolerance_cents: 5` explicitly, recorded in `warnings`.
- **No re-split** without explicit `force_resplit`.
- **Atomic** — Wave's split mutation is transactional, so either all splits land or none.

### v1.1 evolution: detailed mode

When `tax_code_to_account` is populated in the mapping, the tool accepts:

```ts
{
  transaction_id, jurisdiction,
  taxes: { CIT: 1800, EI: 250, QPP_employer: 600, PIT: 950, QPIP: 80, QPP_employee: 600 }
}
```

The algorithm groups by `payroll_taxes[].remits_to` if only buckets are mapped, or splits per code if each tax has its own `account_id`. Same surface, adaptive behavior.

## 11. Auth — `WaveCredentialProvider`

### Interface

```ts
export interface WaveCredentialProvider {
  getToken(req: RequestContext): Promise<string>;
  getIdentity(req: RequestContext): Promise<string>;
}

export interface RequestContext {
  headers: Headers | null;       // null in stdio
  request_id: string;
}
```

The Wave client requests a token **per call**:

```ts
class WaveClient {
  constructor(private provider: WaveCredentialProvider) {}
  async request<T>(req: RequestContext, gql: TypedDocument<T>, vars: any) {
    const token = await this.provider.getToken(req);
    return this.gql.request(gql, vars, { authorization: `Bearer ${token}` });
  }
}
```

### Implementations shipped in v1

| Provider | Token source | Use case |
|---|---|---|
| `EnvTokenProvider` | `process.env.WAVE_API_TOKEN` | option A (single-tenant, env-configured) |
| `BearerHeaderProvider` | `Authorization: Bearer <…>` from request | option C.1 (Claude Connector passthrough) |
| `MockProvider` | static fixture | tests |

### Selection at startup

`WAVE_AUTH_MODE` env var: `env_token` | `bearer_passthrough` | `mock`.

Defaults per entrypoint:

- `entrypoints/stdio.ts` → `env_token` (refuses to start without `WAVE_API_TOKEN`).
- `entrypoints/http.ts` → `bearer_passthrough`, **unless** `WAVE_API_TOKEN` is also set, in which case `env_token` (single-user remote service mode).

### Path A → C.1 — what changes

| Component | Mode A | Mode C.1 |
|---|---|---|
| Tool code | unchanged | unchanged |
| `WaveClient` | unchanged | unchanged |
| Provider impl | `EnvTokenProvider` | `BearerHeaderProvider` |
| Env vars | `WAVE_API_TOKEN`, `WAVE_AUTH_MODE=env_token` | `WAVE_AUTH_MODE=bearer_passthrough` |
| MCP endpoint | private | public HTTPS |
| Caller responsibility | n/a | must send `Authorization: Bearer <wave-token>` |

### Future C.2 — full OAuth Resource Server (deferred)

Adds `src/wave/auth/oauth-resource.ts` validating Bearer tokens as JWTs signed by a trusted Authorization Server (JWKS). Adds `/.well-known/oauth-protected-resource` (RFC 9728). The AS itself can be a small custom proxy or an off-the-shelf IDaaS. **All additive**; no app code touched.

### Security non-negotiables

1. The Wave token never appears in logs. `getIdentity()` returns a truncated SHA-256.
2. No process-wide token cache in passthrough mode. Each request re-extracts from headers.
3. HTTPS only (Cloud Run / Scaleway enforce this).
4. `Origin` allowlist on the HTTP entrypoint (`https://claude.ai`, `http://localhost:*` for dev). Per MCP spec recommendation against DNS rebinding.
5. Basic rate limit (X req/min/IP) middleware on Hono.

## 12. Error handling & idempotency

### Error hierarchy

```ts
class ToolError extends Error {
  constructor(
    public code: string,
    public details: Record<string, unknown> = {},
    public hint?: string,
  ) { super(`${code}: ${hint ?? ""}`); }
}
class WaveApiError extends ToolError { /* + waveCode, httpStatus, waveDetails */ }
```

### Conversion to MCP responses

Every tool wraps its handler with `toMcpResult`:

- Success → `{ content: [{ type: "text", text: JSON.stringify(result) }] }`
- Caught error → `{ isError: true, content: [{ type: "text", text: JSON.stringify({code, details, hint}) }] }`

This lets Claude see structured errors and react (retry with corrected args, ask user, suggest alternative tools). Tool descriptions instruct Claude to read `code` and `details` on `isError: true`.

### Wave error mapping

```
AUTHENTICATION_ERROR  → 401 / not retryable
AUTHORIZATION_ERROR   → 403 / not retryable
NOT_FOUND             → 404 / not retryable
VALIDATION_ERROR      → 400 / not retryable
RATE_LIMITED          → 429 / retryable, honor Retry-After
INTERNAL_SERVER_ERROR → 500 / retryable (capped backoff)
```

### Retry policy

`p-retry` with: 3 retries, factor 2, min 500 ms, max 5 s, randomized. Only `429` and `5xx` are retryable. Network errors retried once. `Retry-After` honored when present.

### Timeout policy

| Level | Value |
|---|---|
| Wave GraphQL call | 15 s |
| Reports tools | 45 s (override) |
| HTTP request total | 60 s |
| stdio request total | unbounded |

Implemented with `AbortController` propagated to `fetch`.

### Idempotency — explicit per category

Wave has no native idempotency keys. **No dedup at the MCP layer** (stateless). Documented in each tool description.

| Category | Behavior |
|---|---|
| 🔍 read | naturally idempotent |
| ✏️ `create_*` | NOT idempotent — duplicate calls create duplicate records |
| ✏️ `update_*`, `categorize_*`, `mark_*_paid` | functionally idempotent (last-write-wins) |
| ✏️ `split_transaction` | overwrites existing splits |
| ✏️ `send_invoice` | sends a new email each time |
| 🧩 composites | per-tool documentation |

Safety mechanisms compensating for the lack of dedup:

- DRAFT-first pattern (`send_immediately: false` default).
- Conversational confirmation in normal flow.
- Verbose tool descriptions that brief Claude on side effects.

### Partial state on composite failures

When a composite fails mid-way, the error includes a `partial_state` object so Claude can recover without redoing successful steps:

```json
{
  "code": "WAVE_VALIDATION_ERROR",
  "details": {
    "step_failed": "send_invoice",
    "completed_steps": ["create_invoice"],
    "partial_state": { "invoice_id": "inv_abc", "status": "DRAFT" }
  },
  "hint": "DRAFT created. Fix recipient and call send_invoice(invoice_id) directly, or call delete_invoice to abandon."
}
```

### Logging

Captured: `request_id`, `tool_name`, `identity` (hash), `duration_ms`, `error.code`, `error.details` (sanitized), `wave_request_id`.

Never captured: token (any form), email/PII (unless `LOG_PII=true`, never in prod), raw GraphQL variables. Central sanitizer in `src/config/logger.ts` redacts `token`, `authorization`, `email`, etc.

### Per-tool error code convention

Format: `{DOMAIN}_{REASON}` SCREAMING_SNAKE. Each tool file lists its codes exhaustively in a top-level constant, used both for the MCP description served to Claude and for one integration test per code.

## 13. Testing strategy

### Pyramid

- **Unit (~150 tests, <2 s)** — `domain/`, `lib/`, parsers, selectors. Pure, table-driven.
- **Integration (~120 tests, ~30 s)** — every tool end-to-end, msw-mocked Wave. ≥1 happy path + 1 per documented error code + 1 retry/timeout.
- **e2e (~5 tests, manual or nightly)** — against a Wave sandbox business marked `[E2E]`. Gated by `WAVE_E2E=1` and `WAVE_E2E_BUSINESS_ID`.

### Unit coverage targets

- `parseClientProfileFromNotes` — 8 cases (no marker, valid YAML, broken YAML, surrounding text, defaults applied, empty block, etc.).
- `computeInvoiceTotals` — 12 cases (single-line, multi-line, mono-tax, multi-tax, included vs excluded taxes, rounding edges).
- `loadTaxRates` — 6 cases.
- `validatePayrollSplitSum` — 8 cases (signs, tolerance, zero amount).
- `EnvTokenProvider` / `BearerHeaderProvider` — 6 cases.
- `mapWaveError` — one per known Wave code + `UNKNOWN`.
- `isRetryable` — 6 cases.
- `sanitizeForLog` — 5 cases.

Property-based (`fast-check`) on `computeInvoiceTotals` and `validatePayrollSplitSum` to catch rounding bugs.

### Integration test pattern

```ts
beforeEach(() => {
  server = setupMswServer({
    "GetCustomer":    fixture("customers/acme.json"),
    "ListCustomers":  fixture("customers/list-with-acme.json"),
    "ListSalesTaxes": fixture("taxes/qc-gst-qst.json"),
    "InvoiceCreate":  fixture("invoices/create-success.json"),
  });
  mcp = createTestServer({ authMode: "mock" });
});

test("happy path: alias=acme, 23h → DRAFT", async () => {
  const res = await mcp.callTool("create_invoice_for_client", { alias: "acme", quantity: 23 });
  expect(res.isError).toBe(false);
  expect(JSON.parse(res.content[0].text).status).toBe("DRAFT");
});
```

### Coverage gates

| Module | Target |
|---|---|
| `src/domain/**` | 100% lines + branches |
| `src/wave/**` (excluding `generated/`) | 90% |
| `src/tools/**` | 85% |
| `src/lib/**` | 95% |
| `src/entrypoints/**` | 70% |
| Global | ≥85% (CI gate) |

### CI

- On PR / push: codegen, lint, typecheck, unit, integration, build, build-image (no push).
- Nightly: e2e against sandbox.
- Manual: deploy steps. No auto-deploy in v1.

## 14. Deployment topology

### Image

Multi-stage Dockerfile. Final stage = `gcr.io/distroless/nodejs22-debian12`. Approx 120 MB. `data/tax-rates` and `data/account-mapping` baked into the image (audit trail = git log on the SHA tag).

### Release flow

```
Phase 1 (week 1–2) — bring-up
  deploy:test (GCP Cloud Run, private) → smoke + e2e
  iterate until green

Phase 2 (cutover, one time) — go to prod
  deploy:prod (Scaleway Containers fr-par)
  start using daily

Phase 3 (steady-state)
  deploy:prod direct
  GCP available but dormant; resurrected ad-hoc for risky changes
```

### Scripts (`tsx`-run TypeScript)

| Script | Alias | Purpose |
|---|---|---|
| `scripts/build-image.ts` | — | docker build, tag with git SHA |
| `scripts/deploy-gcp.ts` | `deploy:test` | push GAR + Cloud Run deploy |
| `scripts/deploy-scaleway.ts` | `deploy:prod` | push SCR + Scaleway Container deploy |
| `scripts/promote.ts` | `deploy:promote` | take a SHA validated on GCP and ship to Scaleway, no rebuild |
| `scripts/secrets-put.ts` | — | upload Wave token to both Secret Managers |
| `scripts/logs-gcp.ts` / `logs-scaleway.ts` | `logs:test` / `logs:prod` | tail logs |

### Service config

| Setting | Cloud Run (test) | Scaleway Containers (prod) |
|---|---|---|
| Region | europe-west9 (Paris) | fr-par |
| Concurrency | 80 | 80 |
| Memory | 512 MiB | 512 MiB |
| CPU | 1 | 1 |
| min/max instances | 0 / 5 | 0 / 5 |
| Request timeout | 60 s | 60 s |
| Privacy (option A) | `--no-allow-unauthenticated` + IAM invoker | `privacy=private` + token |
| Privacy (option C.1) | `--allow-unauthenticated` + app-level auth | `privacy=public` + app-level auth |

### Env vars / secrets

| Var | Source |
|---|---|
| `NODE_ENV` | hardcoded `production` |
| `LOG_LEVEL` | `.deploy.env` |
| `WAVE_AUTH_MODE` | `.deploy.env` |
| `WAVE_DEFAULT_BUSINESS_ID` | `.deploy.env` |
| `WAVE_API_TOKEN` | Secret Manager (GCP + Scaleway) |
| `ALLOWED_ORIGINS` | `.deploy.env` |
| `RATE_LIMIT_RPM` | `.deploy.env` |

### Observability (v1 minimum)

- pino JSON to stdout → captured by Cloud Logging / Scaleway Cockpit.
- Built-in cloud metrics (request count, latency, errors).
- `GET /healthz` (liveness), `GET /readyz` (loads tax tables + pings Wave schema).
- v1.1: `/metrics` Prometheus endpoint (counters per tool + Wave latency histogram).

### Rollback

Cloud Run: `gcloud run services update-traffic mcp-wave --to-revisions=PREV=100`.
Scaleway: redeploy the previous SHA (registries retain images by default).
Both: `npm run deploy:* -- --image-sha=<sha>` no rebuild.

### Local dev

- `npm run dev:stdio` — stdio MCP, watched via `tsx --watch`.
- `npm run dev:http` — Hono HTTP MCP on port 8080, watched.

Claude Desktop config example:

```json
{
  "mcpServers": {
    "wave-local": {
      "command": "npx",
      "args": ["tsx", "/path/to/mcp-wave/src/entrypoints/stdio.ts"],
      "env": {
        "WAVE_API_TOKEN": "...",
        "WAVE_DEFAULT_BUSINESS_ID": "..."
      }
    }
  }
}
```

### Cost estimate (option A, ~50 req/day personal usage)

| Item | Cloud Run | Scaleway Containers |
|---|---|---|
| Compute (free tier) | ~$0 | ~$0 |
| Container Registry | ~$0.10/mo | free (1 GB) |
| Secret Manager | ~$0.06/mo | free (1 secret) |
| Egress (Wave API) | <$1/mo | <$1/mo |
| **Total** | **~$1/mo** | **~$0/mo** |

## 15. Implementation milestones (rough, refined in the plan)

1. **Bootstrap** — repo init, tooling (Biome, Vitest, tsconfig), Hono skeleton, MCP SDK wired, `/healthz`.
2. **Wave client** — codegen against Wave schema, `WaveClient` with `WaveCredentialProvider`, `EnvTokenProvider`, retry/timeout.
3. **Domain core** — tax rates loader, payroll split logic, invoice totals, client profile parser.
4. **Tools batch 1** — read tools (list_*, get_*, reports). Integration tests via msw.
5. **Tools batch 2** — write tools (create_invoice, send_invoice, mark_paid, categorize, split_transaction, …).
6. **Workflow tools** — `create_invoice_for_client`, `split_payroll_remittance`, `setup_account_mapping`.
7. **HTTP entrypoint** — Streamable HTTP, origin allowlist, rate limit, BearerHeaderProvider plumbed (gated by env).
8. **Deploy scripts** — build-image, deploy-gcp, deploy-scaleway, promote, secrets-put.
9. **GCP test deploy** — phase 1 validation. Smoke, fix, iterate.
10. **Scaleway prod cutover** — phase 2.
11. **v1.1 backlog** — `update_invoice`, `duplicate_invoice`, `update_customer`, `general_ledger`, `reconcile_unmatched`, `monthly_close_checklist`, `/metrics`, custom domain, detailed-mode payroll splits.

The implementation plan (next document) decomposes these into reviewable PRs with TDD checkpoints.
