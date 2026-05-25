# WP-OPS-02 — Migrate OAuth remote MCP entrypoint to Hono / @sentropic/mcp-hono

**Goal:** Replace the Express OAuth remote MCP entrypoint (`src/entrypoints/oauth-http.ts`) with a Hono one built on `@sentropic/mcp-hono@^0.1.6`, removing the Express dependency tree. Keep all OAuth logic (`src/server/oauth/*`) and all 26 tools unchanged in behavior.

**Architecture (validated by spike):**
- `@sentropic/mcp-hono` provides the **Resource Server** (bearer validation, PRM, `WWW-Authenticate`, protocol negotiation, sessions) via its `oauth` option with a pluggable `validateToken`.
- The **Authorization Server** (DCR, `/authorize` + consent + PKCE, `/token`, `/revoke`, AS metadata) stays applicative: hand-written Hono routes over the existing `SingleTenantOAuthProvider`.
- Tools are bridged onto McpHono via a generic adapter reusing `RegisteredTool.inputSchema` + `error-bridge`. mcp-hono 0.1.6 converts zod v4 schemas faithfully (spike-verified).

**Spike evidence:** `tests/spike-mcp-hono.test.ts` (throwaway) — protocol echo `2025-03-26`, 401+`WWW-Authenticate` w/ `resource_metadata`, faithful `tools/list` schema, `tools/call` via error-bridge — all green on 0.1.6.

**Commit strategy:** forward commits on `main` (no history rewrite). Each task leaves `npm run check` green. Express is kept working until the cut-over task, then removed.

---

## Task 1 — Provider: framework-agnostic authorize

**Files:** `src/server/oauth/single-tenant-provider.ts`, `tests/unit/server/oauth/single-tenant-provider.test.ts`

- Add `export type AuthorizeOutcome = { kind: "consent"; status: 200 | 401; html: string } | { kind: "redirect"; location: string }`.
- Add method `authorizeRequest(client, params: AuthorizationParams, input: { method: string; consentSecret?: string }): Promise<AuthorizeOutcome>` containing the current `authorize` logic but returning an outcome instead of writing to `res` (GET → `{kind:"consent",status:200,html}`; bad/absent secret on POST → `{kind:"consent",status:401,html:"…Invalid consent secret"}`; good secret → issue code, build redirect URL → `{kind:"redirect",location}`).
- Keep existing `authorize(client, params, res)` for now; reimplement it to delegate to `authorizeRequest` (read `res.req.method` + `res.req.body.consent_secret`, then map outcome to `res`). This keeps the Express entrypoint green.
- Rename `issueAuthorizationCodeForTests` → `issueAuthorizationCode` (it is a production path); update the single reference in the unit test. Keep `issueTokensForTests` (genuinely test-only).
- Add unit tests for `authorizeRequest`: consent GET html, bad-secret 401 html, good-secret redirect carrying `code` + `state`.

**Verify:** `npm run check` green.

---

## Task 2 — Hono Authorization-Server router

**Files:** create `src/server/oauth/hono-oauth-router.ts`, create `tests/integration/server/oauth/hono-oauth-router.test.ts`

`buildOAuthAsRouter(provider, oauthConfig, nodeEnv): Hono` mounting:
- `GET /.well-known/oauth-authorization-server` → metadata: `issuer`, `authorization_endpoint`, `token_endpoint`, `registration_endpoint`, `revocation_endpoint`, `scopes_supported:["mcp:tools"]`, `response_types_supported:["code"]`, `grant_types_supported:["authorization_code","refresh_token"]`, `code_challenge_methods_supported:["S256"]`, `token_endpoint_auth_methods_supported:["none"]`, `revocation_endpoint_auth_methods_supported:["none"]`.
- `POST /register` (DCR) → parse client metadata JSON, `provider.clientsStore.registerClient(...)`, return `201` with the registered client. Map `InvalidClientMetadataError` → `400 {error:"invalid_client_metadata"}`.
- `GET|POST /authorize` → parse params from query (GET) or form body (POST); resolve client via `clientsStore.getClient`; call `provider.authorizeRequest(client, params, {method, consentSecret})`; map outcome to `c.html(html, status)` or `c.redirect(location, 302)`. On invalid client/redirect_uri, return an error page / `400`.
- `POST /token` → form body. For `grant_type=authorization_code`: verify PKCE (`challenge = base64url(sha256(code_verifier))` must equal `provider.challengeForAuthorizationCode(client, code)`; mismatch → `invalid_grant`), then `provider.exchangeAuthorizationCode(client, code, code_verifier, redirect_uri, resource?)`. For `grant_type=refresh_token`: `provider.exchangeRefreshToken(...)`. Return `200` tokens JSON. Map SDK OAuth errors (`InvalidGrantError`, `InvalidTargetError`, `InvalidScopeError`) → `400 {error:<oauth code>, error_description}`.
- `POST /revoke` → form body `{client_id, token}`; `provider.revokeToken(client, {token})`; return `200 {}`.

Use `@modelcontextprotocol/sdk/server/auth/errors.js` classes' `.errorCode`/message for mapping (they are framework-agnostic — no Express).

