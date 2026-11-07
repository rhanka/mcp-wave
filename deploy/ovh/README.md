# mcp-wave OVHcloud Managed Kubernetes Runbook

The supported production path is the GitHub Actions workflow. For a controlled
operator deployment, `deploy/ovh/deploy.sh` performs the equivalent build,
local image smoke test, push, manifest apply, rollout, and remote smoke checks.

## OVH prerequisites

- A selected OVHcloud Managed Kubernetes Service context, with the `mcp-wave`
  namespace, resource quota, limit range, default-deny policy, and
  `mcp-wave` service account already provisioned. The `mcp-wave-config` and
  `mcp-wave-secret` runtime resources must also exist before the first CI
  rollout; the operator script creates them from its required environment.
- The existing Scaleway Container Registry credentials remain configured for
  the image build and pull. Moving images to GHCR is deliberately a separate
  migration from the Kubernetes cutover.
- The measured OVH ingress contract is Traefik, with cert-manager's
  `letsencrypt-prod` ClusterIssuer and Octavia load balancer `51.79.100.177`.
- DNS for `MCP_WAVE_HOST` pointing to the ingress load balancer.

`pvc.yaml` requests OVH's `block-standard` storage class. Verify it is
available with `kubectl get storageclass` before the first deployment. Changing
a storage class after a PVC has bound requires a migration, not an in-place
manifest update.

## GitHub Actions configuration

Set these repository secrets:

- Keep `SCW_REGISTRY_USER` and `SCW_REGISTRY_PASSWORD` unchanged.
- Replace the value of `KUBE_CONFIG` with the base64 value from
  `OVH_KUBECONFIG_B64_MCP_WAVE`. The secret name does not change.

On each `main` change, the workflow pushes the short-SHA and `latest` image to
the existing registry, updates the Deployment, waits for the rollout, then
proves that the public hostname resolves to the OVH load balancer by comparing
the TLS certificate serials.

## Cutover from Scaleway

The OAuth store is a single-replica, persistent JSON file. Its data has been
copied to the OVH `block-standard` PVC before the DNS flip. Do not run both
replicas against the same Wave credentials. The Deployment uses `Recreate`,
which is required for its ReadWriteOnce volume: a rolling update could schedule
a replacement before the previous pod releases the PVC.

## Operator deployment

```bash
export MCP_WAVE_HOST=mcp-wave.example.invalid
export WAVE_API_TOKEN=<full-access-wave-token>
export WAVE_DEFAULT_BUSINESS_ID=<wave-business-id>
export OAUTH_CONSENT_SECRET=<random-secret>
deploy/ovh/deploy.sh
```

The script assumes Docker is already logged in to the existing Scaleway
registry. It generates the non-secret ConfigMap and application Secret from
these inputs.

## Smoke checks

After a deployment, verify the live endpoint:

```bash
curl -fsS "https://${MCP_WAVE_HOST}/healthz"
curl -fsS "https://${MCP_WAVE_HOST}/readyz"
curl -fsS "https://${MCP_WAVE_HOST}/.well-known/oauth-authorization-server"
curl -fsS "https://${MCP_WAVE_HOST}/.well-known/oauth-protected-resource/mcp"
```

First prove that DNS reaches OVH rather than merely accepting a status code:

```bash
PUBLIC_HOST=mcp-wave.sent-tech.ca
OVH_INGRESS_IP=51.79.100.177
normal_serial=$(echo | openssl s_client -connect "${PUBLIC_HOST}:443" -servername "${PUBLIC_HOST}" 2>/dev/null | openssl x509 -noout -serial)
ovh_serial=$(echo | openssl s_client -connect "${OVH_INGRESS_IP}:443" -servername "${PUBLIC_HOST}" 2>/dev/null | openssl x509 -noout -serial)
test "${normal_serial}" = "${ovh_serial}"
```

Then an unauthenticated MCP request must be rejected:

```bash
curl -i "https://${MCP_WAVE_HOST}/mcp" \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  --data '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}}'
```

Expect HTTP `401` and a `WWW-Authenticate` header.

## Rollback and rotation

```bash
kubectl -n mcp-wave rollout undo deployment/mcp-wave
kubectl -n mcp-wave rollout status deployment/mcp-wave
```

To rotate `OAUTH_CONSENT_SECRET` or the Wave token, rerun the deployment with
the changed environment value.
