````markdown
# mcp-wave Scaleway Kapsule Runbook

## Inputs

- Kapsule cluster context selected in `kubectl`.
- Namespace contract already created by `poc-k8s`: `mcp-wave`, resource quota, limit range, default deny policy, and `mcp-wave` service account.
- Scaleway Container Registry namespace available in `fr-par`.
- DNS host pointed at the cluster ingress.
- Wave full-access token and Wave business id available from the operator vault.

## Build And Push

```bash
export IMAGE="rg.fr-par.scw.cloud/mcp-wave/mcp-wave:$(git rev-parse --short HEAD)"
docker build -t "${IMAGE}" .
docker push "${IMAGE}"
```

## Runtime Config

```bash
export MCP_WAVE_HOST="mcp-wave.example.invalid"
kubectl -n mcp-wave create configmap mcp-wave-config \
  --from-literal=NODE_ENV=production \
  --from-literal=PORT=8080 \
  --from-literal=WAVE_AUTH_MODE=env_token \
  --from-literal=WAVE_GRAPHQL_ENDPOINT=https://gql.waveapps.com/graphql/public \
  --from-literal=LOG_LEVEL=info \
  --from-literal=LOG_PII=false \
  --from-literal=ALLOWED_ORIGINS=https://claude.ai,https://claude.com \
  --from-literal=RATE_LIMIT_RPM=60 \
  --from-literal=PUBLIC_BASE_URL="https://${MCP_WAVE_HOST}" \
  --from-literal=OAUTH_ISSUER_URL="https://${MCP_WAVE_HOST}" \
  --from-literal=OAUTH_STORE_PATH=/var/lib/mcp-wave/oauth-store.json \
  --from-literal=OAUTH_ACCESS_TOKEN_TTL_SECONDS=3600 \
  --from-literal=OAUTH_REFRESH_TOKEN_TTL_SECONDS=2592000 \
  --from-literal=OAUTH_AUTH_CODE_TTL_SECONDS=300 \
  --from-literal=OAUTH_ALLOWED_REDIRECT_URIS=https://claude.ai/api/mcp/auth_callback,https://claude.com/api/mcp/auth_callback \
  --dry-run=client -o yaml | kubectl apply -f -
```

```bash
kubectl -n mcp-wave create secret generic mcp-wave-secret \
  --from-literal=WAVE_API_TOKEN="${WAVE_API_TOKEN}" \
  --from-literal=WAVE_DEFAULT_BUSINESS_ID="${WAVE_DEFAULT_BUSINESS_ID}" \
  --from-literal=OAUTH_CONSENT_SECRET="${OAUTH_CONSENT_SECRET}" \
  --dry-run=client -o yaml | kubectl apply -f -
```

## Deploy

```bash
cp -R deploy/scw /tmp/mcp-wave-scw
cd /tmp/mcp-wave-scw
kustomize edit set image "mcp-wave=${IMAGE}"
kubectl apply -k .
kubectl -n mcp-wave rollout status deployment/mcp-wave
```

## Smoke Checks

```bash
curl -fsS "https://${MCP_WAVE_HOST}/healthz"
curl -fsS "https://${MCP_WAVE_HOST}/readyz"
curl -fsS "https://${MCP_WAVE_HOST}/.well-known/oauth-authorization-server"
curl -fsS "https://${MCP_WAVE_HOST}/.well-known/oauth-protected-resource/mcp"
```

`/mcp` without a token must return 401 and a `WWW-Authenticate` header:

```bash
curl -i "https://${MCP_WAVE_HOST}/mcp" \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  --data '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}}'
```

## Rollback

```bash
kubectl -n mcp-wave rollout undo deployment/mcp-wave
kubectl -n mcp-wave rollout status deployment/mcp-wave
```

## Secret Rotation

Rotate `OAUTH_CONSENT_SECRET`:

```bash
kubectl -n mcp-wave create secret generic mcp-wave-secret \
  --from-literal=WAVE_API_TOKEN="${WAVE_API_TOKEN}" \
  --from-literal=WAVE_DEFAULT_BUSINESS_ID="${WAVE_DEFAULT_BUSINESS_ID}" \
  --from-literal=OAUTH_CONSENT_SECRET="${NEW_OAUTH_CONSENT_SECRET}" \
  --dry-run=client -o yaml | kubectl apply -f -
kubectl -n mcp-wave rollout restart deployment/mcp-wave
```

Rotate `WAVE_API_TOKEN` with the same command and a new `WAVE_API_TOKEN` value.

## OAuth Token Revocation

Use the OAuth revocation endpoint with the client id and token issued during the OAuth flow:

```bash
curl -fsS -X POST "https://${MCP_WAVE_HOST}/revoke" \
  -H 'content-type: application/x-www-form-urlencoded' \
  --data-urlencode "client_id=${OAUTH_CLIENT_ID}" \
  --data-urlencode "token=${OAUTH_TOKEN}"
```
````
