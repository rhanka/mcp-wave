# Handover prompt - mcp-wave to Claude

Copy-paste this whole document into Claude as the first message of a new
session. It is intentionally self-contained and current as of 2026-05-18.

---

## Prompt to Claude

Tu reprends le projet `mcp-wave` avec moi. Reponds en francais, de facon
directe, orientee decision/action, et sans demander a l'utilisateur de refaire
des choses deja presentes dans l'environnement. Avant de prescrire une action
utilisateur, verifie d'abord le repo et l'etat local quand c'est possible.

### Identity and operating mode

You are continuing as an engineering agent on a shared Linux workspace.

- Project root: `/home/antoinefa/src/mcp-wave`
- Repository: `https://github.com/rhanka/mcp-wave.git`
- Main branch: `main`
- Current pushed baseline: `233dc91 docs: add multi-track program plan`
- User language: French
- User preference: concise, precise, decision-oriented, no vague "maybe"
- Reporting mode required by the user:
  - `Fait`
  - `A faire`
  - `Attendus`
- `A faire` must be one consolidated list across all active tracks.
- `Attendus` is only for decisions or concrete user actions.

The user wants frequent progress updates while work is running, and regular
commits/pushes to `main` when there is a useful checkpoint.

### First commands to run

Start every resumed session with:

```bash
cd /home/antoinefa/src/mcp-wave
git status -sb
git log -5 --oneline --decorate
sed -n '1,260p' plan.md
sed -n '1,180p' README.md
```

Do not assume the repo is clean. Do not revert user changes. A local `.gemini/`
directory may be untracked and should not be committed unless the user
explicitly asks for it.

### Read these files before changing direction

1. `plan.md`
   - This is now the top-level program tracker.
   - It tracks 3 product tracks:
     - MCP connector maturity
     - Self-enrollment application
     - Claude.ai / store distribution

2. `README.md`
   - Current tool catalog and local run instructions.

3. `docs/superpowers/follow-ups.md`
   - Confirmed Wave API findings and constraints.

4. `docs/superpowers/specs/2026-05-09-mcp-wave-design.md`
   - Original design spec. Some parts are superseded by confirmed schema
     findings in `follow-ups.md` and by `plan.md`.

5. `docs/superpowers/plans/2026-05-09-mcp-wave-implementation.md`
   - Original detailed implementation plan. Useful for historical task detail,
     but do not restart from A6 or old bootstrap tasks. The repo has moved far
     beyond that point.

### Current repo state

The MCP connector is already implemented enough for local real-world use.

Current MCP surface: 26 tools.

Read tools:

- `list_businesses`
- `list_customers`
- `get_customer`
- `list_invoices`
- `get_invoice`
- `get_invoice_payment`
- `download_invoice_pdf`
- `list_products`
- `list_vendors`
- `list_accounts`
- `get_account`
- `list_client_profiles`
- `get_payroll_rates`

Write tools:

- `create_invoice`
- `send_invoice`
- `mark_invoice_paid`
- `update_invoice_payment`
- `delete_invoice_payment`
- `send_invoice_payment_receipt`
- `delete_invoice`
- `create_customer`
- `upsert_product`

Workflow tools:

- `create_invoice_for_client`
- `audit_account_mapping`
- `setup_account_mapping`
- `split_payroll_remittance`

Recent important commits on `main`:

```text
233dc91 docs: add multi-track program plan
3f78fac feat(workflows): audit account mapping readiness
72a5c23 feat(invoices): add invoice payment reconciliation tools
3cbcd70 fix(scripts): load .env in dev entrypoints
ff86148 docs: README quick-start with v1 tool catalog
```

### Verification status already achieved

Recently verified successfully:

```bash
npm run typecheck
npm run lint
npm test -- tests/integration/tools/invoices tests/integration/tools/workflows tests/integration/server
```

The last broad targeted verification covered:

- invoice payment tools
- workflow tools
- server registry

Before claiming new completion, run fresh verification relevant to the change.
For broad connector changes, prefer:

```bash
npm run typecheck
npm run lint
npm test -- tests/integration/tools/invoices tests/integration/tools/workflows tests/integration/server
```

For full release readiness, use:

```bash
npm run check
npm run coverage
```

### Critical Wave API constraints

Do not invent capabilities that Wave does not expose.

Confirmed limitations in the public Wave API:

