# WP-OPS-01 OAuth Kapsule Deploy - Design Spec

**Date:** 2026-05-20
**Status:** Draft for user review
**Author:** Codex session with the user

---

## 1. Context

`mcp-wave` already has a working MCP server over stdio and Streamable HTTP. The
current HTTP entrypoint supports `env_token`, `bearer_passthrough`, CORS origin
allowlisting, rate limiting, `/healthz`, `/readyz`, and `/mcp`.

The Claude.ai distribution spike found one hard constraint: Claude.ai custom
remote MCP connectors do not accept a user-pasted static bearer token. An
authenticated remote MCP must expose OAuth 2.x endpoints and let Claude.ai store
an OAuth access token. Therefore the first public Kapsule deployment cannot be a
shared-header MVP if Claude.ai support is required at go-live.

The user selected option 2 on 2026-05-20: `WP-OPS-01` includes OAuth 2.x before
the first Scaleway Kapsule deploy.

## 2. Goals

- Deploy the current MCP runtime on the personal Scaleway Kapsule POC cluster.
- Use Scaleway Container Registry for the image.
- Expose an internet-reachable HTTPS endpoint compatible with Claude.ai custom
  remote MCP connectors.
- Add an OAuth 2.x facade in front of the MCP endpoint.
- Keep Wave authentication single-tenant for this WP: the server uses one
  server-side Wave full-access token from Kubernetes Secret.
- Preserve the existing stdio and simple HTTP dev paths.
- Produce a repeatable deploy path: Dockerfile, Kubernetes manifests, secret
  runbook, and smoke tests.

## 3. Non-goals

- No Wave OAuth integration in `WP-OPS-01`. Wave OAuth remains `WP-MCP-05`.
- No multi-tenant enrollment, user database, or self-service onboarding.
- No Claude Directory submission. Directory packaging remains blocked by OAuth
  hardening plus policy clarification around financial transactions.
- No GCP or Cloud Run path in this WP.
- No Docker Hub publication in this WP.
- No browser automation for Wave imported bank transactions.

## 4. Accepted approach

Use a single-tenant OAuth MCP facade:

1. Claude.ai connects to `https://<mcp-wave-host>/mcp`.
2. The MCP server advertises OAuth protected-resource metadata.
3. Claude.ai dynamically registers as an OAuth client, starts an authorization
   code + PKCE flow, and stores the resulting OAuth token.
4. The operator completes a small consent page protected by an operator secret.
5. Later `/mcp` requests require the OAuth bearer token issued by `mcp-wave`.
6. Tool handlers still call Wave using the server-side `WAVE_API_TOKEN`.

The OAuth token authorizes access to this single deployed MCP endpoint. It is not
a Wave token and cannot be used directly against Wave.

## 5. Architecture

```
Claude.ai / remote MCP client
        |
        | HTTPS + OAuth bearer issued by mcp-wave
        v
Scaleway Kapsule Ingress / Traefik
        |
        v
mcp-wave pod
  - OAuth authorization server endpoints
  - Protected Streamable HTTP /mcp endpoint
  - Existing MCP tool registry
  - Existing WaveClient
        |
        | HTTPS + Wave full-access token from Kubernetes Secret
        v
Wave GraphQL API
```

The OAuth deploy path uses a new entrypoint, not a rewrite of the existing Hono
entrypoint:

- `src/entrypoints/http.ts` stays as the simple local/dev HTTP entrypoint.
- `src/entrypoints/oauth-http.ts` becomes the deploy entrypoint for Kapsule.
- Shared server construction remains in `src/server/mcp-server.ts`.
- Shared Wave access remains in `src/wave/client.ts` and
  `src/wave/auth/provider.ts`.

This keeps the existing tests and local behavior stable while adding the
production-compatible path required by Claude.ai.

## 6. OAuth server design

Use the OAuth helpers shipped with `@modelcontextprotocol/sdk`:

- `mcpAuthRouter` for OAuth metadata, dynamic client registration, token, and
  revocation routes.
- `requireBearerAuth` to protect `/mcp`.
- `OAuthServerProvider` implemented by `SingleTenantOAuthProvider`.

Exposed routes:

- `GET /.well-known/oauth-authorization-server`
- `GET /.well-known/oauth-protected-resource/mcp`
- `POST /register`
- `GET /authorize`
- `POST /authorize`
- `POST /token`
- `POST /revoke`
- `POST /mcp`
- `GET /healthz`
- `GET /readyz`

Supported OAuth behavior:

- Authorization code flow with PKCE `S256`.
- Dynamic Client Registration for Claude.ai custom connectors.
- Scope: `mcp:tools`.
- Refresh tokens supported so Claude.ai does not need the user to reconnect
  every hour.
- Token revocation supported.
- Resource indicator validation: OAuth tokens are valid only for this MCP
  server resource.

Production redirect URI policy:

- Allow `https://claude.ai/api/mcp/auth_callback`.
- Allow `https://claude.com/api/mcp/auth_callback`.
- Reject all other production redirect URIs.
- Allow localhost redirect URIs only when `NODE_ENV !== "production"`.

