# Wave as a Sentropic MCP connector — Phase 0 cadrage

Status: draft v0, 2026-07-12
Repo: `mcp-wave` (this repo)
Target contract: `AppConnectorProviderAdapter` (manifest `AppMcpProviderManifest` + `resolveTenant` narrow-only + `invokeTool → AppToolResult | DurableCallRef`), from `spec/SPEC_EVOL_APP_MCP_PROVIDER_PLATFORM.md` on `~/src/sentropic` main.
Peer conductor: `claude:sentropic:80b490c9bcc2` (owner of the platform spec; do not touch that repo from here — use h2a for clarifications).

Sources of truth for this doc (only files in this repo):
- Tool wiring: `src/server/tool-registry.ts`.
- Tool schemas & descriptions: every file under `src/tools/**`.
- OAuth/session runtime: `src/entrypoints/oauth-http.ts`, `src/server/oauth/*`.

## 1. Purpose

Position the current mcp-wave connector as a future `AppConnectorProviderAdapter` implementation for the generic Sentropic MCP Provider Platform. This doc is Phase 0 — a paper mapping, no code changes. It captures:

- what the 29 tools declare as capabilities (read / write / workflow / transaction, idempotency, human-gate);
- what `resolveTenant` must return so Wave stops relying on `env.WAVE_API_TOKEN` / `env.WAVE_DEFAULT_BUSINESS_ID`;
- what the audit surface for the Wave domain should carry (`domain: 'wave'`, `domainMeta`);
- what elicitation each write / workflow tool needs;
- what today's transport & session lifecycle look like and how they move to the platform;
- what deltas the migration produces per phase;
- open questions for the conductor before we can freeze anything.

**Timeline**

| Phase | Scope | Status |
|-------|-------|--------|
| **Phase 0** | This cadrage doc (mapping, no code). | in flight (this PR). |
| **Phase 1** | RS migration onto `@sentropic/mcp-auth` + `@sentropic/oauth-verify` (published 0.1.0). Local AS retained. Adapter shape hand-authored against `SPEC_EVOL_APP_MCP_PROVIDER_PLATFORM.md §4` types. | parallel background agent. |
| **Phase 2** | Full adapter adoption once `@sentropic/mcp-platform` publishes 0.1.0 (BR-72 activation, broker-aware freeze). Delete `SingleTenantOAuthProvider`, `FileOAuthStore`, in-process session `Map`. Wave becomes an `AppConnectorProviderAdapter` — the server is owned by the platform. | blocked on npm publish of `@sentropic/mcp-platform`. |
| **Phase 3** | Cleanup: drop `WAVE_AUTH_MODE=bearer_passthrough`, remove any residual single-tenant `env_token` codepaths. Secrets flow only via `resolveTenant().secrets`. | after Phase 2 lands and STP has issued real per-tenant Wave tokens. |

Transitional single-tenant `env_token` mode (`WAVE_AUTH_MODE=env_token`, one shared token from env) is preserved through Phases 0–2. It is the only backdoor kept for local dev / CI probes.

## 2. Manifest — 29 tools mapped

Columns:

- `name` — verbatim tool name string as registered.
- `category` — one of `read | write | workflow | transaction`.
- `writesWave` — does the handler execute a Wave GraphQL mutation (`invoice*`, `customer*`, `product*`, `moneyTransaction*`).
- `mutatesExternalSystem` — same as `writesWave` in practice (all mutations reach Wave, no local-only side effects).
- `idempotency` — one of `safe` (read), `idempotent` (patch/state transition), `non-idempotent` (creates new record each call, dedupe requires `externalId`), `irreversible` (delete or outbound email).
- `requiresHumanConfirmation` — `true` for real-email dispatch or destructive one-shot ops.
- `elicitation` — `none | pre-call | dry-run-available`. `pre-call` = platform MUST prompt the human before invoking. `dry-run-available` = the tool can propose without executing (analyze / setup / audit).
- `waveScope` — routing bucket for capability registry (`businesses | customers | invoicing | products | vendors | accounting | profile | tax | transactions`).

