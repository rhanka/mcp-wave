# Handover prompt — mcp-wave (2026-05-09)

Copy-paste this whole document into your next agent. It is self-contained.

---

## What you're picking up

You're continuing the implementation of **mcp-wave**: a TypeScript MCP (Model Context Protocol) server exposing Wave Accounting (waveapps.com) operations to Claude. Deployed serverlessly to GCP Cloud Run (test/validation) and Scaleway Containers (prod runtime).

**Project root**: `/home/user/src/mcp-wave/`
**Branch**: `main` (only branch, this is a from-scratch project)
**Owner**: Project owner (contact@example.com), French-speaking, Wave account on a Quebec (CA-QC) accounting setup. Address him in French.

## Read these files first, in this order

1. `docs/superpowers/specs/2026-05-09-mcp-wave-design.md` — full design spec, 15 sections.
2. `docs/superpowers/plans/2026-05-09-mcp-wave-implementation.md` — implementation plan, 82 numbered tasks (Part A foundations + read-only, Part B writes + workflows, Part C deployment).
3. `docs/superpowers/follow-ups.md` — **READ THIS CAREFULLY**. It captures real findings from inspecting the Wave API yesterday that materially change the plan.

## Where we are right now

**Part A Phase A.0 (bootstrap) is DONE and committed.** Tasks A1–A5 of the plan, on `main`:

```
ccfbe61 docs: follow-ups from Wave API discovery
b7ece3e chore: project skeleton directories with .gitkeep anchors
3010bdf chore: vitest config and smoke test
6fc631e chore: biome config
efd8362 chore: package.json, tsconfig, base dependencies
619aa25 chore: initial commit with spec and plan
```

`npm run check` (lint + typecheck + test) is green. Node 22.22.2, npm 8.3.0. 446 deps installed.

**Phase A.1 onwards (tasks A6 → A44) NOT STARTED.** Next task to execute is A6 (`src/config/env.ts` with Zod validation), exactly as written in the plan.

## What was just discovered about Wave's API (last commit)

I used Chrome DevTools Protocol (CDP) on the user's existing Chrome at `127.0.0.1:9222` to scrape the public Wave developer docs. Real findings, NOT assumptions:

- **API is alive**, docs refreshed 2026-03-31.
- **Full Access Token path is still open** for new developers. The user logged in and confirmed the app-creation UI exists at `https://developer-apps.waveapps.com/apps/create/` — no paywall, no "we're no longer accepting".
- **Schema differences from the plan** (see `follow-ups.md` §2-3):
  - `invoiceManualPaymentCreate` exists → Task B5 (`mark_invoice_paid`) becomes a 1-line wrapper, NO LONGER a NOT_IMPLEMENTED stub.
  - **NO `moneyTransactionSplit`, NO `moneyTransactionCategorize`** mutations in the public schema. Task B16 (`split_payroll_remittance`) must be redesigned: Wave's pattern is multi-line `moneyTransactionCreate`, not post-hoc splitting. Spec §10 needs revision. The follow-up doc proposes three options (B.1, B.2, B.3) — discuss with the user before implementing.
  - `moneyTransactionCreate` is **BETA** and requires `Business.isClassicAccounting === false`. Add a precondition check.
  - Estimates domain exists (`estimateCreate`, `convertEstimateToInvoice`, …) — v1.1 opportunities, not v1.

## Immediate action items (do these BEFORE resuming A6+)

1. **Get the Wave Full Access Token.** The user is logged into Wave in their Chrome. Direct them to:
   - Visit `https://developer-apps.waveapps.com/apps/create/`
   - Fill the app creation form (a few minutes)
   - Click "Create token" on the resulting app
   - Save it ONLY in `.env` (never paste it in chat): `echo 'WAVE_API_TOKEN=...' >> .env` from their own shell
   - Wave's docs link: `https://developer.waveapps.com/hc/en-us/articles/360019762711-Manage-Applications`

2. **Replace the hand-stub Wave schema with the real one.** Once `.env` has the token, run from project root:
   ```bash
   npm run codegen:introspect   # this script is referenced in plan task A23; create the codegen.introspect.yml if not present
   ```
   This overwrites `data/wave-schema.graphql` with the live schema. Then `npm run codegen` regenerates the TS SDK.
   The introspect script doesn't exist yet (it's part of plan task A23). If you need to fetch the schema before reaching A23, write a one-shot `node` script using `get-graphql-schema` or `graphql-cli` against `https://gql.waveapps.com/graphql/public` with the Bearer token.

3. **Update spec §10 and plan Tasks B5/B9/B16** to reflect the real schema. Use `follow-ups.md` §3 as the source of truth. Specifically:
   - Plan Task B5: replace `NOT_IMPLEMENTED` stub with `invoiceManualPaymentCreate` wrapper. Verify exact input shape post-introspection.
   - Plan Task B16: redesign around multi-line `moneyTransactionCreate`. Document the v1 limitation: imported single-line bank transactions can't be split via API (recommend Wave UI for that case).
   - Plan Task B9 (`categorize_transaction`): probably drop or convert to "update line items via patch" once schema is known.
   - Add a startup check in `src/wave/client.ts` that queries `business { isClassicAccounting }` once per business and surfaces a `CLASSIC_ACCOUNTING_NOT_SUPPORTED` error if true.

4. **Then resume the plan at Task A6** (env validation with Zod). Follow it task-by-task, TDD.

