# Follow-ups from Wave API discovery (2026-05-09)

Captured during CDP-driven inspection of `developer.waveapps.com`, before any implementation tool was written. These findings supersede the "TODO/verify against schema" caveats noted in the spec and plan.

The official Wave developer docs were last refreshed **March 31, 2026** — the API is actively maintained, not deprecated.

## 1. Authentication & token availability

**Confirmed:** Both auth flows still exist.

| Flow | Use case | Status |
|---|---|---|
| **Full Access Token** | personal / dev / single-tenant (our option A) | available — create via `developer.waveapps.com` → Manage Applications → app → "Create token" |
| **OAuth 2** | multi-tenant connector (our future option C.1) | available, but the target user must have an active **Pro or Wave Advisor** subscription to grant access |

**Action before Task B.0** (introspection):
1. Log into the Wave account holding the businesses.
2. Visit **Manage Applications** (`developer.waveapps.com/hc/en-us/articles/360019762711-Manage-Applications`).
3. Create an Application if none exists.
4. Generate a Full Access Token.
5. Export as `WAVE_API_TOKEN` and run `npm run codegen:introspect` to overwrite `data/wave-schema.graphql` with the real schema (replacing the hand-stub from Task A23).

The OAuth subscription gate is a **new restriction** since the spec was drafted. It does not affect v1 (option A), but it changes the C.1 ramp: any user we want to onboard must already be on a paid Wave plan. Add this to README "Status & roadmap" before tagging v0.2.0.

## 2. Schema findings — mutations that exist (verbatim from API Reference)

**Updates to the implementation plan.** Verified names from `developer.waveapps.com/hc/en-us/articles/360019968212-API-Reference`.

### Invoices

- `invoiceCreate`, `invoicePatch`, `invoiceClone`, `invoiceDelete`, `invoiceSend`, `invoiceApprove`, `invoiceMarkSent` ✓ as planned
- **`invoicePaymentCreateManual`** ← record a manual payment against an invoice. Input type is `InvoicePaymentCreateManualInput { amount: Decimal!, exchangeRate: Decimal!, invoiceId: ID!, memo: String, paymentAccountId: ID!, paymentDate: Date!, paymentMethod: InvoicePaymentMethod! }`. **Replaces the `NOT_IMPLEMENTED` stub in Task B5** (`mark_invoice_paid`). Re-plan: `mark_invoice_paid` becomes a one-liner over this mutation; Task B11 `match_transaction_to_invoice` is no longer needed for the v1 payment-recording workflow.
- `invoicePaymentUpdate`, `invoicePaymentDelete`, `InvoicePaymentReceiptSend` (note PascalCase on the last one) — relevant for v1.1.

### Customers / Accounts / Sales Tax / Products

All as planned: `customerCreate/Patch/Delete`, `accountCreate/Archive/Patch`, `salesTaxCreate/Patch/Archive`, `productCreate/Patch/Archive`. **Note:** there is no `accountDelete` — accounts are archived, not deleted.

### Money transactions — IMPORTANT: behavior differs from plan

- `moneyTransactionCreate` ← **BETA**, requires `Business.isClassicAccounting === false`.
- `moneyTransactionsCreate` (plural) ← bulk create, also BETA, same constraint.
- `moneyDepositTransactionCreate` ← specific shape for deposits.
- **No `moneyTransactionSplit` mutation exists in the public schema.**
- **No `moneyTransactionCategorize` mutation exists in the public schema.**
- A transaction is built with `MoneyTransactionCreateLineItemInput` items — taxes are applied per-line at creation time.

### Estimates (entire domain not in v1, opportunities for v1.1)

`estimateApprove`, `estimateClone`, `estimateCreate`, `estimateDelete`, `estimateGeneratePdf`, `estimateMarkAccepted`, `estimateMarkSent`, `estimatePatch`, `estimatePaymentDelete`, `estimateResetAcceptance`, `estimateSendAcceptanceCustomerEmail`, `estimateSend`, `EstimateDepositPaymentReceiptSend`, **`convertEstimateToInvoice`**.

## 3. Plan/spec impacts — what to revise

### Impact A — `mark_invoice_paid` simplifies dramatically

**Task B5 in the plan** currently ships as a `NOT_IMPLEMENTED` stub and references composing `create_transaction` + `match_transaction_to_invoice`. Replace with a thin wrapper over `invoicePaymentCreateManual(input: InvoicePaymentCreateManualInput)`. Required fields (verified post-introspection): `invoiceId`, `amount`, `paymentDate`, `paymentAccountId`, `paymentMethod`, `exchangeRate` (1.0 when same currency), optional `memo`.

**Task B11** (`match_transaction_to_invoice`) becomes optional for v1 — keep it for completeness if Wave provides the mutation, but it's no longer on the critical path for the `mark_invoice_paid` workflow.

### Impact B — `split_payroll_remittance` needs redesign

The plan (Task B16) and spec §10 assume a `MoneyTransactionSplit` mutation that takes an existing `transaction_id` and replaces its splits. That mutation does not exist in the public schema.

**Three viable options, to decide before Task B16 starts:**