## 7. Operator consent

This is a single-tenant private deployment, but OAuth still needs an interactive
authorization step. The consent gate is intentionally small:

- `GET /authorize` renders an HTML form with the requested client name, scopes,
  and redirect URI.
- The form asks for `OAUTH_CONSENT_SECRET`.
- `POST /authorize` validates the secret using constant-time comparison.
- On success, the server issues an authorization code and redirects back to the
  registered redirect URI.
- On failure, the server returns 401 and does not issue a code.

This lets the owner authorize Claude.ai without exposing the Wave token or
building a full login system.

## 8. OAuth persistence

The first Kapsule deployment runs as a single replica. OAuth state is stored in a
file-backed JSON store on a small ReadWriteOnce PVC.

Store location:

```text
/var/lib/mcp-wave/oauth-store.json
```

Stored records:

- registered OAuth clients
- authorization codes, one-time and short-lived
- access token hashes
- refresh token hashes
- token metadata: client id, scopes, resource, issued-at, expires-at, revoked

Rules:

- Access and refresh tokens are generated with cryptographic randomness.
- Only SHA-256 token hashes are persisted.
- Writes are atomic: write temp file, fsync, rename.
- The process loads the store at startup and writes after each mutation.
- The deployment remains one replica until the store is replaced by a real
  shared backing service.

Default lifetimes:

- authorization code: 5 minutes
- access token: 1 hour
- refresh token: 30 days

## 9. Wave credential model

`WP-OPS-01` keeps Wave auth single-tenant:

- `WAVE_AUTH_MODE=env_token`
- `WAVE_API_TOKEN` comes from a Kubernetes Secret
- `WAVE_DEFAULT_BUSINESS_ID` comes from a Kubernetes Secret or ConfigMap
- MCP OAuth tokens authorize access to the MCP, not to Wave directly

For logging and support, the MCP request identity should use OAuth information:

```text
oauth:<client_id>:<access_token_hash_prefix>
```

The Wave token must never appear in logs, MCP responses, OAuth responses, or
Kubernetes manifests committed to the repo.

## 10. Runtime configuration

New environment variables:

```text
PUBLIC_BASE_URL=https://<mcp-wave-host>
OAUTH_ISSUER_URL=https://<mcp-wave-host>
OAUTH_CONSENT_SECRET=<operator secret>
OAUTH_STORE_PATH=/var/lib/mcp-wave/oauth-store.json
OAUTH_ACCESS_TOKEN_TTL_SECONDS=3600
OAUTH_REFRESH_TOKEN_TTL_SECONDS=2592000
OAUTH_AUTH_CODE_TTL_SECONDS=300
OAUTH_ALLOWED_REDIRECT_URIS=https://claude.ai/api/mcp/auth_callback,https://claude.com/api/mcp/auth_callback
```

Existing environment variables still used:

```text
NODE_ENV=production
PORT=8080
WAVE_AUTH_MODE=env_token
WAVE_API_TOKEN=<Wave full-access token>
WAVE_DEFAULT_BUSINESS_ID=<Wave business id>
WAVE_GRAPHQL_ENDPOINT=https://gql.waveapps.com/graphql/public
LOG_LEVEL=info
LOG_PII=false
ALLOWED_ORIGINS=https://claude.ai,https://claude.com
RATE_LIMIT_RPM=60
```

`OAUTH_ISSUER_URL` and `PUBLIC_BASE_URL` must be HTTPS in production. The SDK's
insecure issuer escape hatch is allowed only for local tests.

## 11. Kubernetes design

Kapsule target:

- provider: Scaleway Kapsule
- project: POC
- region: `fr-par`
- cluster: `poc`
- namespace: `mcp-wave`
- image: `rg.fr-par.scw.cloud/<registry-namespace>/mcp-wave:<git-sha>`

`poc-k8s` remains the source of truth for the tenant namespace contract:

- `Namespace`
- `ResourceQuota`
- `LimitRange`
- default-deny ingress `NetworkPolicy`
- tenant `ServiceAccount`

The `mcp-wave` repo owns app-level manifests under `deploy/scw/`:

- `deployment.yaml`
- `service.yaml`
- `ingress.yaml`
- `pvc.yaml`
- `secret.example.yaml`
- `kustomization.yaml`
- `README.md` runbook

Initial resource sizing:

```yaml
requests:
  cpu: 100m
  memory: 192Mi
limits:
  cpu: 500m
  memory: 512Mi
```

PVC:

```yaml
accessModes:
  - ReadWriteOnce
resources:
  requests:
    storage: 1Gi
```

Deployment:

- replicas: 1
- readiness probe: `GET /readyz`
- liveness probe: `GET /healthz`
- rolling update with max unavailable 0, max surge 1
- `securityContext.runAsNonRoot=true`
- read-only root filesystem except the mounted OAuth state volume

Ingress:

- public HTTPS host dedicated to this MCP
- Traefik ingress class used by the POC cluster
- TLS certificate issued by the cluster's existing certificate path
- no IP allowlist, because Claude.ai source IPs are external and variable

## 12. Image build and registry

Add a Dockerfile for the current single-package layout:

1. `npm ci`
2. `npm run build`
3. copy `dist/`, `data/`, `package.json`, and production `node_modules`
4. run `node dist/entrypoints/oauth-http.js`

Image naming:

```text
rg.fr-par.scw.cloud/<registry-namespace>/mcp-wave:<git-sha>
```

The runbook must include:

- `docker build`
- `docker push`
- updating the image tag in `deploy/scw/kustomization.yaml`
- applying manifests with `kubectl`
- rolling restart
- smoke checks

## 13. Security controls

- OAuth required for `/mcp`.
- `WWW-Authenticate` includes OAuth protected-resource metadata.
- Redirect URIs are allowlisted.
- OAuth consent requires `OAUTH_CONSENT_SECRET`.
- Tokens are hashed at rest.
- Refresh tokens are revocable.
- Rate limiting applies to OAuth and MCP routes.
- CORS/Origin validation keeps `claude.ai` and `claude.com` only in production.
- Logs redact `authorization`, cookies, OAuth codes, access tokens, refresh
  tokens, and Wave token values.
- Kubernetes Secret values are never committed.
- The Docker image does not include `.env`.

## 14. Observability

Structured logs must include:

- request id
- route group: `oauth`, `mcp`, `health`
- OAuth client id when available
- hashed token prefix when useful for correlation
- MCP session id when available
- error code

Structured logs must not include:

- Wave API token
- OAuth access token
- OAuth refresh token
- authorization code
- consent secret
- invoice/customer payloads when `LOG_PII=false`

## 15. Tests

Unit tests:

- env parsing accepts OAuth config and rejects invalid production HTTP issuer
- file OAuth store writes atomically and reloads persisted clients/tokens
- tokens are stored hashed, not plaintext
- redirect URI allowlist rejects unknown production callbacks
- consent secret comparison accepts only the configured secret
- expired authorization codes and tokens are rejected

Integration tests:

- `/.well-known/oauth-authorization-server` returns issuer, token, authorize,
  register, and revoke endpoints
- `/.well-known/oauth-protected-resource/mcp` points at the issuer
- dynamic client registration stores a Claude callback client
- authorization without consent secret does not issue a code
- authorization with consent secret issues a code
- token endpoint exchanges code + verifier for access and refresh tokens
- `/mcp` rejects missing/invalid OAuth bearer tokens with 401
- `/mcp` accepts a valid OAuth token and initializes an MCP session
- token revocation makes the token unusable

Kapsule smoke tests:

- `GET /healthz` returns 200
- `GET /readyz` returns 200 after secrets and data are mounted
- OAuth metadata endpoints are reachable over HTTPS
- registering and authorizing a test OAuth client works
- a protected MCP `initialize` call works with the issued token
- Claude.ai custom connector can complete the OAuth flow manually

## 16. Rollout sequence

1. Implement OAuth entrypoint and provider locally behind tests.
2. Add Dockerfile and local image smoke.
3. Add `deploy/scw/` manifests and runbook.
4. Create or request `poc-k8s` tenant namespace `mcp-wave`.
5. Create Kubernetes Secret with Wave token and consent secret.
6. Push image to Scaleway Container Registry.
7. Apply Kapsule manifests.
8. Run curl smoke tests.
9. Connect Claude.ai using custom connector UI.
10. Record the final endpoint and deep-link format in README.

## 17. Acceptance criteria

`WP-OPS-01` is complete when:

- `npm run check` passes.
- OAuth integration tests pass.
- Docker image builds from a clean checkout.
- Image is pushed to Scaleway Container Registry.
- Kapsule deployment is live with one replica.
- `/healthz`, `/readyz`, OAuth metadata, and protected `/mcp` smoke checks pass.
- Claude.ai can add the custom connector and complete OAuth.
- A real MCP `tools/list` call succeeds from the deployed endpoint.
- The Wave token remains server-side and is not exposed to the MCP client.
- The runbook documents deploy, rollback, secret rotation, and token revocation.

## 18. Risks and mitigations

**Claude.ai OAuth bearer forwarding bug**

The spike found reports where Claude.ai completes OAuth but does not forward the
bearer token on MCP calls. Mitigation: include a pre-prod Claude.ai smoke gate.
If the bug reproduces, the server work is still standards-compliant; Track 3
stays blocked on Anthropic behavior, not on Kapsule deploy mechanics.

**File-backed OAuth store**

The JSON store is acceptable for one replica. It is not a multi-tenant or
multi-replica design. Mitigation: pin replicas to 1 and document that scaling
requires replacing the store.

**Consent secret phishing or leakage**

The secret gates OAuth issuance for this private deployment. Mitigation: keep it
in Kubernetes Secret, do not log it, rotate it after any suspected exposure.

**Directory policy ambiguity**

Claude Directory submission may reject accounting write tools under the
"Financial transactions" policy. Mitigation: `WP-OPS-01` targets custom connector
use, not Directory publication.

**Kapsule tenant prerequisites**

The app manifests depend on a namespace contract in `poc-k8s`. Mitigation: make
tenant namespace creation an explicit rollout step before app deploy.