## Constraints / decisions already locked (don't re-litigate)

- **Single tenant, env-var token (option A)** for v1. Pluggable for option C (Bearer passthrough / Claude Connector) later — interface already designed (see spec §11). Don't add OAuth resource-server in v1.
- **No Terraform.** Deploys are TypeScript scripts (`tsx`) wrapping `gcloud` / `scw` CLIs. Reason: 1 service per cloud doesn't justify TF.
- **Hono + MCP SDK Streamable HTTP** for the HTTP entrypoint. **stdio** for local/dev/Claude Desktop. Both transports day 1.
- **Stateless runtime.** No DB, no KV. Tax rates live in `data/tax-rates/*.yaml` (committed). Client profiles live in Wave's `customer.internalNotes` field (parsed at request time). Account mappings in `data/account-mapping/default.yaml` (committed).
- **The LLM never does monetary arithmetic.** All tax/total math happens in deterministic `src/domain/` functions. Tools return already-computed values.
- **TDD** with Vitest + msw (mocked Wave GraphQL). Coverage gates: `src/domain/**` ≥95%, global ≥85%.
- **Lint with Biome**, no ESLint.
- **Cloud Run = test/validation environment, Scaleway Containers = production.** GCP-validated SHA gets promoted to Scaleway via a `promote.ts` script (plan Task C10).

## Working access patterns

**CDP-driven Chrome inspection** (we used this to validate the Wave API state):
- Chrome with `--remote-debugging-port=9222` is running on the user's machine.
- Get tab list: `curl -s http://127.0.0.1:9222/json/list | jq .`
- WS-based driver scripts live in `/tmp/wave-cdp-{check,grep,inspect}.mjs` from the previous session (recreate if missing — they're tiny, ~50 lines each, use Node 22 native `WebSocket`).
- Pattern: connect to a target's `webSocketDebuggerUrl`, send `Page.navigate` + `Runtime.evaluate` JSON-RPC commands.
- **Limitation:** can't reliably handle login flows. User logs in manually; we drive the rest.

**Bash / git commands:** standard. Commit messages use:
```
Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

## Things that don't work / anti-patterns

- **Don't ask the user for their Wave password.** They log in themselves in Chrome; we drive the post-login navigation via CDP.
- **Don't paste the `WAVE_API_TOKEN` in chat.** It's a Bearer-equivalent. User puts it directly in `.env` from their shell.
- **Don't `npm install -g`.** Project deps only.
- **Don't write fake/stub implementations to "make tests pass".** If a Wave mutation doesn't exist (as we discovered for split), redesign the tool, document the limitation, but don't fake it.
- **Don't add Terraform, Bun, Yarn, pnpm.** Stack is locked: Node 22, npm, tsx, Biome, Vitest.
- **Don't commit `WAVE_API_TOKEN` or any secret.** `.env` is gitignored. `.deploy.env` too.

## Hard files reference

| Path | Purpose |
|---|---|
| `package.json` | scripts: `build`, `typecheck`, `lint`, `test`, `coverage`, `codegen`, `dev:stdio`, `dev:http`, `check` |
| `tsconfig.json` | strict everything, NodeNext, target ES2023 |
| `biome.json` | lint + format config |
| `vitest.config.ts` | Vitest with coverage gates |
| `.gitignore` | excludes `src/wave/generated/sdk.ts` (re-generate from codegen) |
| `data/tax-rates/.gitkeep` | jurisdiction × year YAML tables go here |
| `data/account-mapping/.gitkeep` | per-business Wave account_id mapping |
| `src/{config,lib,domain,wave,server,tools,entrypoints}/` | scaffolded but empty (no `.ts` files yet) |
| `tests/{unit,integration,e2e}/` | scaffolded; `tests/unit/smoke.test.ts` is the only test |
| `docs/superpowers/{specs,plans,follow-ups}/...` | full design + implementation contracts |

## Next steps in plain English

1. Get the Wave Full Access Token (user action).
2. Run `npm run codegen:introspect` (you may need to create `codegen.introspect.yml` first per plan Task A23).
3. Apply the three plan revisions from §3 of `follow-ups.md`. Commit with `docs: revise plan for confirmed Wave schema`.
4. Execute plan Task A6 (env validation). Then A7, A8, A9, A10 (lib basics). Then Phase A.2 (domain) A11–A17. Etc.
5. After Task A28 (MCP server bootstrap), the project is ready for the read-only tool batch (A29–A44).
6. Tag `v0.1.0-part-a` when A44 ships and `npm run check` is green.

The plan was written to be subagent-executable. Each task has explicit Files / Steps / Code / Verify / Commit blocks. Follow them literally.

## If you hit ambiguity or a Wave-schema surprise

1. Don't guess. Use the same CDP pattern to confirm against the live API Reference: `https://developer.waveapps.com/hc/en-us/articles/360019968212-API-Reference`.
2. Update `docs/superpowers/follow-ups.md` with what you found.
3. Surface the question to the user before changing the spec.

## User communication style

- French by default (user replies in French; he uses brief French sentences).
- Direct, technical, no fluff.
- He pushes back on yak shaving (he correctly killed Terraform and bash scripts in favor of TS scripts).
- He explicitly trusts your judgment on technical tradeoffs — but expects you to *make* a recommendation rather than ask "what do you prefer?".

Good luck. Pick up at action item #1.
