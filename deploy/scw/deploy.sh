#!/usr/bin/env bash
# One-command Kapsule deploy for mcp-wave. Mirrors deploy/scw/README.md.
# Prereqs (see README "Inputs"): kubectl context on the Kapsule cluster, the
# `mcp-wave` namespace + service account already created, docker logged in to the
# Scaleway Container Registry, and DNS for ${MCP_WAVE_HOST} pointed at the ingress.
set -euo pipefail

# --- Required environment ---------------------------------------------------
: "${MCP_WAVE_HOST:?set MCP_WAVE_HOST, e.g. mcp-wave.example.com}"
: "${WAVE_API_TOKEN:?set WAVE_API_TOKEN (full-access Wave token)}"
: "${WAVE_DEFAULT_BUSINESS_ID:?set WAVE_DEFAULT_BUSINESS_ID}"
: "${OAUTH_CONSENT_SECRET:?set OAUTH_CONSENT_SECRET (operator-chosen)}"

# --- Optional (defaults) ----------------------------------------------------
REGISTRY="${REGISTRY:-rg.fr-par.scw.cloud/mcp-wave}"
NAMESPACE="${NAMESPACE:-mcp-wave}"
IMAGE="${IMAGE:-${REGISTRY}/mcp-wave:$(git rev-parse --short HEAD)}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

echo "==> Image:     ${IMAGE}"
echo "==> Namespace: ${NAMESPACE}"
echo "==> Host:      ${MCP_WAVE_HOST}"

# --- Build & push -----------------------------------------------------------
echo "==> Building image"
docker build -t "${IMAGE}" "${REPO_ROOT}"

echo "==> Smoke-testing image locally before push"
SMOKE="mcpw-deploy-smoke-$$"
docker rm -f "${SMOKE}" >/dev/null 2>&1 || true
docker run -d --name "${SMOKE}" -p 18099:8080 \
  -e NODE_ENV=production -e PORT=8080 \
  -e WAVE_AUTH_MODE=env_token -e WAVE_API_TOKEN=fake -e WAVE_DEFAULT_BUSINESS_ID=biz \
  -e WAVE_GRAPHQL_ENDPOINT=https://example.invalid/graphql \
  -e ALLOWED_ORIGINS="https://${MCP_WAVE_HOST}" \
  -e PUBLIC_BASE_URL="https://${MCP_WAVE_HOST}" -e OAUTH_ISSUER_URL="https://${MCP_WAVE_HOST}" \
  -e OAUTH_CONSENT_SECRET=fake -e OAUTH_STORE_PATH=/tmp/oauth-store.json \
  "${IMAGE}" >/dev/null
trap 'docker rm -f "${SMOKE}" >/dev/null 2>&1 || true' EXIT
for _ in $(seq 1 20); do curl -fsS http://localhost:18099/healthz >/dev/null 2>&1 && break; sleep 1; done
curl -fsS http://localhost:18099/healthz | grep -q '"ok":true' || { echo "image smoke failed"; docker logs "${SMOKE}" | tail -20; exit 1; }
docker rm -f "${SMOKE}" >/dev/null 2>&1 || true; trap - EXIT
echo "==> Image smoke OK"

echo "==> Pushing image"
docker push "${IMAGE}"

# --- Runtime config (non-secret) --------------------------------------------
echo "==> Applying ConfigMap"
kubectl -n "${NAMESPACE}" create configmap mcp-wave-config \
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

echo "==> Applying Secret"
kubectl -n "${NAMESPACE}" create secret generic mcp-wave-secret \
  --from-literal=WAVE_API_TOKEN="${WAVE_API_TOKEN}" \
  --from-literal=WAVE_DEFAULT_BUSINESS_ID="${WAVE_DEFAULT_BUSINESS_ID}" \
  --from-literal=OAUTH_CONSENT_SECRET="${OAUTH_CONSENT_SECRET}" \
  --dry-run=client -o yaml | kubectl apply -f -

# --- Deploy via kustomize ---------------------------------------------------
echo "==> Applying manifests"
WORK="$(mktemp -d)"
trap 'rm -rf "${WORK}"' EXIT
cp -R "${REPO_ROOT}/deploy/scw/." "${WORK}/"
( cd "${WORK}" && kustomize edit set image "mcp-wave=${IMAGE}" && kubectl apply -k . )
kubectl -n "${NAMESPACE}" rollout status deployment/mcp-wave --timeout=180s

# --- Smoke ------------------------------------------------------------------
echo "==> Smoke checks against https://${MCP_WAVE_HOST}"
curl -fsS "https://${MCP_WAVE_HOST}/healthz" && echo
curl -fsS "https://${MCP_WAVE_HOST}/.well-known/oauth-authorization-server" >/dev/null && echo "AS metadata OK"
curl -fsS "https://${MCP_WAVE_HOST}/.well-known/oauth-protected-resource/mcp" >/dev/null && echo "PRM OK"
code="$(curl -s -o /dev/null -w '%{http_code}' -X POST "https://${MCP_WAVE_HOST}/mcp" \
  -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' \
  --data '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}')"
[ "${code}" = "401" ] && echo "unauth /mcp -> 401 OK" || { echo "expected 401 from /mcp, got ${code}"; exit 1; }

echo "==> Deploy complete: ${IMAGE}"