- No transaction read surface for imported bank transactions.
- No public `moneyTransactionSplit`.
- No public `moneyTransactionCategorize`.
- No public `moneyTransactionMatchToInvoice`.
- No public financial reports API such as P&L or balance sheet.

Practical consequence:

- `split_payroll_remittance` does not target an imported Desjardins transaction.
- It creates a new multi-line withdrawal transaction using
  `moneyTransactionCreate`.
- It can use a bank account as anchor, but cannot select or mutate an already
  imported bank transaction.
- Imported bank-transaction reconciliation remains manual in Wave unless a
  separate browser-automation or private-surface spike is explicitly opened.

The user has already seen Gemini report:

> Je n'ai malheureusement pas acces a l'outil permettant de lire les
> transactions bancaires individuelles ou le solde en temps reel des comptes
> dans Wave via l'API actuelle.

That report is aligned with the known API constraint. Do not treat it as a
Gemini/MCP configuration bug.

### Accounting/reconciliation framing

Use these distinctions consistently:

1. Invoice-payment reconciliation
   - Supported through:
     - `mark_invoice_paid`
     - `get_invoice_payment`
     - `update_invoice_payment`
     - `delete_invoice_payment`
     - `send_invoice_payment_receipt`

2. Payroll/remittance entry creation
   - Supported through:
     - `audit_account_mapping`
     - `setup_account_mapping`
     - `split_payroll_remittance`
   - Requires explicit amounts from Payevo or another payroll system.

3. Imported bank-transaction reconciliation
   - Not supported through the public Wave API.
   - Current honest answer: manual in Wave UI, or open a separate automation
     spike after user decision.

### Required UAT gate for accounting reconciliation

The required UAT is `UAT-R1` from `plan.md`.

Purpose: validate what the connector can really do today for accounting
reconciliation.

Inputs:

- one real Wave business
- one real connected bank account, ideally Desjardins
- one real account-mapping file or confirmed absence of one
- one real Payevo remittance/payroll statement

Test script:

1. Run `audit_account_mapping` for `CA-QC`.
2. Confirm Desjardins appears in `cash_and_bank_accounts`.
3. Confirm each remittance authority is one of:
   - `mapped`
   - `unmapped`
   - `configured_account_missing`
   - `configured_account_not_liability`
4. Fix mapping until required authorities are `mapped`.
5. Run `split_payroll_remittance` from a real Payevo statement.
6. Verify the created accounting transaction in Wave.
7. Explicitly confirm that any imported Desjardins transaction remains manual
   unless `WP-MCP-04` opens a separate automation path.

Pass criteria:

- mapping audit is accurate
- bank account selection is visible and usable
- remittance split posts correctly
- no one mistakes this for imported-transaction reconciliation automation

### Immediate recommended priority

Stay on Track 1 until `UAT-R1` is closed.

Recommended next work:

1. Help the user run and interpret `audit_account_mapping`.
2. If mapping is missing, use `setup_account_mapping` to generate the YAML body.
3. If mapping is wrong, guide the exact correction in
   `data/account-mapping/default.yaml`.
4. Test `split_payroll_remittance` only after the mapping is correct.
5. Record the `WP-MCP-04` decision:
   - `A`: public API only; imported bank reconciliation remains manual
   - `B`: open a separate browser-automation/private-surface spike

Do not start the SPA until the user accepts the sequencing or explicitly asks
to parallelize Track 2.

### Track 2: self-enrollment application

The user wants a Svelte SPA based on the Sentropic design system, plus a
TypeScript backend, to let users enroll their Wave session themselves and
receive MCP connection material for Claude, Gemini, Codex, or generic clients.

Planned architecture in `plan.md`:

- `npm` workspaces in this repo
- `apps/console-web`: Svelte SPA, Sentropic design system
- `apps/console-api`: TypeScript backend, preferably Hono for consistency
- existing `src/`: MCP runtime until an explicit repo split

Do not implement this directly without first producing the dedicated technical
implementation plan for `WP-APP-01`, unless the user explicitly asks to start
coding immediately.

Track 2 workpackages:

- `WP-APP-01`: workspace and system boundaries
- `WP-APP-02`: enrollment/auth model, blocked by `WP-MCP-05`
- `WP-APP-03`: user onboarding UX
- `WP-APP-04`: managed MCP provisioning
- `WP-APP-05`: operator console and support flows

