# mcp-wave Program Plan

Updated: 2026-05-20

This file is the top-level program tracker. It does not replace the detailed
implementation material already stored in:

- `docs/superpowers/specs/2026-05-09-mcp-wave-design.md`
- `docs/superpowers/plans/2026-05-09-mcp-wave-implementation.md`
- `docs/superpowers/follow-ups.md`

It exists to track the product across 3 tracks:

1. MCP connector maturity
2. Self-enrollment application
3. Claude.ai distribution

## Reporting mode

Every status update follows exactly this shape:

- `Fait`
- `A faire`
- `Attendus`

`A faire` is a single consolidated list across all open tracks.
`Attendus` is reserved for decisions or concrete user actions.

## Hard constraints already confirmed

1. **Wave public API does not expose imported bank transactions for read/reconcile/split/match.**
   - No public transaction read surface.
   - No public `moneyTransactionSplit`.
   - No public `moneyTransactionCategorize`.
   - No public `moneyTransactionMatchToInvoice`.

2. **Therefore `split_payroll_remittance` is not a transaction-targeting tool.**
   - It is a write tool that creates a new multi-line accounting transaction.
   - It can use a bank account as the anchor account.
   - It cannot target an already imported Desjardins transaction through the public API.

3. **Imported-transaction reconciliation remains a separate product problem.**
   - v1 MCP can manage invoice-payment records and create remittance entries.
   - v1 MCP cannot automate the reconciliation of imported bank transactions in Wave.
   - If we need that automation, it becomes a separate spike using browser automation
     or a non-public surface. That is not part of the public-API track.

4. **Third-party self-enrollment depends on Wave auth reality.**
   - Single-tenant env token is already viable.
   - Multi-user self-enrollment depends on the real feasibility of Wave OAuth for each tenant.
   - If OAuth is not sufficient, the app track becomes a managed-secret product and changes
     the operating model.

5. **Claude.ai distribution is optional and must not block the MCP or the app.**
   - Treat it as a third track with its own feasibility gate.

## Current baseline

- `main` currently includes:
  - MCP stdio + HTTP transport
  - invoice read/write surface
  - invoice payment reconciliation tools
  - payroll remittance split creation
  - account-mapping audit
- Current MCP surface: 26 tools.
- Latest validated constraints are reflected in `README.md` and the tool descriptions.

## Track 1 - MCP connector maturity

**Goal:** reach a production-grade MCP connector that is honest about public Wave API
limits, useful for daily bookkeeping, and safe to operate.

### WP-MCP-01 - Core transport and server foundation `[done]`

**Outcome**
- stdio transport
- Streamable HTTP transport
- auth mode selection
- testable registry and server wiring

**Exit**
- local MCP works over stdio and HTTP

### WP-MCP-02 - Read/write accounting surface `[done]`

**Outcome**
- businesses, accounts, customers, invoices, products, vendors
- invoice send/delete/manual payment
- invoice payment read/update/delete/receipt send

**Exit**
- invoice and invoice-payment workflows are usable through MCP

### WP-MCP-03 - Payroll remittance readiness `[done, UAT pending]`

**Outcome**
- `split_payroll_remittance`
- `setup_account_mapping`
- `audit_account_mapping`

**Exit**
- user can audit mappings, select the bank account, and create a remittance
  split from payroll-system outputs

### WP-MCP-04 - Imported-transaction reconciliation gap `[decided: option A, UAT pending]`

**Decision (2026-05-18)**
- Option **A** retained: public-API only. Imported-bank-transaction reconciliation stays
  manual in the Wave UI. No browser-automation or private-surface spike opened.
- The connector documentation and UAT must keep stating this gap explicitly.

**Outcome**
- explicit capability matrix in docs and UAT
- clear distinction between:
  - invoice-payment reconciliation
  - remittance-entry creation
  - imported-bank-transaction reconciliation (manual, out of scope)

**Exit**
- UAT script and operator docs state exactly what is and is not automated
- decision recorded above; no automation track opened

### WP-MCP-05 - Multi-tenant auth readiness `[planned]`

**Outcome**
- confirm whether Wave OAuth is viable for third-party enrollment
- if viable: define bearer-passthrough or managed-token mode per deployment surface
- if not viable: define explicit fallback operating model

**Exit**
- one chosen auth model for the self-enrollment app

### WP-MCP-06 - Deployment and ops hardening `[planned]`

**Outcome**
- Scaleway/Kapsule validation and production path
- secret management, health checks, smoke checks, operator runbooks

**Exit**
- deployed MCP with a repeatable ops path

### WP-OPS-01 - Single-tenant Kapsule deploy `[implementation ready]`