**B.1 — Multi-line creation at posting time.** When the user *creates* the DAS remittance as a Wave transaction, they pass multiple `MoneyTransactionCreateLineItemInput` entries (one per authority). This becomes the canonical pattern: the MCP composes a multi-line `moneyTransactionCreate` instead of post-hoc splitting.

- **Pros:** uses an actually-existing mutation; single atomic posting.
- **Cons:** requires `isClassicAccounting=false` (BETA). Doesn't help for *already-imported* bank transactions.

**B.2 — Delete + recreate (compensating).** If the bank-imported transaction already exists, delete it and re-create as a multi-line transaction.

- **Pros:** handles imported transactions.
- **Cons:** loses any auto-categorization context, awkward UX for the user, requires `moneyTransactionDelete` (verify exists).

**B.3 — Document the gap.** Note in v1: only newly-created multi-line transactions are supported. Imported single-line transactions stay as-is; the user splits manually in the Wave UI.

**Default decision (TBD with user at start of Task B16):** ship B.1 as the v1 happy path, document B.3 as the limitation, defer B.2 to v1.1 if requested. Spec §10 must be revised accordingly.

### Impact C — categorization workflow not API-driven

Task B9 (`categorize_transaction`) in the plan currently calls `moneyTransactionCategorize` which does not exist. Either:
- Drop the tool (rely on multi-line creation in B.1 above).
- Use `moneyTransactionsPatch` if such a mutation exists — TODO confirm at introspection time.

### Impact D — `isClassicAccounting` gating

The `moneyTransactionCreate` mutation says **"Requires `isClassicAccounting` to be `false`"**. The MCP must:
- Add a `business_settings` (or similar) query to detect this flag on the active business.
- At tool startup or first call, log a clear `CLASSIC_ACCOUNTING_NOT_SUPPORTED` error if the active business is on classic accounting.
- Document in README + the plan's Task B25 (registry smoke test) that money-transaction tools are inactive on classic-accounting businesses.

## 4. Other observations

- The doc portal is a Zendesk hosting (`developer.waveapps.com/hc/en-us/...`). Anchors include `https://my.waveapps.com/login/` flows.
- The Get Started section is light; the actual technical content lives in `categories/360001114072-Documentation` with subsections **Get Started**, **Create an App**, **Examples**, **Schema**.
- `/applications/` and `/api-tokens/` on `my.waveapps.com` return 404 (paths moved or never existed). The token UI lives under the developer-portal authenticated view at `Manage Applications`.
- Wave's account currency-conversion and multi-business handling are fully exposed in the schema (`businesses` query with `isArchived` filter, `business(id)` with nested fields).

### Impact F — Wave public schema exposes no transaction *reads* and no financial reports

Confirmed during Phase A.5 via exhaustive grep on `data/wave-schema.graphql`:

- **Transactions reads do not exist.** `type Business` has no `moneyTransactions` connection and no `moneyTransaction(id:)` field; `type Query` has no transaction surface; `type Transaction` is a stub `{ id: ID! }`. Money-transaction *mutations* (create/delete) exist but no way to list/get. Plan tasks A35 (`list_transactions`) and A36 (`get_transaction`) are NOT shippable against the current public schema.
- **Financial reports do not exist.** No `profitAndLoss`/`balanceSheet`/`Report`/`AccountingBasis` types anywhere in the schema. Plan task A40 (`profit_and_loss` / `balance_sheet`) is NOT shippable.

**Action taken:** A35, A36, A40 dropped from Phase A.5 implementation. A.5 ships 12 read tools instead of the planned 14-15.

**Action for follow-up:** if Wave later exposes reads or reports, revisit. Option for a future workaround: a `current_account_balances` snapshot tool reading `business.accounts` with their current `balance` — a *very* limited stand-in for a balance sheet. Not implementing now; needs user sign-off first.

### Impact E — Retry-After header is not honored by `withRetry`

Spec §12 calls for honoring `Retry-After` on 429 responses, but A.3 ships a fixed exponential backoff (`factor: 2, minTimeout: 500, maxTimeout: 5000`) in `src/lib/retry.ts`. Wave 429s carry the value via `ClientError.response.headers`, and the mapped `WaveApiError` keeps the raw error object in `waveDetails`, so the data is reachable — what's missing is wiring it into a `p-retry` `onFailedAttempt` hook or a custom delay computation.

**Action:** revisit at the start of Phase B (write tools) when 429s become more likely under sustained writes. Until then, the fixed backoff is acceptable for read-only traffic and is plenty conservative.

## 5. Concrete action items before resuming the plan

- [ ] **User**: log into Wave, navigate to Manage Applications, create an App, generate Full Access Token, store in `.env` as `WAVE_API_TOKEN`.
- [ ] **User or me**: run `npm run codegen:introspect` once Wave token is set. Replaces `data/wave-schema.graphql`.
- [ ] **Me**: revise the implementation plan to:
  - Replace Task B5 stub with `invoiceManualPaymentCreate` wrapper.
  - Redesign Task B16 (`split_payroll_remittance`) following option B.1, document B.3 as v1 limitation.
  - Adjust or drop Task B9 (`categorize_transaction`).
  - Add `isClassicAccounting` precondition check + clear error in Phase A.3.
- [ ] **Me**: revise the spec (§10 workflow) to match the new pattern.

Once these are done, Phase 2 of execution (subagent-driven A6–A44) can start safely.
