# Handover - mcp-wave

Date: 2026-05-23
Branch: `main`
Repository: `/home/antoinefa/src/mcp-wave`

This handover is for any next coding session, including Claude, Codex, or another
agent. Continue from the current repository state; do not restart discovery from
scratch unless the worktree has changed materially.

## Reporting Mode

Every status update to the user must use exactly this shape:

- `Fait`
- `A faire`
- `Attendus`

Rules:

- `Fait` lists completed work and verified facts.
- `A faire` is one consolidated list across all open tracks and work packages.
- `Attendus` is only for concrete user decisions, credentials, approvals, or
  actions. Do not put generic next steps there.
- Keep updates concise and factual.
- The user corrected the previous assumption: they prefer option `1`
  subagent-driven execution when a plan offers option `1` vs `2`.

## Current Git State To Verify First

Run these before working:

```bash
git status --short --branch
git log --oneline --decorate -5
git show -s --format=fuller HEAD
```

Expected from the last known session:

- Branch: `main`
- `origin/main` at `6626e43`
- Latest commit:
  `6626e43 docs(plan): add OAuth Kapsule implementation plan`
- Only untracked known path: `.gemini/`

Do not commit `.gemini/` unless the user explicitly asks.

## Commit Hygiene

The user asked to remove all Claude co-authoring trailers from history. That
rewrite was done and force-pushed before this handover.

For future commits:

- Do not add co-authoring trailers.
- Before push, check:

```bash
git show -s --format=%B HEAD
```

- Commit and push normal work on `main` unless the user redirects.
- Never rewrite history again unless the user explicitly asks.

## Relevant Current Artifacts

Top-level tracker:

- `plan.md`

Current WP:

- `WP-OPS-01 - Single-tenant Kapsule deploy`
- Status in `plan.md`: `[implementation ready]`

Design spec:

- `docs/superpowers/specs/2026-05-20-wp-ops-01-oauth-kapsule-design.md`

Implementation plan:

- `docs/superpowers/plans/2026-05-21-wp-ops-01-oauth-kapsule-implementation.md`

The implementation plan is intentionally detailed and should be executed
task-by-task. It covers OAuth env config, OAuth crypto helpers, redirect URI
validation, file-backed OAuth state, single-tenant OAuth provider, Express OAuth
HTTP entrypoint, Docker image, Scaleway Kapsule manifests, runbook, tests, and
docs.

## User Decision State

The user selected OAuth-first deployment for `WP-OPS-01`.

Important correction:

- Do not assume the user wants option `2`.
- The user said that was the opposite.
- If execution mode is needed, proceed with option `1` only after explicit user
  confirmation or if the current session has already clearly requested it.

Because Codex subagents can only be spawned when explicitly authorized by the
user, ask or wait for a clear `go option 1` before spawning agents.

## WP-OPS-01 Scope

Accepted approach:

- Add an OAuth 2.x facade before the first Scaleway Kapsule deploy.
- Keep Wave auth single-tenant with server-side `WAVE_API_TOKEN`.
- OAuth tokens authorize access to this MCP endpoint only; they are not Wave
  tokens.
- Use Scaleway Kapsule and Scaleway Container Registry.
- No GCP/Cloud Run path in this WP.
- No Wave OAuth in this WP; Wave OAuth remains `WP-MCP-05`.

Target runtime:

- New entrypoint: `src/entrypoints/oauth-http.ts`
- Existing local/dev Hono entrypoint remains: `src/entrypoints/http.ts`
- OAuth SDK helpers:
  - `mcpAuthRouter`
  - `requireBearerAuth`
  - `OAuthServerProvider`
- Protected MCP route: `/mcp`
- Metadata:
  - `/.well-known/oauth-authorization-server`
  - `/.well-known/oauth-protected-resource/mcp`
- OAuth routes:
  - `/register`
  - `/authorize`
  - `/token`
  - `/revoke`

Persistence:

- File-backed JSON OAuth store.
- Production path: `/var/lib/mcp-wave/oauth-store.json`
- Single replica only until the store is replaced by shared backing storage.