**Context**
- Urgent deploy path extracted from `WP-MCP-06` so the current MCP can run
  persistently while Tracks 2 and 3 continue.
- Target platform is Scaleway only: Kapsule cluster in the POC project.
- Image registry is Scaleway Container Registry for now. Docker Hub public can
  be revisited later, but is not part of the current scope.
- No GCP/Cloud Run path is active for this WP.

**Outcome**
- Docker image build path for the current MCP runtime
- Kubernetes manifests/runbook for Deployment, Service, Ingress, Secret,
  health/readiness, and smoke check
- single-tenant Wave token operation, suitable for current personal use

**Decision (2026-05-20)**
- Option **2** retained: `WP-OPS-01` includes OAuth 2.x support before the first
  Kapsule deploy.
- Consequence: first live deploy must be usable by Claude.ai and Gemini remote
  clients, not only by a Gemini-only/shared-header MVP.

**Design spec**
- `docs/superpowers/specs/2026-05-20-wp-ops-01-oauth-kapsule-design.md`

**Implementation plan**
- `docs/superpowers/plans/2026-05-21-wp-ops-01-oauth-kapsule-implementation.md`

**Exit**
- MCP reachable from the personal Scaleway Kapsule environment with a repeatable
  redeploy path
- Claude.ai can complete an OAuth-backed remote MCP connection against the
  deployed endpoint

### WP-OPS-02 - Hono runtime migration (@hono/mcp) `[done]`

**Context**
- WP-OPS-01 shipped the OAuth remote MCP entrypoint on Express because the MCP
  SDK OAuth helpers are Express-only. This WP migrates the runtime to Hono.
