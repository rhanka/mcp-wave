# mcp-wave Program Plan

Updated: 2026-05-18

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

### WP-MCP-04 - Imported-transaction reconciliation gap `[in_progress]`

**Decision**
- Keep the public-API track honest: no fake reconciliation tool claims.

**Outcome**
- explicit capability matrix in docs and UAT
- clear distinction between:
  - invoice-payment reconciliation
  - remittance-entry creation
  - imported-bank-transaction reconciliation

**Exit**
- UAT script and operator docs state exactly what is and is not automated
- product decision recorded on whether to open a browser-automation spike

### WP-MCP-05 - Multi-tenant auth readiness `[planned]`

**Outcome**
- confirm whether Wave OAuth is viable for third-party enrollment
- if viable: define bearer-passthrough or managed-token mode per deployment surface
- if not viable: define explicit fallback operating model

**Exit**
- one chosen auth model for the self-enrollment app

### WP-MCP-06 - Deployment and ops hardening `[planned]`

**Outcome**
- Cloud Run validation path
- Scaleway production path
- secret management, health checks, smoke checks, operator runbooks

**Exit**
- deployed MCP with a repeatable ops path

## Track 2 - Self-enrollment application

**Goal:** ship a Svelte SPA using the Sentropic design system plus a TypeScript
backend so end users can enroll their Wave session themselves, obtain a managed
MCP endpoint/config, and let us operate the service.

### Recommended architecture

- `npm` workspaces in this repo
- `apps/console-web`: Svelte SPA, Sentropic design system
- `apps/console-api`: TypeScript backend, preferably Hono for consistency
- `src/`: existing MCP service kept as the MCP runtime until an explicit repo split

### WP-APP-01 - Workspace and system boundaries `[planned]`

**Outcome**
- decide monorepo layout
- define responsibility split between SPA, app backend, and MCP runtime
- define shared config/package strategy

**Exit**
- agreed file layout and deployment topology

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

### WP-CLAUDE-01 - Feasibility spike `[planned]`

**Outcome**
- confirm what Claude.ai actually supports for:
  - personal secret storage
  - remote MCP connection UX
  - store/plugin packaging

**Exit**
- written go/no-go decision based on current Anthropic capabilities

### WP-CLAUDE-02 - Packaging path `[blocked by WP-CLAUDE-01]`

**Outcome**
- define the shipping format if the store/plugin path is real

**Exit**
- one approved distribution format

### WP-CLAUDE-03 - Fallback distribution `[planned]`

**Outcome**
- keep a first-class generic remote-MCP path even if the Claude store path exists

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

1. Finish `UAT-R1` on the current MCP track.
2. Record the product decision for `WP-MCP-04`:
   - `A`: stay public-API-only and keep imported-bank reconciliation manual
   - `B`: open a separate browser-automation/private-surface spike
3. Write the dedicated technical implementation plan for `WP-APP-01`.
4. Only after `WP-MCP-05`, execute `WP-APP-02`.
5. Run `WP-CLAUDE-01` only after the app track has a stable enrollment model.

## Immediate next actions

- Validate `audit_account_mapping` on the real Wave business.
- Capture one real Payevo remittance example for `UAT-R1`.
- Decide whether imported-transaction automation is:
  - out of scope for the public-API connector
  - or a separate non-public/browser-automation track
- After that decision, open the detailed implementation plan for `WP-APP-01`.