### 2.1 Read tools (13)

| # | name | category | writesWave | idempotency | requiresHumanConfirmation | elicitation | waveScope | source |
|---|------|----------|------------|-------------|---------------------------|-------------|-----------|--------|
| 1 | `list_businesses` | read | no | safe | false | none | businesses | `src/tools/businesses/list-businesses.ts` |
| 2 | `list_customers` | read | no | safe | false | none | customers | `src/tools/customers/list-customers.ts` |
| 3 | `get_customer` | read | no | safe | false | none | customers | `src/tools/customers/get-customer.ts` |
| 4 | `list_invoices` | read | no | safe | false | none | invoicing | `src/tools/invoices/list-invoices.ts` |
| 5 | `get_invoice` | read | no | safe | false | none | invoicing | `src/tools/invoices/get-invoice.ts` |
| 6 | `get_invoice_payment` | read | no | safe | false | none | invoicing | `src/tools/invoices/get-invoice-payment.ts` |
| 7 | `download_invoice_pdf` | read | no | safe | false | none | invoicing | `src/tools/invoices/download-invoice-pdf.ts` |
| 8 | `list_products` | read | no | safe | false | none | products | `src/tools/products/list-products.ts` |
| 9 | `list_vendors` | read | no | safe | false | none | vendors | `src/tools/vendors/list-vendors.ts` |
| 10 | `list_accounts` | read | no | safe | false | none | accounting | `src/tools/accounts/list-accounts.ts` |
| 11 | `get_account` | read | no | safe | false | none | accounting | `src/tools/accounts/get-account.ts` |
| 12 | `list_client_profiles` | read | no | safe | false | none | profile | `src/tools/profiles/list-client-profiles.ts` |
| 13 | `get_payroll_rates` | read | no | safe (local data) | false | none | tax | `src/tools/tax/get-payroll-rates.ts` |

Reads carry `mutatesExternalSystem: false`. `get_payroll_rates` does not call Wave at all — it returns a versioned local rate table; it stays in the read bucket because it is safe/no-effect.

### 2.2 Write tools (10)

| # | name | category | writesWave | idempotency | requiresHumanConfirmation | elicitation | waveScope | source |
|---|------|----------|------------|-------------|---------------------------|-------------|-----------|--------|
| 14 | `approve_invoice` | write | yes (`invoiceApprove`) | idempotent | false | none | invoicing | `src/tools/invoices/approve-invoice.ts` |
| 15 | `create_invoice` | write | yes (`invoiceCreate`) | non-idempotent | true (double-create risk) | pre-call | invoicing | `src/tools/invoices/create-invoice.ts` |
| 16 | `send_invoice` | write | yes (`invoiceSend`) | irreversible (real email) | **true** | **pre-call** | invoicing | `src/tools/invoices/send-invoice.ts` |
| 17 | `mark_invoice_paid` | write | yes (`invoicePaymentCreateManual`) | non-idempotent | true (double-count risk) | pre-call | invoicing | `src/tools/invoices/mark-invoice-paid.ts` |
| 18 | `update_invoice_payment` | write | yes (`invoicePaymentPatch`) | idempotent | false | none | invoicing | `src/tools/invoices/update-invoice-payment.ts` |
| 19 | `delete_invoice_payment` | write | yes (`invoicePaymentDelete`) | irreversible (delete) | true | pre-call | invoicing | `src/tools/invoices/delete-invoice-payment.ts` |
| 20 | `send_invoice_payment_receipt` | write | yes (`invoicePaymentReceiptSend`) | irreversible (real email) | **true** | **pre-call** | invoicing | `src/tools/invoices/send-invoice-payment-receipt.ts` |
| 21 | `delete_invoice` | write | yes (`invoiceDelete`) | irreversible (delete) | true | pre-call | invoicing | `src/tools/invoices/delete-invoice.ts` |
| 22 | `create_customer` | write | yes (`customerCreate`) | non-idempotent | true (PII create) | pre-call | customers | `src/tools/customers/create-customer.ts` |
| 23 | `upsert_product` | write | yes (`productCreate` OR `productPatch`) | mixed (idempotent on patch, non-idempotent on create) | false on patch / true on create | pre-call when create branch | products | `src/tools/products/upsert-product.ts` |