- First attempt rebuilt the MCP server in-house (`@sentropic/mcp-hono`); then we
  found [`@hono/mcp`](https://www.npmjs.com/package/@hono/mcp), the off-the-shelf
  Hono MCP middleware (transport + OAuth toolkit on the SDK `OAuthServerProvider`),
  and adopted it instead — dropping the in-house framework and the hand-rolled
  OAuth router.

**Outcome**
- `@hono/mcp` provides the `StreamableHTTPTransport` + `bearerAuth` (RS), and the
  DCR / token (PKCE) / revoke / well-known handlers on the SDK provider. The MCP
  server is the SDK's `buildMcpServer` (faithful Zod schemas). Only the
  consent-gated `/authorize` is custom, over `SingleTenantOAuthProvider`.
- Removed `@sentropic/mcp-hono`, the hand-rolled `hono-oauth-router` handlers, and
  `token-verifier`; Express (`express`, `express-rate-limit`, `cors`, `supertest`)
  already gone. Added `@hono/mcp` + `hono-rate-limiter` to dependencies.
- Supersedes the WP-OPS-01 Express runtime; `deploy/scw` and the Docker image are
  unchanged (still run `dist/entrypoints/oauth-http.js`). Prod image smoke-validated.

**Implementation plan**
- `docs/superpowers/plans/2026-05-25-wp-ops-02-mcp-hono-migration.md`

## Track 2 - Self-enrollment application

**Goal:** ship a Svelte SPA using the Sentropic design system plus a TypeScript
backend so end users can enroll their Wave session themselves, obtain a managed
MCP endpoint/config, and let us operate the service.

### Recommended architecture

- `npm` workspaces in this repo
- `apps/console-web`: Svelte SPA, Sentropic design system
- `apps/console-api`: TypeScript backend, preferably Hono for consistency
- `apps/mcp-server`: existing MCP service moved out of root `src/` during
  `WP-APP-01`

### WP-APP-01 - Workspace and system boundaries `[cadrage]`

**Working decisions (2026-05-19)**
- scope: **B - scaffolding Hello**
- layout: move root `src/` to `apps/mcp-server`
- orchestration: npm workspaces only plus root scripts
- Sentropic source: npm package, exact package name still needed before install
- deployment target: Scaleway/Kapsule

**Outcome**
- decide monorepo layout
- define responsibility split between SPA, app backend, and MCP runtime
- define shared config/package strategy
- scaffold `apps/console-web`, `apps/console-api`, and `apps/mcp-server` enough
  to prove a Hello path without starting business/auth work

**Exit**
- agreed file layout and deployment topology
- both new apps can start, and console web can call a minimal console API route

### WP-APP-02 - Enrollment/auth model `[blocked by WP-MCP-05]`

**Outcome**
- user-level Wave enrollment flow
- token/session ownership model
- operator responsibility boundaries

**Exit**
- one approved enrollment model with explicit secret-handling rules

### WP-APP-03 - User onboarding UX `[planned]`

**Outcome**
- Sentropic-based Svelte flows for:
  - connect Wave
  - validate business access
  - inspect mapping readiness
  - generate MCP connection instructions

**Exit**
- a new user can reach a usable MCP connection without operator intervention

### WP-APP-04 - Managed MCP provisioning `[planned]`

**Outcome**
- provisioned remote MCP endpoint per enrolled user or tenant
- generated config snippets for Claude, Codex, Gemini, and generic MCP clients
- operator-visible connection state

**Exit**
- the app can hand the user a concrete MCP connection artifact

### WP-APP-05 - Operator console and support flows `[planned]`

**Outcome**
- inspect enrolled sessions
- rotate/revoke credentials
- view UAT state and support notes

**Exit**
- service is operable without shell-only workflows

## Track 3 - Claude.ai / store distribution

**Goal:** add Claude-facing distribution only after the MCP and enrollment app
are stable enough to justify it.

### WP-CLAUDE-01 - Feasibility spike `[done]`

**Outcome**
- completed in `docs/superpowers/claude-distribution-spike.md`
- Claude.ai supports custom remote MCP connectors, but requires OAuth 2.x for
  authenticated remote connectors; pasted static bearer tokens are not supported
- official Connectors Directory exists with manual Anthropic review
- deep link exists for pre-filling the Add custom connector modal
- policy risk remains around the Directory's "Financial transactions" wording

**Exit**
- written go/no-go captured with sources and recommendation

### WP-CLAUDE-02 - Packaging path `[blocked by OAuth + policy clarification]`

**Outcome**
- prepare a Directory submission path if OAuth is implemented and Anthropic
  confirms the Wave accounting use case is acceptable

**Exit**
- one approved distribution format

### WP-CLAUDE-03 - Fallback distribution `[planned, recommended]`

**Outcome**
- keep a first-class generic remote-MCP path even if the Claude store path exists
- include a Claude.ai deep link once a remote MCP endpoint and OAuth-compatible
  auth path exist

**Exit**
- Claude.ai is an optional channel, not a hard dependency

## Required UAT gates

### UAT-R1 - Accounting reconciliation readiness `[required before calling MCP mature on reconciliation]`

**Purpose**
- validate what the connector can really do today for accounting reconciliation

**Inputs**
- one real Wave business
- one real connected bank account, ideally Desjardins
- one real account-mapping file or the confirmed absence of one
- one real payroll/remittance statement from Payevo or equivalent

**Test script**
1. Run `audit_account_mapping` for `CA-QC`.
2. Confirm the bank account appears in `cash_and_bank_accounts`.
3. Confirm each remittance authority is either:
   - `mapped`
   - `unmapped`
   - `configured_account_missing`
   - `configured_account_not_liability`
4. Fix the mapping until all required authorities are `mapped`.
5. Run `split_payroll_remittance` with a real remittance statement.
6. Verify that the created accounting transaction is correct in Wave.
7. Explicitly confirm that the imported Desjardins transaction is still manual
   unless Track `WP-MCP-04` opens a separate automation path.

**Pass criteria**
- mapping audit is accurate
- bank account selection is visible and usable
- remittance split posts correctly
- no one mistakes this for imported-transaction reconciliation automation

### UAT-A1 - Enrollment application MVP `[required before opening to external users]`

**Purpose**
- validate that a new user can enroll and receive a usable MCP endpoint/config

**Pass criteria**
- successful enrollment
- usable MCP client config
- operator can inspect and revoke access

## Recommended execution order

Parallelization authorized by user on 2026-05-18. Tracks 1/2/3 run concurrently.

1. Track 1: close `UAT-R1`. `WP-MCP-04` is already decided (option A).
2. Track 1/ops: choose `WP-OPS-01` scope, then ship the single-tenant Kapsule
   deployment path.
3. Track 2: finish `WP-APP-01` cadrage, write the spec and implementation plan,
   then iterate.
4. Track 3: use the completed `WP-CLAUDE-01` spike to sequence deep-link
   fallback first and Directory packaging later.
5. `WP-APP-02` still blocked by `WP-MCP-05` (Wave auth reality).
6. `WP-CLAUDE-02` still blocked by OAuth implementation and policy clarification.

## Immediate next actions

- Track 1: collect real `audit_account_mapping` output on `CA-QC`, then a real
  Payevo statement, to close `UAT-R1`.
- WP-OPS-01: review the OAuth 2.x + Kapsule deploy design spec, then write the
  implementation plan after approval.
- Track 2: finish `WP-APP-01` cadrage by deciding shared TypeScript config,
  shared types/package strategy, and the exact Sentropic npm package name.
- Track 3: commit and use `docs/superpowers/claude-distribution-spike.md`; next
  actionable path is deep-link fallback plus OAuth prerequisite planning.