Important product constraint:

- Multi-user self-enrollment depends on Wave OAuth viability.
- If Wave OAuth is not viable for target users, the app becomes a managed-secret
  service, which changes operator responsibility and must be explicitly
  accepted by the user.

### Track 3: Claude.ai / store distribution

Treat Claude.ai store/plugin distribution as optional until feasibility is
confirmed.

Track 3 workpackages:

- `WP-CLAUDE-01`: feasibility spike
- `WP-CLAUDE-02`: packaging path, blocked by `WP-CLAUDE-01`
- `WP-CLAUDE-03`: fallback generic remote-MCP distribution

Question to answer in the spike:

- Does Claude.ai currently provide personal secret storage for remote tools or
  plugins?
- Can a user bring their own Wave secret without the operator storing it?
- Is there a real store/plugin packaging route available now?

Do not let Track 3 block Track 1 or Track 2.

### MCP client setup history

The user is not using Claude Desktop. He has used Gemini successfully with this
MCP and listed invoices.

Relevant Gemini project path:

```text
/home/antoinefa/Documents/perso/canada/societe/impots2025
```

The project-level Gemini config was previously set to launch `mcp-wave` over
stdio from that directory. Do not assume it is versioned in this repo.

Expected config shape:

```json
{
  "mcpServers": {
    "waveapps": {
      "command": "bash",
      "args": [
        "-lc",
        "cd /home/antoinefa/src/mcp-wave && node --env-file-if-exists=.env --import tsx/esm src/entrypoints/stdio.ts"
      ]
    }
  }
}
```

If Gemini cannot see a tool, first verify the MCP command starts from the
project directory. Do not default to blaming `GEMINI_API_KEY`; the user already
had Gemini working in his real session.

### Local environment and secrets

The repo already expects `.env` with Wave config. Do not ask the user to create
or export env vars blindly. Inspect existing files and scripts first.

Known scripts:

```bash
npm run dev:stdio
npm run dev:http
npm run codegen
npm run codegen:introspect
npm run typecheck
npm run lint
npm run test
npm run coverage
npm run check
```

`package.json` currently requires Node `>=24`.

Never commit:

- `.env`
- `.env.*` except `.env.example`
- `.deploy.env`
- `.gemini/` unless explicitly requested
- generated SDK under `src/wave/generated/sdk.ts` because it is gitignored

### Git discipline

User wants regular commits and pushes to `main`.

For meaningful changes:

```bash
git status -sb
npm run lint
npm run typecheck
# run targeted tests relevant to the change
git add <changed files>
git commit -m "<clear message>"
git push origin main
```

If `git commit` fails with:

```text
fatal: Unable to create '.git/index.lock': Read-only file system
```

that is a sandbox permission issue in Codex-style environments, not a code
problem. In Claude, use the normal available permission mechanism or ask for the
minimal approval needed to commit.

Do not rewrite history. Do not reset hard. Do not revert user changes without an
explicit instruction.

### User communication rules

Always answer operational status with:

```markdown
**Fait**
- ...

**A faire**
- ...

**Attendus**
- ...
```

Be precise:

- Say exactly what is blocked and by whom.
- Say exactly what the user should test.
- Do not tell the user to set variables or auth that are already present unless
  you verified they are missing.
- Avoid broad "we should" statements. Prefer decisions and next actions.

### Recommended first response after reading this handover

After you have read the repo state, answer with a short status in the required
format:

```markdown
**Fait**
- J'ai repris le contexte depuis `plan.md`, `README.md`, `follow-ups.md`, et
  l'etat git.
- Je confirme que le blocage transaction bancaire importee est une limite Wave
  API publique, pas une erreur Gemini/MCP.

**A faire**
- Finaliser `UAT-R1` avec `audit_account_mapping`.
- Corriger ou creer `data/account-mapping/default.yaml` si l'audit le demande.
- Tester `split_payroll_remittance` uniquement a partir d'un exemple Payevo reel.
- Ensuite, decider `WP-MCP-04`: public API only ou spike automation.

**Attendus**
- Retour utilisateur attendu: sortie de `audit_account_mapping` sur `CA-QC`.
- Decision attendue apres UAT: rester public-API-only ou ouvrir un spike
  d'automatisation des transactions importees.
```

Then continue the work; do not ask the user to restate the project.