Notes on the two email-sending writes (`send_invoice` #16, `send_invoice_payment_receipt` #20): tool descriptions explicitly say **"NOT IDEMPOTENT: each call triggers a real outbound email … Always confirm recipients, subject, and message with the user before calling."** These MUST wire `requiresHumanConfirmation: true` + `elicitation: pre-call` in the manifest, exposing the recipient list, subject, and message body to the elicitation surface.

Idempotency subtlety on `upsert_product` (#23): the tool routes on the presence of an `id`. The manifest should either split into two capabilities (`create_product`, `patch_product`) or expose two idempotency profiles keyed on `id` — see open question §8.4.

### 2.3 Workflow tools (4)

| # | name | category | writesWave | idempotency | requiresHumanConfirmation | elicitation | waveScope | source |
|---|------|----------|------------|-------------|---------------------------|-------------|-----------|--------|
| 24 | `create_invoice_for_client` | workflow | yes (`invoiceCreate` + optional `invoiceSend`) | non-idempotent; irreversible if `send_immediately=true` | true when `send_immediately=true` OR always (aggregate write) | pre-call | invoicing/customers | `src/tools/workflows/create-invoice-for-client.ts` |
| 25 | `audit_account_mapping` | workflow | no | safe (diagnostic) | false | dry-run-available | tax/accounting | `src/tools/workflows/audit-account-mapping.ts` |
| 26 | `setup_account_mapping` | workflow | no (returns YAML proposal) | safe | false | dry-run-available | tax/accounting | `src/tools/workflows/setup-account-mapping.ts` |
| 27 | `split_payroll_remittance` | workflow | yes (`moneyTransactionCreate`) | non-idempotent by default; `externalId` enables dedupe | true | pre-call | transactions/tax | `src/tools/workflows/split-payroll-remittance.ts` |

`create_invoice_for_client` (#24) is a compound tool: alias→profile→taxes→create DRAFT invoice, then optional send. When `send_immediately=true` it flips from non-idempotent to irreversible (a second real email will go out). Its elicitation surface MUST show the resolved recipient list from `profile.send_to` before dispatch.

`audit_account_mapping` and `setup_account_mapping` are diagnostic/proposal-only — they read Wave and local YAML and return a proposal. The tool description on `setup_account_mapping` reads: **"Returns YAML only; it does not write files."** These map to `category: workflow` + `mutatesExternalSystem: false` and expose `elicitation: dry-run-available` so a caller can present the proposal before any subsequent write step.

### 2.4 Transaction tools (2)

| # | name | category | writesWave | idempotency | requiresHumanConfirmation | elicitation | waveScope | source |
|---|------|----------|------------|-------------|---------------------------|-------------|-----------|--------|
| 28 | `split_transaction` | transaction | yes (`moneyTransactionCreate`) | non-idempotent by default; `externalId` enables dedupe | true (writes multi-line money txn) | pre-call | transactions | `src/tools/transactions/split-transaction.ts` |
| 29 | `analyze_transactions_csv` | transaction | no (proposal-only) | safe | false | dry-run-available | transactions | `src/tools/transactions/analyze-transactions-csv.ts` |

`analyze_transactions_csv` (#29) reads Wave accounts to resolve account ids but writes nothing; its description explicitly says **"Writes nothing to Wave."** It categorises the CSV rows and proposes a plan that a caller could then submit via `split_transaction`.

### 2.5 Category totals

- read: 13, write: 10, workflow: 4, transaction: 2 → **29 total**, matching `src/server/tool-registry.ts`.
- Writes that hit Wave: 15 (10 write + 3 workflow that mutate + 2 transaction — of which `split_transaction` mutates and `analyze_transactions_csv` does not).
- Real-email side effects: 3 tools (`send_invoice`, `send_invoice_payment_receipt`, and `create_invoice_for_client` when `send_immediately=true`).
- Irreversible deletes: 2 tools (`delete_invoice_payment`, `delete_invoice`).
- Diagnostic / dry-run: 3 tools (`audit_account_mapping`, `setup_account_mapping`, `analyze_transactions_csv`).

## 3. `resolveTenant` contract for Wave

The platform calls `resolveTenant(...)` narrow-only (per `AppConnectorProviderAdapter`); the connector returns the tenant view it needs to route the request. For Wave:

```ts
// Platform-facing shape (per SPEC §4 as of freeze 0.1.0, subject to conductor confirmation).
{
  tenantId: string,               // Sentropic tenant id (opaque to Wave).
  userId: string,                 // Acting user id (for audit only).
  workspaceId?: string,           // Optional STP workspace for scoping.
  connectorConfig: {
    // Wave-specific, extensible per the frozen ConnectorTenantContext shape
    // (StpConnectorContext.connectorConfig: Record<string, unknown>).
    waveBusinessId: string,             // MUST — replaces env.WAVE_DEFAULT_BUSINESS_ID.
    jurisdiction?: 'CA-QC' | string,    // default 'CA-QC', drives payroll rate lookup.
    locale?: string,                    // e.g. 'fr-CA' for invoice text templating.
  },
  secrets: {
    // Handles only — the platform brokers the Wave PAT/OAuth token; the connector
    // never sees a raw secret string. Values are fetched via a getSecret(handle) call
    // whose valueis never persisted by the connector and whose read is audited.
    waveAccessToken: SealedSecretHandle,
  },
}
```

**What this replaces today:**

| Today (single-tenant / env-driven) | After Phase 2 (per-tenant, platform-brokered) |
|-------------------------------------|-----------------------------------------------|
| `env.WAVE_API_TOKEN` (one shared PAT for the whole process). | `secrets.waveAccessToken` handle, resolved per-tenant per-call. |
| `env.WAVE_DEFAULT_BUSINESS_ID` (one business for every call). | `connectorConfig.waveBusinessId`, from the tenant's connector config. |
| `env.WAVE_AUTH_MODE ∈ {bearer_passthrough, env_token}` (single-tenant switch). | Removed in Phase 3; `env_token` retained through Phase 2 for local dev/CI probes only. |
| Implicit single-tenant assumption in `SingleTenantOAuthProvider` + `FileOAuthStore`. | Tenant identity provided by the platform per invocation; `SingleTenantOAuthProvider` + `FileOAuthStore` deleted. |

Wave-specific validity of `connectorConfig`:

- `waveBusinessId` MUST be a Wave global business id (validated once via `list_businesses` during enrollment). If missing, the adapter returns a deterministic manifest-level "capability unavailable, deny-as-missing" instead of calling Wave with a null id.
- `jurisdiction` drives `get_payroll_rates` and workflow tools that touch tax; unset defaults to `'CA-QC'` to preserve current behaviour.
- `locale` is used for outbound email templating (subject/message defaults on `send_invoice`). Independent of Wave — it feeds the elicitation surface.

## 4. Audit event schema for the Wave domain

The frozen 0.1.0 audit surface accepts extensible events (`audit.emit(event: unknown)`) with an `AuditEvent` base in `./experimental`. Wave populates `domain: 'wave'` and puts Wave-specific ids under `domainMeta`.

```ts
{
  // Base envelope (platform-owned)
  type: 'tool.invoke' | 'tool.error' | 'tool.gate-decision',
  tenantId: string,
  userId: string,
  requestId: string,             // idempotency key + trace anchor
  tool: string,                  // e.g. 'send_invoice'
  args_hash: string,             // sha256 of the redacted, canonicalised args
  at: string,                    // ISO8601
  outcome?: 'ok' | 'error' | 'gated',

  // Domain extension (Wave)
  domain: 'wave',
  domainMeta?: {
    businessId?: string,           // waveBusinessId used for the call
    invoiceId?: string,            // Wave GraphQL id, when known pre- or post-invocation
    customerId?: string,
    productId?: string,
    transactionId?: string,        // moneyTransaction id
    paymentId?: string,            // invoicePayment id
    mutation?: string,             // GraphQL mutation name, e.g. 'invoiceSend'
    externalId?: string,           // caller-supplied dedupe id (transaction tools)
    emailRecipients?: string[],    // audit trail for real email dispatch, redacted
  }
}
```

### 4.1 Redacted / hashed fields per tool

The connector MUST NOT emit raw PII into audit; it emits shape only, in `args_hash`, and puts stable ids into `domainMeta`.

| Tool | Raw fields present in args | Audit treatment |
|------|----------------------------|-----------------|
| `create_customer` | `name`, `first_name`, `last_name`, `email`, address fields, `notes_yaml` | All redacted from log; only presence flags + `args_hash`. Post-invocation, `domainMeta.customerId` recorded. |
| `send_invoice` | `to_email[]`, `subject`, `message`, `cc_myself` | `to_email` recorded in `domainMeta.emailRecipients` (redacted to `local@domain` form or opaque hash — see §8.6). `subject`/`message` never logged raw; only length + `args_hash`. |
| `send_invoice_payment_receipt` | `to_email[]`, `from_address`, `subject`, `message`, `cc_myself` | Same as `send_invoice`. `from_address` recorded whole (it's a business own-address). |
| `create_invoice`, `create_invoice_for_client` | `memo`, `description`, line items | Free-text fields redacted; only length + `args_hash`. `invoiceId` in `domainMeta` after invocation. |
| `mark_invoice_paid` | `memo` | Free-text redacted; `paymentId` post-invocation. |
| `upsert_product` | `description` | Free-text redacted; `productId` post-invocation. |
| `split_transaction`, `split_payroll_remittance` | `description`, `notes`, per-line `memo` | Free-text redacted; `transactionId` post-invocation. `externalId` logged as-is (caller-owned dedupe id). |
| `analyze_transactions_csv` | Raw CSV rows (payees, descriptions, amounts) | Only row count + `args_hash`. Never persist CSV payload. |
| All reads | Filter args (customer ids, date ranges) | Logged as-is (already ids/dates, not PII); result cardinality logged, not result content. |

`tool.gate-decision` events cover the elicitation flow: `outcome: 'gated'` if the user cancelled at the pre-call elicitation, plus `domainMeta.mutation` and `domainMeta.emailRecipients` so audit answers "what were they about to send".

## 5. Elicitation / human-gate — per write & workflow tool

Elicitation surface is the platform-owned prompt shown to the human before a write. The connector declares WHAT to show; the platform decides HOW. Per the freeze 0.1.0 MUST-in, affordances (`mutatesExternalSystem`, `requiresHumanConfirmation`, `category`, `idempotency`) and the elicitation surface must be visible from the read-only manifest phase — the read-only broker proof can already show the risk annotations without letting the writes fire.

For each write / workflow / transaction tool, this is the elicitation payload the connector proposes:

| Tool | Elicitation payload (proposed) | Rationale (from tool description) |
|------|--------------------------------|-----------------------------------|
| `approve_invoice` (#14) | invoice id + current status + customer + total | State transition DRAFT→SAVED; low risk but Wave-observable. Not strictly gated but exposed for auditability. |
| `create_invoice` (#15) | line items summary, customer, currency, total | "Not idempotent: calling twice creates two invoices." — confirm before double-create. |
| `send_invoice` (#16) | recipient list, subject, message, cc_myself flag, invoice id + total | **Real outbound email. Description explicitly says "Always confirm recipients, subject, and message with the user before calling."** MANDATORY. |
| `mark_invoice_paid` (#17) | invoice id, amount, date, account, method + **prominent warning** if Wave already has an auto-matched payment for the invoice | "Do NOT call this if Wave has already auto-matched a bank transaction to the invoice — doing so will double-count the payment." Warning must be surfaced pre-call. |
| `update_invoice_payment` (#18) | payment id + diff (before → after values) | Idempotent patch; elicitation optional but diff view aids review. |
| `delete_invoice_payment` (#19) | payment id + amount + linked invoice id | Irreversible; mandatory confirm. |
| `send_invoice_payment_receipt` (#20) | recipient list, subject, message, from_address, cc_myself, payment id + amount | **Real outbound email. "NOT IDEMPOTENT: each call triggers a real outbound email."** MANDATORY. |
| `delete_invoice` (#21) | invoice id + status + customer + total | Irreversible. Wave rejects deletion of sent invoices; if status ≠ DRAFT, block pre-call. |
| `create_customer` (#22) | name, email, address, first line of notes | PII create; confirm the profile before it lands in Wave. |
| `upsert_product` (#23) | product id (or "new"), name, price, income account, description length | Confirm branch (create vs patch); create branch is the risky one. |
| `create_invoice_for_client` (#24) | resolved alias → business/customer/profile, line items, taxes, `send_immediately` flag, resolved recipient list from `profile.send_to` when sending | Compound write; if `send_immediately=true`, ALSO show the outbound email surface (same shape as `send_invoice`). |
| `audit_account_mapping` (#25) | none (read-only diagnostic) | No side effect; results returned directly. |
| `setup_account_mapping` (#26) | none — proposal returned as YAML | "Returns YAML only; it does not write files." Elicitation not needed; caller reviews the returned YAML. |
| `split_payroll_remittance` (#27) | per-authority line list, total, account, date, `externalId` if provided | Non-idempotent multi-line withdrawal; confirm before commit. |
| `split_transaction` (#28) | direction (deposit/withdrawal), account, date, per-line breakdown + tax split | Non-idempotent multi-line money transaction; confirm before commit. |
| `analyze_transactions_csv` (#29) | none (read-only proposal) | "Writes nothing to Wave." Proposal returned as data. |

## 6. Session / transport

**Current (main, this repo):**

- Transport: `StreamableHTTPTransport` from `@hono/mcp` (`src/entrypoints/oauth-http.ts:3`).
- Sessions: in-process `Map<string, McpSession>` (line 131), keyed by a UUID generated per initialize call (line 147). Sessions vanish on process restart.
- Session lifecycle callbacks: `onsessioninitialized` inserts, `onsessionclosed` deletes (lines 148–152).
- OAuth provider: `SingleTenantOAuthProvider` (line 42), token store: `FileOAuthStore` at `env.OAUTH_STORE_PATH` (line 203). Both file-based and single-tenant by construction.
- Auth mode switch: `WAVE_AUTH_MODE` selects between `bearer_passthrough` (STP OAuth token forwarded as Wave PAT — the transitional Phase 1 mode) and `env_token` (single shared PAT from `env.WAVE_API_TOKEN` — local dev / CI probes).

**Target (Phase 2, after `@sentropic/mcp-platform@0.1.0` is on npm):**

- Transport owned by `@sentropic/mcp-platform`. Wave connector no longer instantiates `StreamableHTTPTransport`.
- Session store: durable, restart-safe, brokered by the platform. Revocation is a platform capability.
- Session identity is not visible to the connector; the connector only sees the resolved `TenantContext` for each `invokeTool` call.
- The `Map<sessionId, McpSession>` in `oauth-http.ts` is deleted along with `SingleTenantOAuthProvider` and `FileOAuthStore`.
- OAuth resource-server verification stays close to the connector but uses the published `@sentropic/mcp-auth` + `@sentropic/oauth-verify` (already available in Phase 1) — no local `FileOAuthStore`.

## 7. Migration phases (concrete deltas)

### Phase 1 — RS migration (in flight, parallel background agent)

- Add `@sentropic/mcp-auth@0.1.0` + `@sentropic/oauth-verify@0.1.0` to `package.json`.
- Replace the RS-side verification path in `src/entrypoints/oauth-http.ts` with `oauth-verify` (PRM + `WWW-Authenticate` + verify). Local AS (`SingleTenantOAuthProvider`) retained so the current end-to-end flow still works.
- No change to the 29 tools; no change to Wave GraphQL calls.
- No change to `env.WAVE_AUTH_MODE`; both `bearer_passthrough` and `env_token` still supported.
- Hand-author the adapter shape (`AppConnectorProviderAdapter`) as a TypeScript interface in `src/adapters/` (or equivalent) to match `SPEC_EVOL_APP_MCP_PROVIDER_PLATFORM.md §4` — that is Phase 1's Wave-side "type-only" preparation. No runtime wiring yet.

### Phase 2 — Full adapter adoption (blocked on `@sentropic/mcp-platform@0.1.0` npm publish)

- Add `@sentropic/mcp-platform@0.1.0` to `package.json`; drop the hand-authored types in favour of the published import.
- Rewrite `src/entrypoints/oauth-http.ts` as a platform entrypoint: register the Wave `AppConnectorProviderAdapter` with the platform and delegate transport/session ownership.
- Delete: `src/server/oauth/single-tenant-provider.ts`, `src/server/oauth/file-store.ts`, `src/server/oauth/hono-oauth-router.ts`, the in-process `sessions` `Map`, and the `SingleTenantOAuthProvider`/`FileOAuthStore` imports.
- Convert `env.WAVE_DEFAULT_BUSINESS_ID` reads to `resolveTenant().connectorConfig.waveBusinessId`.
- Convert `env.WAVE_API_TOKEN` reads to `resolveTenant().secrets.waveAccessToken` (SealedSecretHandle resolution on each call).
- Wire the manifest (§2) into `AppMcpProviderManifest`: category, writesWave, idempotency, requiresHumanConfirmation, elicitation surfaces per §5.
- Wire audit events (§4) into the platform's `audit.emit(...)`.

### Phase 3 — Cleanup

- Remove `WAVE_AUTH_MODE=bearer_passthrough` (obsoleted by platform-managed secrets).
- Retain `WAVE_AUTH_MODE=env_token` only if the platform doesn't cover local-dev/CI probes; otherwise delete the switch entirely.
- Delete the "single-tenant" language from README/docs; the connector is per-tenant by construction.

## 8. Open questions for the conductor

Numbered so the conductor can answer inline.

1. **Dynamic tool visibility.** Does `AppMcpProviderManifest` allow declaring a capability whose visibility depends on the resolved tenant state (e.g. `list_client_profiles` only shown if the business has at least one profiled customer)? Or is visibility strictly capability-static, with runtime absence surfaced via `deny-as-missing` at `invokeTool` time?

2. **`SealedSecretHandle` shape.** What is the type? Options seen in the ecosystem: (a) opaque token that the connector passes to a platform `getSecret(handle)` async call; (b) a getter function `() => Promise<string>`; (c) a signed reference the connector forwards to a downstream service. The audit implication differs (case (a) gives the platform a hook to audit every read).

3. **Elicitation surface location on the tool descriptor.** Does the elicitation payload schema live inline on `CapabilityTool` (a field like `elicitation: { fields: [...] }`), or on a separate `elicitationPolicy` manifest field keyed by tool name? The freeze notes say `gates.requiresElicitation` is already frozen — but the *content* (what fields to show) needs a shape decision.

4. **`upsert_product` splitting.** The manifest expects one idempotency profile per capability. `upsert_product` today routes on `id` presence (create vs patch, different idempotency). Options: (a) split into `create_product` + `patch_product` two capabilities in the manifest; (b) allow a per-branch idempotency descriptor; (c) declare the aggregate as `non-idempotent` and let elicitation flag the branch. Preference from Wave side: (a) at Phase 2 (breaking change on the wire), keep (c) at Phase 1 to avoid a churn. What does the platform prefer for consistency with other connectors?

5. **`domain` field carrier.** The freeze note says audit is extensible via `{domain, domainMeta}`. Is `domain` set by the connector on emit, or derived by the platform from the connector identity? If the platform derives it, the connector emits only `domainMeta`.

6. **Email recipient redaction in audit.** For `send_invoice` / `send_invoice_payment_receipt`, does the platform prefer (a) full recipient email in `domainMeta.emailRecipients` (opt-in raw for compliance), (b) `local@domain` → `sha256` per-recipient hash, or (c) a bucket-only count? Preference from Wave side: (b) with a per-tenant policy override, but this is a platform-wide compliance call.

7. **`resolveTenant.workspaceId`.** Do Wave-scoped operations need to record `workspaceId` in `domainMeta`, or is it a platform-only concern? If the tenant has multiple STP workspaces each with a different `waveBusinessId`, the audit event should probably carry both.

8. **Transitional `env_token` mode after Phase 2.** After the platform lands with per-tenant secrets, do we keep `WAVE_AUTH_MODE=env_token` for local dev / CI probes, or does the platform provide a test-tenant harness (`./testing` per the freeze notes) that removes the need? A crisp yes/no lets us schedule Phase 3.

9. **Broker-aware capabilities on writes.** The 2026-07-11 conductor update said the first broker proof is READ-ONLY (Wave writes wait for stronger grant/audit). Does the manifest allow declaring a write capability as "affordance visible, but grant-gated" so the read-only broker can still list the affordances without exposing them as callable? (The freeze notes suggest yes via `gates.requiresElicitation`, but the semantics of "listed but not callable" need confirmation.)

10. **Nomenclature.** The freeze mentions `defineStpConnector` as a helper name "not yet frozen". If it lands under a different name (`defineAppConnector`, `defineMcpProvider`, ...), what should Wave use in Phase 1 docs — a placeholder alias, or the `AppConnectorProviderAdapter` interface directly?

---

## Appendix A — mapping to `src/server/tool-registry.ts` order

The registry orders tools by implementation phase (A.5 reads → B.1 writes → B.3 workflows → B.4 transactions). The manifest section reuses that order for auditability against the code. Any future re-ordering of `tool-registry.ts` MUST be reflected here (or vice versa) in the same PR.

## Appendix B — References

- `src/server/tool-registry.ts` — the 29-tool list, source of truth.
- `src/tools/**/*.ts` — schemas, descriptions, handlers.
- `src/entrypoints/oauth-http.ts` — current transport + session + OAuth wiring.
- `src/server/oauth/single-tenant-provider.ts`, `src/server/oauth/file-store.ts` — to be deleted at Phase 2.
- `~/src/sentropic/spec/SPEC_EVOL_APP_MCP_PROVIDER_PLATFORM.md` — target contract (peer-owned repo; do not read from here — clarifications via h2a with `claude:sentropic:80b490c9bcc2`).
- Prior manifest evidence forwarded 2026-06-26 (h2a env `env:1793051760000:architect-ack-wave-manifest-forwarded`).
- Freeze disposition 2026-07-12 (h2a env `env:conductor-20260712-wave-disposition`): MUST-in-0.1.0 = write affordances + elicitation visible from read, `resolveTenant {tenantId, connectorConfig}`, audit `{domain, domainMeta}` extensible.