Kapsule:

- Namespace: `mcp-wave`
- App manifests under `deploy/scw/`
- PVC: 1Gi RWO
- Resources:
  - requests: `100m` CPU, `192Mi` memory
  - limits: `500m` CPU, `512Mi` memory

## Important Code Context

Existing HTTP entrypoint:

- `src/entrypoints/http.ts`
- Hono app with `/healthz`, `/readyz`, `/mcp`
- Uses `WebStandardStreamableHTTPServerTransport`
- Auth modes are selected through `selectProvider(env)`

Env config:

- `src/config/env.ts`
- Existing required Wave env:
  - `WAVE_AUTH_MODE`
  - `WAVE_API_TOKEN` when `env_token`
  - `WAVE_DEFAULT_BUSINESS_ID`
  - `WAVE_GRAPHQL_ENDPOINT`
  - `ALLOWED_ORIGINS`
  - `RATE_LIMIT_RPM`

MCP server:

- `src/server/mcp-server.ts`
- `buildMcpServer({ tools, makeCtx })`
- Tool registry from `src/server/tool-registry.ts`

HTTP auth tests to mirror:

- `tests/integration/entrypoints/http.auth.test.ts`

SDK facts already checked:

- `StreamableHTTPServerTransport` accepts Node `req`, `res`, and optional
  parsed body.
- `requireBearerAuth` attaches `req.auth`.
- `mcpAuthRouter` is Express middleware and should be mounted at app root.

## Recommended Next Work

Use the implementation plan:

```bash
sed -n '1,260p' docs/superpowers/plans/2026-05-21-wp-ops-01-oauth-kapsule-implementation.md
```

Recommended execution order:

1. Task 1: Dependencies and OAuth env.
2. Task 2: OAuth crypto and redirect helpers.
3. Task 3: File-backed OAuth store.
4. Task 4: Single-tenant OAuth provider.
5. Task 5: OAuth HTTP entrypoint.
6. Task 6: Docker image.
7. Task 7: Scaleway manifests and runbook.
8. Task 8: docs, verification, commit, push.

If using subagent-driven execution, give each worker a disjoint write scope and
remind it that other workers may be editing the repo. Review and integrate
between tasks.

## Verification Expectations

Before claiming completion, run fresh verification.

Focused verification from the implementation plan:

```bash
npm run test:unit -- tests/unit/config/env.oauth.test.ts tests/unit/server/oauth/crypto.test.ts tests/unit/server/oauth/redirect-uri.test.ts tests/unit/server/oauth/file-store.test.ts tests/unit/server/oauth/single-tenant-provider.test.ts
npm run test:integration -- tests/integration/entrypoints/oauth-http.test.ts
npm run typecheck
npm run lint
```

Full verification:

```bash
npm run check
```

Before final push:

```bash
git status --short --branch
git show -s --format=%B HEAD
git push origin main
```

## Known Constraints

- Wave public API does not expose imported bank transactions for
  read/reconcile/split/match.
- `split_payroll_remittance` creates a new multi-line accounting transaction; it
  does not target an imported Desjardins transaction.
- Imported-bank-transaction reconciliation stays manual for now.
- Claude.ai custom remote MCP connectors require OAuth 2.x; static bearer token
  entry is not enough for the target Claude.ai path.
- Claude Directory submission is not part of `WP-OPS-01`.

## Last Known Status Report

Fait:

- OAuth-first `WP-OPS-01` spec is committed and pushed.
- Implementation plan is committed and pushed at `6626e43`.
- `plan.md` points to the implementation plan and marks the WP implementation
  ready.
- No co-authoring trailer is present in the last known commit message.

A faire:

- Execute `docs/superpowers/plans/2026-05-21-wp-ops-01-oauth-kapsule-implementation.md`.
- Keep `.gemini/` untracked unless explicitly requested.
- Commit and push completed slices.

Attendus:

- Explicit user confirmation before spawning subagents for option `1`.