**Verify:** integration tests via `router.request(...)` cover metadata, DCR 201, authorize consent+redirect, token (authz_code w/ PKCE happy + bad verifier), refresh, revoke. `npm run check` green.

---

## Task 3 — Token verifier adapter + Hono entrypoint

**Files:** create `src/server/oauth/token-verifier.ts`, create `src/entrypoints/oauth-http.hono.ts`, create `tests/integration/entrypoints/oauth-http.hono.test.ts`

- `token-verifier.ts`: `makeValidateToken(provider): (token, c) => Promise<OAuthTokenValidationResult | false>` — `try { const a = await provider.verifyAccessToken(token); return { subject: a.clientId, scopes: a.scopes, audience: a.resource?.href, issuer: oauthConfig.issuerUrl.href, claims: { tokenHashPrefix: a.extra?.tokenHashPrefix } } } catch { return false }`.
- `oauth-http.hono.ts`: `buildOAuthHonoApp(deps): Hono`:
  - `app.use(originAllowlist(allowedOrigins))`, `app.use(rateLimit(env.RATE_LIMIT_RPM))` (reuse existing Hono middlewares).
  - `GET /healthz` → `{ok:true}`.
  - `GET /readyz` → tax-rates load + Wave `__typename` ping (keep parity with current behavior; readinessProbe already on `/healthz`).
  - Mount AS router: `app.route("/", buildOAuthAsRouter(...))`.
  - Serve protected-resource metadata at root path `/.well-known/oauth-protected-resource/mcp` (the URL advertised in `WWW-Authenticate`). **Verify exactly where McpHono serves its own PRM under the `/mcp` mount; if it is mount-relative (`/mcp/.well-known/...`), serve the canonical root PRM ourselves via `createOAuthProtectedResourceMetadata` or a static handler and set mcp-hono `resourceMetadataUrl` to the root URL.**
  - Build `const server = mcp({ name:"mcp-wave", version:"0.1.0", oauth:{ issuer, authorizationServers:[issuer], resource: resourceServerUrl.href, resourceMetadataUrl, requiredScopes:["mcp:tools"], scopesSupported:["mcp:tools"], validateToken } })`.
  - Tool bridge: for each `allTools()`, `server.tool({ name, description, schema: tool.inputSchema as unknown as ZodObject, handler: (args,c) => toMcpResult(tool)(args, makeCtx(c)) })`.
  - `makeCtx(c)`: `{ req:{ headers: c.req.raw.headers, request_id }, wave, taxRates, accountMapping, env, logger: baseLogger.child({request_id}), identity: oauthIdentity(getOAuthContext(c)) }` where `request_id = crypto.randomUUID()` and `identity = "oauth:" + ctx?.subject + ":" + (ctx?.claims?.tokenHashPrefix ?? "unknown")`.
  - `app.route("/mcp", server)`.
  - Start server only when `NODE_ENV !== "test"`.
- Integration test mirrors the old Express flow via `app.request()`: DCR → authorize (consent_secret) → token (PKCE) → `POST /mcp initialize` with bearer → 200 + `mcp-session-id`; plus unauth `POST /mcp` → 401 w/ `resource_metadata`; plus `GET /.well-known/oauth-protected-resource/mcp` resolves.

**Decide:** McpHono validates args against schema before calling our handler. Confirm its validation-failure response; if it diverges from our `INVALID_INPUT` envelope, document it as an accepted behavior change (still a clear error). Do not double-handle.

**Verify:** `npm run check` green (Express entrypoint still present).

---

## Task 4 — Cut over to Hono, remove Express

**Files:** replace `src/entrypoints/oauth-http.ts` with the Hono impl (rename `oauth-http.hono.ts` → `oauth-http.ts`, drop temp name); delete `src/server/http/express-origin-allowlist.ts`, `tests/integration/entrypoints/oauth-http.test.ts` (Express), `tests/spike-mcp-hono.test.ts`; provider: remove `authorize(res)` + `import type { Response } from "express"`, drop `implements OAuthServerProvider` if unused; `package.json`: remove `express`, `express-rate-limit`, `cors`, `@types/express`, `@types/cors`, `supertest`, `@types/supertest`; add `@sentropic/mcp-hono` to `dependencies`. Reconcile the `oauth-http.hono.test.ts` name → `oauth-http.test.ts`.

- Confirm `package.json` scripts `dev:oauth-http` / `start:oauth-http` still point at `src/entrypoints/oauth-http.ts` / `dist/entrypoints/oauth-http.js` (no change needed).
- Dockerfile already runs `dist/entrypoints/oauth-http.js` — verify it still builds with no Express.

**Verify:** `npm run check` green; `npm ls express` shows nothing direct; `docker build` (if available) succeeds.

---

## Task 5 — zod 4, docs, verification, push

- Clarify with the user what "upgrade zod 4" means (project is already on zod 4.4.3 = latest). Act accordingly (bump if a target exists, or remove any zod-3 residue).
- Update `README.md` OAuth section to say the entrypoint is Hono + `@sentropic/mcp-hono`.
- Update `plan.md`: add `WP-OPS-02` and mark WP-OPS-01 superseded for the runtime stack.
- Full `npm run check`; commit; `git push origin main`.
